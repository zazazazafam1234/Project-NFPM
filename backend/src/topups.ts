import QRCode from "qrcode";
import { createHmac, timingSafeEqual } from "node:crypto";
import sql from "./db";
import { decryptSecret } from "./crypto";
import { buildPromptPayPayload } from "./promptpay";
import { getMinTopupPoints, MAX_TOPUP_POINTS } from "./settings";
import { bestTopupPromotion, checkStreamerCode, creditDiscount, rewardCents, voidUnpaidRedemptions } from "./rewards";

const DEFAULT_EXPIRES_MINUTES = 15;

export type TopUpStatus = "pending" | "paid" | "expired" | "cancelled" | "failed";

export function amountToCents(amount: number | string) {
  const normalized = typeof amount === "number"
    ? amount.toFixed(2)
    : amount.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [baht, satang = ""] = normalized.split(".");
  return Number(baht) * 100 + Number(satang.padEnd(2, "0"));
}

function centsToAmount(cents: number) {
  return cents / 100;
}

function normalizeLineCookie(value: string) {
  const cookie = value.trim();
  if (!cookie) return cookie;
  if (cookie.toLowerCase().startsWith("cookie:")) {
    return cookie.slice("cookie:".length).trim();
  }
  if (cookie.includes("=")) return cookie;
  return `lct=${cookie}`;
}

function parseLineTransferDate(value?: string | null) {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const [, dayValue, monthValue, yearValue, hourValue, minuteValue] = match;
  let year = Number(yearValue);
  if (year < 100) year += 2500;
  if (year > 2400) year -= 543;

  const date = new Date(Date.UTC(
    year,
    Number(monthValue) - 1,
    Number(dayValue),
    Number(hourValue) - 7,
    Number(minuteValue),
  ));

  return Number.isNaN(date.getTime()) ? null : date;
}

function getExpiresAt(minutesValue?: number | null) {
  const minutes = Number(minutesValue ?? process.env.TOPUP_EXPIRES_MINUTES ?? DEFAULT_EXPIRES_MINUTES);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_EXPIRES_MINUTES;
  return new Date(Date.now() + safeMinutes * 60 * 1000);
}

function publicTopUp(row: Record<string, any>, qrImage?: string | null) {
  return {
    id: row.id,
    status: row.status as TopUpStatus,
    points: Number(row.points),
    paymentMethod: row.payment_method,
    paymentAccountId: row.payment_account_id ?? null,
    paymentAccountName: row.payment_account_name ?? null,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? null,
    stripeStatus: row.stripe_status ?? null,
    stripePromptPayHostedUrl: row.stripe_promptpay_hosted_url ?? null,
    baseAmount: centsToAmount(Number(row.base_amount_cents)),
    payableAmount: centsToAmount(Number(row.payable_amount_cents)),
    refDecimal: Number(row.ref_decimal),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    qrPayload: row.qr_payload,
    qrImage: qrImage ?? null,
    // Discounts already taken off the transfer (satang).
    discountCents: Number(row.discount_cents ?? 0),
    chargeAmount: centsToAmount(Number(row.payable_amount_cents) - Number(row.ref_decimal)),
    promotionName: row.promotion_name ?? null,
    promotionRewardCents: Number(row.promotion_reward_cents ?? 0),
    streamerName: row.streamer_name ?? null,
    streamerRewardCents: Number(row.streamer_reward_cents ?? 0),
  };
}

// point_topups joined with what the frontend shows about it.
const topupViewColumns = () => sql`
  pt.*,
  pa.name AS payment_account_name,
  promo.name AS promotion_name,
  st.name AS streamer_name,
  sr.reward_cents AS streamer_reward_cents
`;
const topupViewJoins = () => sql`
  LEFT JOIN payment_accounts pa ON pa.id = pt.payment_account_id
  LEFT JOIN topup_promotions promo ON promo.id = pt.promotion_id
  LEFT JOIN streamer_redemptions sr ON sr.topup_id = pt.id AND sr.status <> 'void'
  LEFT JOIN streamers st ON st.id = sr.streamer_id
`;

