import QRCode from "qrcode";
import sql from "./db";
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

function getExpiresAt() {
  const minutes = Number(process.env.TOPUP_EXPIRES_MINUTES ?? DEFAULT_EXPIRES_MINUTES);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_EXPIRES_MINUTES;
  return new Date(Date.now() + safeMinutes * 60 * 1000);
}

function publicTopUp(row: Record<string, any>, qrImage?: string | null) {
  return {
    id: row.id,
    status: row.status as TopUpStatus,
    points: Number(row.points),
    paymentMethod: row.payment_method,
    baseAmount: centsToAmount(Number(row.base_amount_cents)),
    payableAmount: centsToAmount(Number(row.payable_amount_cents)),
    refDecimal: Number(row.ref_decimal),
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    qrPayload: row.qr_payload,
    qrImage: qrImage ?? null,
  };
}

async function expireOldTopUps(db = sql) {
  await db`
    UPDATE point_topups
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending'
      AND expires_at < NOW()
  `;
}

async function nextAvailableRefDecimal(baseAmountCents: number, db = sql) {
  const rows = await db`
    SELECT ref_decimal
    FROM point_topups
    WHERE status = 'pending'
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

export async function createPromptPayTopUp({
  userId,
  points,
}: {
  userId: string;
  points: number;
}) {
  const promptPayId = process.env.PROMPTPAY_ID;
  if (!promptPayId) {
    throw new Error("ยังไม่ได้ตั้งค่า PROMPTPAY_ID ใน backend environment");
  }
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

    const baseAmountCents = points * 100;
    const refDecimal = await nextAvailableRefDecimal(baseAmountCents, db);
    const payableAmountCents = baseAmountCents + refDecimal;
    const payableAmount = centsToAmount(payableAmountCents);
    const qrPayload = buildPromptPayPayload(promptPayId, payableAmount);
    const expiresAt = getExpiresAt();

    const [topUp] = await db`
      INSERT INTO point_topups (
        user_id, points, payment_method, status, base_amount_cents,
        payable_amount_cents, ref_decimal, qr_payload, expires_at
      )
      VALUES (
        ${userId}, ${points}, 'promptpay', 'pending', ${baseAmountCents},
        ${payableAmountCents}, ${refDecimal}, ${qrPayload}, ${expiresAt.toISOString()}
      )
      RETURNING *
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
    SELECT *
    FROM point_topups
    WHERE id = ${id}::uuid
      AND user_id = ${userId}
    LIMIT 1
  `;
  if (!topUp) return null;
  return publicTopUp(topUp);
}

export async function confirmTopUpByAmount({
  amountCents,
  lineMessage,
}: {
  amountCents: number;
  lineMessage: unknown;
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
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    if (!topUp) {
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
