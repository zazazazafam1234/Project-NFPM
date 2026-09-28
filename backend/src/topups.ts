import QRCode from "qrcode";
import sql from "./db";
import { decryptSecret } from "./crypto";
import { buildPromptPayPayload } from "./promptpay";

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
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    qrPayload: row.qr_payload,
    qrImage: qrImage ?? null,
  };
}

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
}

async function nextAvailableRefDecimal(baseAmountCents: number, paymentAccountId: string | null, db = sql) {
  const rows = await db`
    SELECT ref_decimal
    FROM point_topups
    WHERE status = 'pending'
      AND (
        (${paymentAccountId}::uuid IS NULL AND payment_account_id IS NULL)
        OR payment_account_id = ${paymentAccountId}::uuid
      )
      AND base_amount_cents = ${baseAmountCents}
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
}: {
  userId: string;
  points: number;
}) {
  if (!Number.isInteger(points) || points <= 0 || points > 100000) {
    throw new Error("จำนวน Point ไม่ถูกต้อง");
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

    const paymentAccount = await getDefaultPaymentAccount(db);
    if (!paymentAccount) {
      throw new Error("ยังไม่ได้ตั้งค่าบัญชี PromptPay ในหน้า Admin");
    }

    const baseAmountCents = points * 100;
    const refDecimal = await nextAvailableRefDecimal(baseAmountCents, paymentAccount.id, db);
    const payableAmountCents = baseAmountCents + refDecimal;
    const payableAmount = centsToAmount(payableAmountCents);
    const qrPayload = buildPromptPayPayload(paymentAccount.promptPayId, payableAmount);
    const expiresAt = getExpiresAt(paymentAccount.topupExpiresMinutes);

    const [topUp] = await db`
      INSERT INTO point_topups (
        user_id, payment_account_id, points, payment_method, status, base_amount_cents,
        payable_amount_cents, ref_decimal, qr_payload, expires_at
      )
      VALUES (
        ${userId}, ${paymentAccount.id}, ${points}, 'promptpay', 'pending', ${baseAmountCents},
        ${payableAmountCents}, ${refDecimal}, ${qrPayload}, ${expiresAt.toISOString()}
      )
      RETURNING *, ${paymentAccount.name} AS payment_account_name
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
    SELECT pt.*, pa.name AS payment_account_name
    FROM point_topups pt
    LEFT JOIN payment_accounts pa ON pa.id = pt.payment_account_id
    WHERE pt.id = ${id}::uuid
      AND pt.user_id = ${userId}
    LIMIT 1
  `;
  if (!topUp) return null;
  return publicTopUp(topUp);
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
        ${`เติม ${Number(topUp.points).toLocaleString()} Point — PromptPay ${centsToAmount(amountCents).toFixed(2)} บาท`},
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