export type ActivePaymentAccount = {
  id: string;
  name: string;
  promptPayId: string;
  lineCookie: string;
  topupExpiresMinutes: number;
  updatedAt: string;
};

export async function getActivePaymentAccounts() {
  const rows = await sql`
    SELECT
      id,
      name,
      promptpay_id_ciphertext,
      line_cookie_ciphertext,
      topup_expires_minutes,
      updated_at
    FROM payment_accounts
    WHERE status = 'active'
      AND deleted_at IS NULL
      AND line_cookie_ciphertext IS NOT NULL
    ORDER BY is_default DESC, created_at ASC
  `;

  return rows.flatMap<ActivePaymentAccount>((row) => {
    try {
      return [{
        id: row.id as string,
        name: row.name as string,
        promptPayId: decryptSecret(row.promptpay_id_ciphertext),
        lineCookie: normalizeLineCookie(decryptSecret(row.line_cookie_ciphertext)),
        topupExpiresMinutes: Number(row.topup_expires_minutes),
        updatedAt: new Date(row.updated_at).toISOString(),
      }];
    } catch (err) {
      console.error("[payment-account] decrypt failed", row.id, err instanceof Error ? err.message : err);
      return [];
    }
  });
}

async function expireOldTopUps(db = sql) {
  await db`
    UPDATE point_topups
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending'
      AND expires_at < NOW()
  `;
  await voidUnpaidRedemptions(db);
}

async function stripeRequest(path: string, body?: URLSearchParams, method = "POST") {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("ยังไม่ได้ตั้งค่า STRIPE_SECRET_KEY");

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "Stripe request failed");
  }
  return data as Record<string, any>;
}

async function retrieveStripePaymentIntent(paymentIntentId: string) {
  return stripeRequest(`/payment_intents/${encodeURIComponent(paymentIntentId)}`, undefined, "GET");
}

async function cancelStripePaymentIntent(paymentIntentId: string) {
  return stripeRequest(`/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`);
}

async function createStripePromptPayIntent({
  amountCents,
  receiptEmail,
  topUpId,
  userId,
  points,
}: {
  amountCents: number;
  receiptEmail?: string | null;
  topUpId: string;
  userId: string;
  points: number;
}) {
  const params = new URLSearchParams();
  params.set("amount", String(amountCents));
  params.set("currency", "thb");
  params.append("payment_method_types[]", "promptpay");
  params.set("payment_method_data[type]", "promptpay");
  params.set("confirm", "true");
  params.set("description", `Fast Movie top-up ${points} Point`);
  params.set("metadata[topup_id]", topUpId);
  params.set("metadata[user_id]", userId);
  params.set("metadata[points]", String(points));
  if (receiptEmail) params.set("receipt_email", receiptEmail);
  return stripeRequest("/payment_intents", params);
}

