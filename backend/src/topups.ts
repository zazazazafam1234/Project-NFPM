import QRCode from "qrcode";
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
    baseAmount: centsToAmount(Number(row.base_amount_cents)),
    payableAmount: centsToAmount(Number(row.payable_amount_cents)),
    refDecimal: Number(row.ref_decimal),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    qrPayload: row.qr_payload,
    qrImage: qrImage ?? null,
    createdAt: row.created_at,
    checkRequestedAt: row.check_requested_at ?? null,
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

// Picks a satang ref not used by another pending top-up that charges the same amount.
async function nextAvailableRefDecimal(chargeCents: number, paymentAccountId: string | null, db = sql) {
  const rows = await db`
    SELECT ref_decimal
    FROM point_topups
    WHERE status = 'pending'
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

export const CHECK_REQUEST_COOLDOWN_SECONDS = 20;

// Customer says they paid but the top-up is still pending: flag it so the LINE
// worker re-syncs with LINE frequently (see libs/line/worker.ts).
export async function requestTopUpCheck(id: string, userId: string) {
  const [row] = await sql`
    UPDATE point_topups
    SET check_requested_at = NOW(), check_request_count = check_request_count + 1, updated_at = NOW()
    WHERE id = ${id}::uuid
      AND user_id = ${userId}
      AND status = 'pending'
      AND expires_at >= NOW()
      AND (check_requested_at IS NULL
        OR check_requested_at <= NOW() - make_interval(secs => ${CHECK_REQUEST_COOLDOWN_SECONDS}))
    RETURNING id
  `;
  if (row) return { ok: true as const };
  const [current] = await sql`
    SELECT status, expires_at < NOW() AS expired FROM point_topups WHERE id = ${id}::uuid AND user_id = ${userId}
  `;
  if (!current) return { ok: false as const, message: "ไม่พบรายการเติมเงิน" };
  if (current.status !== "pending" || current.expired) {
    return { ok: false as const, message: "รายการนี้ไม่ได้รอชำระแล้ว" };
  }
  return { ok: true as const }; // already requested moments ago; still being checked
}

// Payment accounts with pending top-ups, and whether a customer asked for a
// re-check in the last few minutes.
export async function getAccountsAwaitingPayment(boostMinutes: number) {
  return sql<Array<{ payment_account_id: string; boost: boolean }>>`
    SELECT payment_account_id,
      BOOL_OR(check_requested_at > NOW() - make_interval(mins => ${boostMinutes})) AS boost
    FROM point_topups
    WHERE status = 'pending' AND expires_at >= NOW() AND payment_account_id IS NOT NULL
    GROUP BY payment_account_id
  `;
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

    const [updatedUser] = await db`
      UPDATE "User"
      SET points = points + ${topUp.points}, "updatedAt" = NOW()
      WHERE id = ${topUp.user_id}
        AND status = 'active'
      RETURNING points
    `;
    if (!updatedUser) throw new Error("ไม่พบผู้ใช้ที่พร้อมเติม Point");

    // Points cover the base amount; everything else goes to the discount wallet.
    const satang = Number(topUp.ref_decimal);
    await creditDiscount(db, {
      userId: topUp.user_id,
      cents: satang,
      kind: "satang",
      reason: `เศษสตางค์จากการเติม Point (.${String(satang).padStart(2, "0")})`,
      topupId: topUp.id,
    });
    // Promotion/code discounts were already taken off the transfer; the code
    // redemption is confirmed here and the customer is tied to the streamer.
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
        line_message = ${JSON.stringify(lineMessage)},
        updated_at = NOW()
      WHERE id = ${topUp.id}
      RETURNING *
    `;

    if (lineTransferEventId) {
      await db`
        UPDATE line_transfer_events
        SET status = 'matched',
            matched_topup_id = ${paid.id},
            match_reason = NULL,
            updated_at = NOW()
        WHERE id = ${lineTransferEventId}::uuid
      `;
    }

    await db`
      INSERT INTO "Transaction" (id, "userId", "topUpId", type, amount, description, "createdAt")
      VALUES (
        ${crypto.randomUUID()},
        ${topUp.user_id},
        ${topUp.id},
        'topup',
        ${topUp.points},
        ${`เติม ${Number(topUp.points).toLocaleString()} Point — PromptPay ${centsToAmount(amountCents).toFixed(2)} บาท${
          Number(topUp.discount_cents) > 0 ? ` (ส่วนลด ${centsToAmount(Number(topUp.discount_cents)).toFixed(2)} บาท)` : ""
        }`},
        NOW()
      )
    `;

    return {
      matched: true,
      topUpId: paid.id,
      userId: paid.user_id,
      points: Number(paid.points),
      userPoints: Number(updatedUser.points),
      amount: centsToAmount(amountCents),
    };
  });
}