async function markTopUpPaid(
  db: typeof sql,
  {
    topUp,
    amountCents,
    source,
    paymentRecord,
  }: {
    topUp: Record<string, any>;
    amountCents: number;
    source: "PromptPay" | "Stripe PromptPay";
    paymentRecord: unknown;
  },
) {
  if (topUp.status === "paid") {
    return { alreadyPaid: true, userId: topUp.user_id, points: Number(topUp.points) };
  }

  const [updatedUser] = await db`
    UPDATE "User"
    SET points = points + ${topUp.points}, "updatedAt" = NOW()
    WHERE id = ${topUp.user_id}
      AND status = 'active'
    RETURNING points
  `;
  if (!updatedUser) throw new Error("ไม่พบผู้ใช้ที่พร้อมเติม Point");

  const satang = Number(topUp.ref_decimal);
  if (satang > 0) {
    await creditDiscount(db, {
      userId: topUp.user_id,
      cents: satang,
      kind: "satang",
      reason: `เศษสตางค์จากการเติม Point (.${String(satang).padStart(2, "0")})`,
      topupId: topUp.id,
    });
  }

  const [redemption] = await db`
    UPDATE streamer_redemptions r
    SET status = 'redeemed', redeemed_at = NOW()
    FROM streamers s
    WHERE r.topup_id = ${topUp.id} AND r.status = 'pending' AND s.id = r.streamer_id
    RETURNING r.streamer_id, r.reward_cents, s.name
  `;
  if (redemption) {
    await db`
      UPDATE "User" SET referred_streamer_id = ${redemption.streamer_id}
      WHERE id = ${topUp.user_id} AND referred_streamer_id IS NULL
    `;
  }

  const [paid] = await db`
    UPDATE point_topups
    SET
      status = 'paid',
      paid_at = NOW(),
      matched_amount_cents = ${amountCents},
      line_message = ${JSON.stringify(paymentRecord)},
      updated_at = NOW()
    WHERE id = ${topUp.id}
    RETURNING *
  `;

  await db`
    INSERT INTO "Transaction" (id, "userId", "topUpId", type, amount, description, "createdAt")
    VALUES (
      ${crypto.randomUUID()},
      ${topUp.user_id},
      ${topUp.id},
      'topup',
      ${topUp.points},
      ${`เติม ${Number(topUp.points).toLocaleString()} Point — ${source} ${centsToAmount(amountCents).toFixed(2)} บาท${
        Number(topUp.discount_cents) > 0 ? ` (ส่วนลด ${centsToAmount(Number(topUp.discount_cents)).toFixed(2)} บาท)` : ""
      }`},
      NOW()
    )
  `;

  return {
    topUpId: paid.id,
    userId: paid.user_id,
    points: Number(paid.points),
    userPoints: Number(updatedUser.points),
    amount: centsToAmount(amountCents),
  };
}

// Picks a satang ref not used by another pending top-up that charges the same amount.
async function nextAvailableRefDecimal(chargeCents: number, paymentAccountId: string | null, db = sql) {
  const rows = await db`
    SELECT ref_decimal
    FROM point_topups
    WHERE status = 'pending'
      AND payment_method = 'promptpay'
      AND (
        (${paymentAccountId}::uuid IS NULL AND payment_account_id IS NULL)
        OR payment_account_id = ${paymentAccountId}::uuid
      )
      AND payable_amount_cents - ref_decimal = ${chargeCents}
      AND expires_at >= NOW()
    ORDER BY ref_decimal
  `;
  const used = new Set(rows.map((row) => Number(row.ref_decimal)));
  const start = Math.floor(Math.random() * 99) + 1;
  for (let offset = 0; offset < 99; offset++) {
    const ref = ((start + offset - 1) % 99) + 1;
    if (!used.has(ref)) return ref;
  }
  throw new Error("ยอดเติมนี้มีรายการรอชำระเต็มแล้ว กรุณาลองใหม่ภายหลัง");
}

export async function createStripePromptPayTopUp({
  userId,
  points,
  code,
}: {
  userId: string;
  points: number;
  code?: string | null;
}) {
  if (!Number.isInteger(points) || points <= 0 || points > MAX_TOPUP_POINTS) {
    throw new Error("จำนวน Point ไม่ถูกต้อง");
  }
  const minPoints = await getMinTopupPoints();
  if (points < minPoints) {
    throw new Error(`ยอดเติมขั้นต่ำ ${minPoints} บาท`);
  }

  const result = await sql.begin(async (db) => {
    await expireOldTopUps(db);

    const [user] = await db`
      SELECT id, email
      FROM "User"
      WHERE id = ${userId}
        AND status = 'active'
      FOR SHARE
    `;
    if (!user) throw new Error("บัญชีนี้ไม่พร้อมใช้งาน");

    const codeCheck = code?.trim() ? await checkStreamerCode(db, code, userId) : null;
    if (codeCheck && !codeCheck.ok) throw new Error(codeCheck.message);

    const baseAmountCents = points * 100;
    const promotion = await bestTopupPromotion(db, baseAmountCents);
    const promotionCents = promotion?.rewardCents ?? 0;
    const streamerCents = codeCheck?.ok ? rewardCents(codeCheck.streamer, baseAmountCents) : 0;
    const discountCents = Math.min(promotionCents + streamerCents, baseAmountCents - 100);
    const payableAmountCents = baseAmountCents - discountCents;
    const expiresAt = getExpiresAt();

    const [inserted] = await db`
      INSERT INTO point_topups (
        user_id, points, payment_method, status, base_amount_cents,
        payable_amount_cents, ref_decimal, expires_at, promotion_id, promotion_reward_cents,
        discount_cents
      )
      VALUES (
        ${userId}, ${points}, 'stripe_promptpay', 'pending', ${baseAmountCents},
        ${payableAmountCents}, 0, ${expiresAt.toISOString()},
        ${promotion?.id ?? null}, ${promotionCents}, ${discountCents}
      )
      RETURNING id
    `;
    if (codeCheck?.ok) {
      await db`
        INSERT INTO streamer_redemptions (streamer_id, user_id, topup_id, status, reward_cents)
        VALUES (${codeCheck.streamer.id}, ${userId}, ${inserted.id}, 'pending', ${streamerCents})
      `;
    }

    try {
      const intent = await createStripePromptPayIntent({
        amountCents: payableAmountCents,
        receiptEmail: user.email,
        topUpId: inserted.id,
        userId,
        points,
      });
      const qr = intent.next_action?.promptpay_display_qr_code;
      const [topUp] = await db`
        UPDATE point_topups
        SET stripe_payment_intent_id = ${intent.id},
            stripe_status = ${intent.status},
            stripe_promptpay_hosted_url = ${qr?.hosted_instructions_url ?? null},
            qr_payload = ${qr?.data ?? null},
            updated_at = NOW()
        WHERE id = ${inserted.id}
        RETURNING *
      `;
      return topUp;
    } catch (err) {
      await db`
        UPDATE point_topups
        SET status = 'failed',
            note = ${err instanceof Error ? err.message : "stripe_create_failed"},
            updated_at = NOW()
        WHERE id = ${inserted.id}
      `;
      throw err;
    }
  });

  const qrPayload = result.qr_payload;
  const qrImage = qrPayload
    ? `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(qrPayload, {
        type: "svg",
        margin: 1,
        width: 240,
      })).toString("base64")}`
    : null;

  return publicTopUp(result, qrImage);
}

async function getDefaultPaymentAccount(db = sql) {
  const [account] = await db`
    SELECT
      id,
      name,
      promptpay_id_ciphertext,
      topup_expires_minutes
    FROM payment_accounts
    WHERE status = 'active'
      AND is_default = TRUE
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `;

  if (account) {
    return {
      id: account.id as string,
      name: account.name as string,
      promptPayId: decryptSecret(account.promptpay_id_ciphertext),
      topupExpiresMinutes: Number(account.topup_expires_minutes),
    };
  }

  const promptPayId = process.env.PROMPTPAY_ID;
  if (!promptPayId) return null;

  return {
    id: null,
    name: "Environment PromptPay",
    promptPayId,
    topupExpiresMinutes: Number(process.env.TOPUP_EXPIRES_MINUTES ?? DEFAULT_EXPIRES_MINUTES),
  };
}

export async function createPromptPayTopUp({
  userId,
  points,
  code,
}: {
  userId: string;
  points: number;
  code?: string | null;
}) {
  if (!Number.isInteger(points) || points <= 0 || points > MAX_TOPUP_POINTS) {
    throw new Error("จำนวน Point ไม่ถูกต้อง");
  }
  const minPoints = await getMinTopupPoints();
  if (points < minPoints) {
    throw new Error(`ยอดเติมขั้นต่ำ ${minPoints} บาท`);
  }

  const result = await sql.begin(async (db) => {
    await expireOldTopUps(db);

    const [user] = await db`
      SELECT id
      FROM "User"
      WHERE id = ${userId}
        AND status = 'active'
      FOR SHARE
    `;
    if (!user) throw new Error("บัญชีนี้ไม่พร้อมใช้งาน");

    const codeCheck = code?.trim() ? await checkStreamerCode(db, code, userId) : null;
    if (codeCheck && !codeCheck.ok) throw new Error(codeCheck.message);

    const paymentAccount = await getDefaultPaymentAccount(db);
    if (!paymentAccount) {
      throw new Error("ยังไม่ได้ตั้งค่าบัญชี PromptPay ในหน้า Admin");
    }

    // Promotion and streamer-code discounts come off the transfer; points stay in full.
    const baseAmountCents = points * 100;
    const promotion = await bestTopupPromotion(db, baseAmountCents);
    const promotionCents = promotion?.rewardCents ?? 0;
    const streamerCents = codeCheck?.ok ? rewardCents(codeCheck.streamer, baseAmountCents) : 0;
    const discountCents = Math.min(promotionCents + streamerCents, baseAmountCents - 100); // pay at least ฿1
    const chargeCents = baseAmountCents - discountCents;

    const refDecimal = await nextAvailableRefDecimal(chargeCents, paymentAccount.id, db);
    const payableAmountCents = chargeCents + refDecimal;
    const payableAmount = centsToAmount(payableAmountCents);
    const qrPayload = buildPromptPayPayload(paymentAccount.promptPayId, payableAmount);
    const expiresAt = getExpiresAt(paymentAccount.topupExpiresMinutes);

    const [inserted] = await db`
      INSERT INTO point_topups (
        user_id, payment_account_id, points, payment_method, status, base_amount_cents,
        payable_amount_cents, ref_decimal, qr_payload, expires_at, promotion_id, promotion_reward_cents,
        discount_cents
      )
      VALUES (
        ${userId}, ${paymentAccount.id}, ${points}, 'promptpay', 'pending', ${baseAmountCents},
        ${payableAmountCents}, ${refDecimal}, ${qrPayload}, ${expiresAt.toISOString()},
        ${promotion?.id ?? null}, ${promotionCents}, ${discountCents}
      )
      RETURNING id
    `;
    if (codeCheck?.ok) {
      await db`
        INSERT INTO streamer_redemptions (streamer_id, user_id, topup_id, status, reward_cents)
        VALUES (${codeCheck.streamer.id}, ${userId}, ${inserted.id}, 'pending', ${streamerCents})
      `;
    }

    const [topUp] = await db`
      SELECT ${topupViewColumns()} FROM point_topups pt ${topupViewJoins()} WHERE pt.id = ${inserted.id}
    `;
    return topUp;
  });

  const qrSvg = await QRCode.toString(result.qr_payload, {
    type: "svg",
    margin: 1,
    width: 240,
  });
  const qrImage = `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString("base64")}`;

  return publicTopUp(result, qrImage);
}

export async function getTopUpForUser(id: string, userId: string) {
  await expireOldTopUps();
  await syncStripeTopUpForUser(id, userId).catch((err) => {
    console.error("[stripe] sync top-up failed", err instanceof Error ? err.message : err);
  });
  const [topUp] = await sql`
    SELECT ${topupViewColumns()}
    FROM point_topups pt
    ${topupViewJoins()}
    WHERE pt.id = ${id}::uuid
      AND pt.user_id = ${userId}
    LIMIT 1
  `;
  if (!topUp) return null;
  return publicTopUp(topUp);
}

export async function listTopUpsForUser(userId: string) {
  await expireOldTopUps();
  const pendingStripeRows = await sql`
    SELECT id
    FROM point_topups
    WHERE user_id = ${userId}
      AND status = 'pending'
      AND payment_method = 'stripe_promptpay'
      AND stripe_payment_intent_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 10
  `;
  for (const row of pendingStripeRows) {
    await syncStripeTopUpForUser(row.id, userId).catch((err) => {
      console.error("[stripe] sync top-up failed", row.id, err instanceof Error ? err.message : err);
    });
  }
  const rows = await sql`
    SELECT ${topupViewColumns()}
    FROM point_topups pt
    ${topupViewJoins()}
    WHERE pt.user_id = ${userId}
    ORDER BY pt.created_at DESC
    LIMIT 50
  `;

  return rows.map((row) => publicTopUp(row));
}

export async function cancelTopUpForUser(id: string, userId: string) {
  const topUp = await sql.begin(async (db) => {
    await expireOldTopUps(db);
    const [cancelled] = await db`
      UPDATE point_topups
      SET status = 'cancelled', note = 'Cancelled by customer', updated_at = NOW()
      WHERE id = ${id}::uuid
        AND user_id = ${userId}
        AND status = 'pending'
        AND expires_at > NOW()
      RETURNING id
    `;
    if (!cancelled) return null;

    const [current] = await db`
      SELECT stripe_payment_intent_id
      FROM point_topups
      WHERE id = ${cancelled.id}
      LIMIT 1
    `;
    if (current?.stripe_payment_intent_id) {
      await cancelStripePaymentIntent(current.stripe_payment_intent_id).catch((err) => {
        console.error("[stripe] cancel payment intent failed", err instanceof Error ? err.message : err);
      });
    }

    await voidUnpaidRedemptions(db);

    const [row] = await db`
      SELECT ${topupViewColumns()}
      FROM point_topups pt
      ${topupViewJoins()}
      WHERE pt.id = ${cancelled.id}
      LIMIT 1
    `;
    return row ? publicTopUp(row) : null;
  });

  return topUp;
}

export async function syncStripeTopUpForUser(id: string, userId: string) {
  const [row] = await sql`
    SELECT id, stripe_payment_intent_id
    FROM point_topups
    WHERE id = ${id}::uuid
      AND user_id = ${userId}
      AND payment_method = 'stripe_promptpay'
      AND stripe_payment_intent_id IS NOT NULL
    LIMIT 1
  `;
  if (!row) return null;
  return syncStripeTopUpByPaymentIntent(row.stripe_payment_intent_id);
}

export async function syncStripeTopUpByPaymentIntent(paymentIntentId: string) {
  const intent = await retrieveStripePaymentIntent(paymentIntentId);
  const qr = intent.next_action?.promptpay_display_qr_code;

  return sql.begin(async (db) => {
    const [topUp] = await db`
      SELECT *
      FROM point_topups
      WHERE stripe_payment_intent_id = ${paymentIntentId}
      FOR UPDATE
      LIMIT 1
    `;
    if (!topUp) return null;

    await db`
      UPDATE point_topups
      SET stripe_status = ${intent.status},
          stripe_promptpay_hosted_url = ${qr?.hosted_instructions_url ?? topUp.stripe_promptpay_hosted_url ?? null},
          qr_payload = COALESCE(${qr?.data ?? null}, qr_payload),
          updated_at = NOW()
      WHERE id = ${topUp.id}
    `;

    if (topUp.status !== "pending") {
      return { topUpId: topUp.id, status: topUp.status };
    }

    if (intent.status === "succeeded") {
      return markTopUpPaid(db, {
        topUp,
        amountCents: Number(intent.amount_received ?? intent.amount ?? topUp.payable_amount_cents),
        source: "Stripe PromptPay",
        paymentRecord: {
          provider: "stripe",
          paymentIntentId: intent.id,
          status: intent.status,
          amountReceived: intent.amount_received ?? null,
        },
      });
    }

    if (["canceled", "requires_payment_method"].includes(String(intent.status))) {
      const status = intent.status === "canceled" ? "cancelled" : "failed";
      await db`
        UPDATE point_topups
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${topUp.id}
      `;
      await voidUnpaidRedemptions(db);
    }

    return { topUpId: topUp.id, status: intent.status };
  });
}

export function verifyStripeWebhookPayload(payload: string, signatureHeader: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("missing_stripe_webhook_secret");
  if (!signatureHeader) throw new Error("missing_stripe_signature");

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = parts.t;
  const signatures = signatureHeader
    .split(",")
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice("v1=".length));
  if (!timestamp || signatures.length === 0) throw new Error("invalid_stripe_signature");

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) throw new Error("stale_stripe_signature");

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const ok = signatures.some((signature) => {
    const actualBuffer = Buffer.from(signature);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  });
  if (!ok) throw new Error("invalid_stripe_signature");

  return JSON.parse(payload) as Record<string, any>;
}

export async function recordLineTransferEvent({
  paymentAccountId,
  lineRevision,
  parsed,
}: {
  paymentAccountId: string;
  lineRevision?: number | string | null;
  parsed: Record<string, any>;
}) {
  const amountCents = amountToCents(parsed.เงินเข้า);
  if (!amountCents) throw new Error("invalid_transfer_amount");

  const balanceCents = parsed.ยอดเงินทั้งหมด ? amountToCents(parsed.ยอดเงินทั้งหมด) : null;
  const revision = lineRevision === undefined || lineRevision === null
    ? null
    : Number(lineRevision);
  const occurredAt = parseLineTransferDate(parsed.เมื่อ);
  const senderName = parsed.ผู้โอน?.trim() || null;

  const [event] = await sql`
    INSERT INTO line_transfer_events (
      payment_account_id,
      line_revision,
      incoming_amount_cents,
      balance_cents,
      destination_account,
      sender_name,
      from_account,
      transfer_type,
      occurred_at,
      occurred_raw,
      raw_message,
      status
    )
    VALUES (
      ${paymentAccountId}::uuid,
      ${Number.isFinite(revision) ? revision : null},
      ${amountCents},
      ${balanceCents},
      ${parsed.เข้าบัญชี || null},
      ${senderName},
      ${parsed.จากบัญชี || null},
      ${parsed.ประเภท || null},
      ${occurredAt ? occurredAt.toISOString() : null},
      ${parsed.เมื่อ || null},
      ${JSON.stringify(parsed)},
      'received'
    )
    ON CONFLICT (payment_account_id, line_revision)
      WHERE line_revision IS NOT NULL
    DO UPDATE SET
      balance_cents = EXCLUDED.balance_cents,
      destination_account = EXCLUDED.destination_account,
      sender_name = COALESCE(EXCLUDED.sender_name, line_transfer_events.sender_name),
      from_account = COALESCE(EXCLUDED.from_account, line_transfer_events.from_account),
      transfer_type = COALESCE(EXCLUDED.transfer_type, line_transfer_events.transfer_type),
      occurred_at = COALESCE(EXCLUDED.occurred_at, line_transfer_events.occurred_at),
      occurred_raw = COALESCE(EXCLUDED.occurred_raw, line_transfer_events.occurred_raw),
      raw_message = EXCLUDED.raw_message,
      updated_at = NOW()
    RETURNING id, status, matched_topup_id
  `;

  return {
    id: event.id as string,
    amountCents,
    alreadyMatched: Boolean(event.matched_topup_id) || event.status === "matched",
  };
}

export async function markLineTransferEventFailed(id: string, reason: string) {
  await sql`
    UPDATE line_transfer_events
    SET status = 'failed', match_reason = ${reason}, updated_at = NOW()
    WHERE id = ${id}::uuid
  `;
}

export async function confirmTopUpByAmount({
  amountCents,
  lineMessage,
  paymentAccountId,
  lineTransferEventId,
}: {
  amountCents: number;
  lineMessage: unknown;
  paymentAccountId?: string | null;
  lineTransferEventId?: string | null;
}) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { matched: false, reason: "invalid_amount" };
  }

  return sql.begin(async (db) => {
    await expireOldTopUps(db);

    const [topUp] = await db`
      SELECT *
      FROM point_topups
      WHERE status = 'pending'
        AND payment_method = 'promptpay'
        AND expires_at >= NOW()
        AND payable_amount_cents = ${amountCents}
        AND (${paymentAccountId ?? null}::uuid IS NULL OR payment_account_id = ${paymentAccountId ?? null}::uuid)
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    if (!topUp) {
      if (lineTransferEventId) {
        await db`
          UPDATE line_transfer_events
          SET status = 'unmatched',
              match_reason = 'pending_topup_not_found',
              updated_at = NOW()
          WHERE id = ${lineTransferEventId}::uuid
        `;
      }
      return { matched: false, reason: "pending_topup_not_found" };
    }

    const paid = await markTopUpPaid(db, {
      topUp,
      amountCents,
      source: "PromptPay",
      paymentRecord: lineMessage,
    });

    if (lineTransferEventId) {
      await db`
        UPDATE line_transfer_events
        SET status = 'matched',
            matched_topup_id = ${paid.topUpId},
            match_reason = NULL,
            updated_at = NOW()
        WHERE id = ${lineTransferEventId}::uuid
      `;
    }

    return {
      matched: true,
      ...paid,
    };
  });
}
