import sql from "./db";
import { generateStreamerCode } from "./rewards";

/**
 * Resellers ("ตัวแทนจำหน่าย"): customer accounts with their own code. A customer may
 * use a given reseller's code once, on a top-up: the transfer gets
 * reseller_discount_percent off (app setting, default 5%) and, once the top-up is
 * paid, the reseller earns their commission_cents (default ฿0.25). Commission is
 * paid out by an admin by hand ("จ่ายแล้ว" stamps paid_out_at).
 */

type Db = typeof sql;

export const DEFAULT_RESELLER_DISCOUNT_PERCENT = 5;
export const DEFAULT_RESELLER_COMMISSION_CENTS = 25;

export async function getResellerDiscountPercent(db: Db = sql) {
  const [row] = await db`SELECT value FROM app_settings WHERE key = 'reseller_discount_percent'`;
  const value = Number(row?.value);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : DEFAULT_RESELLER_DISCOUNT_PERCENT;
}

export async function setResellerDiscountPercent(value: number) {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('reseller_discount_percent', ${sql.json(value)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

export function resellerDiscountCents(baseCents: number, percent: number) {
  return Math.floor((baseCents * percent) / 100);
}

export type ResellerCodeCheck =
  | { ok: true; reseller: { id: string; code: string; commission_cents: number }; percent: number }
  | { ok: false; notFound: boolean; message: string };

// A reseller code works while the reseller is active with quota left, once per customer,
// and never for the reseller's own account.
export async function checkResellerCode(db: Db, code: string, userId: string): Promise<ResellerCodeCheck> {
  const normalized = code.trim().toUpperCase();
  const [reseller] = await db`
    SELECT r.id, r.code, r.user_id, r.commission_cents, r.max_uses,
      (SELECT COUNT(*) FROM reseller_redemptions x
        WHERE x.reseller_id = r.id AND x.status IN ('pending', 'redeemed'))::int AS used
    FROM resellers r
    JOIN "User" u ON u.id = r.user_id
    WHERE UPPER(r.code) = ${normalized} AND r.status = 'active' AND r.deleted_at IS NULL AND u.status = 'active'
  `;
  if (!reseller) return { ok: false, notFound: true, message: "ไม่พบโค้ดนี้ หรือโค้ดถูกปิดใช้งานแล้ว" };
  if (reseller.user_id === userId) return { ok: false, notFound: false, message: "ใช้โค้ดตัวแทนของตัวเองไม่ได้" };

  const [history] = await db`
    SELECT
      EXISTS (
        SELECT 1 FROM reseller_redemptions
        WHERE reseller_id = ${reseller.id} AND user_id = ${userId} AND status = 'redeemed'
      ) AS used_code,
      EXISTS (
        SELECT 1 FROM reseller_redemptions x
        JOIN point_topups t ON t.id = x.topup_id
        WHERE x.reseller_id = ${reseller.id} AND x.user_id = ${userId} AND x.status = 'pending' AND t.status = 'pending'
      ) AS code_waiting
  `;
  if (history.used_code) return { ok: false, notFound: false, message: "บัญชีนี้เคยใช้โค้ดของตัวแทนคนนี้ไปแล้ว (ใช้ได้ 1 ครั้งต่อคน)" };
  if (history.code_waiting) {
    return {
      ok: false,
      notFound: false,
      message: "มีรายการเติมที่ใช้โค้ดนี้รอชำระอยู่ กรุณาชำระ QR เดิม รอให้หมดอายุ หรือติดต่อแอดมินให้ยกเลิก",
    };
  }
  if (reseller.max_uses && Number(reseller.used) >= Number(reseller.max_uses)) {
    return { ok: false, notFound: false, message: "โค้ดนี้ถูกใช้ครบจำนวนแล้ว" };
  }
  return {
    ok: true,
    reseller: { id: reseller.id, code: reseller.code, commission_cents: Number(reseller.commission_cents) },
    percent: await getResellerDiscountPercent(db),
  };
}

// Called inside the top-up payment transaction: the reseller's commission is earned now.
export async function redeemResellerCode(db: Db, topupId: string) {
  await db`
    UPDATE reseller_redemptions x
    SET status = 'redeemed', redeemed_at = NOW()
    WHERE x.topup_id = ${topupId} AND x.status IN ('pending', 'void')
      AND NOT EXISTS (
        SELECT 1 FROM reseller_redemptions o
        WHERE o.reseller_id = x.reseller_id AND o.user_id = x.user_id AND o.id <> x.id
          AND o.status IN ('pending', 'redeemed')
      )
  `;
}

// Pending uses on top-ups that were never paid free the customer's one use again.
export async function voidUnpaidResellerRedemptions(db: Db) {
  await db`
    UPDATE reseller_redemptions x
    SET status = 'void'
    FROM point_topups t
    WHERE x.status = 'pending' AND t.id = x.topup_id AND t.status IN ('expired', 'cancelled', 'failed')
  `;
}

// Reseller and streamer codes share one input, so a code must be free in both.
export async function referralCodeTaken(code: string, exceptResellerId: string | null = null) {
  const [row] = await sql`
    SELECT
      EXISTS (SELECT 1 FROM streamers WHERE UPPER(code) = UPPER(${code}) AND deleted_at IS NULL)
      OR EXISTS (
        SELECT 1 FROM resellers
        WHERE UPPER(code) = UPPER(${code}) AND deleted_at IS NULL
          AND (${exceptResellerId}::uuid IS NULL OR id <> ${exceptResellerId}::uuid)
      ) AS taken
  `;
  return Boolean(row.taken);
}

export async function newResellerCode(name: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateStreamerCode(name);
    if (!(await referralCodeTaken(code))) return code;
  }
  throw new Error("สร้างโค้ดไม่สำเร็จ กรุณาลองใหม่");
}

export type ResellerStat = {
  id: string;
  code: string;
  commissionCents: number;
  maxUses: number | null;
  status: "active" | "inactive";
  createdAt: Date;
  userId: string;
  userName: string;
  userEmail: string;
  customers: number;
  pending: number;
  salesCents: number;
  discountCents: number;
  commissionEarnedCents: number;
  commissionUnpaidCents: number;
};

/** Sales per reseller (redeemed uses only). `resellerId` narrows it to one reseller. */
export async function resellerStats(resellerId: string | null = null): Promise<ResellerStat[]> {
  const rows = await sql<ResellerStat[]>`
    SELECT
      r.id, r.code, r.commission_cents AS "commissionCents", r.max_uses AS "maxUses", r.status,
      r.created_at AS "createdAt", u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
      COUNT(x.id) FILTER (WHERE x.status = 'redeemed')::int AS customers,
      COUNT(x.id) FILTER (WHERE x.status = 'pending')::int AS pending,
      COALESCE(SUM(x.base_amount_cents) FILTER (WHERE x.status = 'redeemed'), 0)::bigint AS "salesCents",
      COALESCE(SUM(x.discount_cents) FILTER (WHERE x.status = 'redeemed'), 0)::bigint AS "discountCents",
      COALESCE(SUM(x.commission_cents) FILTER (WHERE x.status = 'redeemed'), 0)::bigint AS "commissionEarnedCents",
      COALESCE(SUM(x.commission_cents) FILTER (WHERE x.status = 'redeemed' AND x.paid_out_at IS NULL), 0)::bigint
        AS "commissionUnpaidCents"
    FROM resellers r
    JOIN "User" u ON u.id = r.user_id
    LEFT JOIN reseller_redemptions x ON x.reseller_id = r.id
    WHERE r.deleted_at IS NULL AND (${resellerId}::uuid IS NULL OR r.id = ${resellerId}::uuid)
    GROUP BY r.id, u.id
    ORDER BY customers DESC, "salesCents" DESC, r.created_at
  `;
  return rows.map((row) => ({
    ...row,
    salesCents: Number(row.salesCents),
    discountCents: Number(row.discountCents),
    commissionEarnedCents: Number(row.commissionEarnedCents),
    commissionUnpaidCents: Number(row.commissionUnpaidCents),
  }));
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return domain ? `${local.slice(0, 2)}***@${domain}` : "***";
}

/** Latest uses of one reseller's code, customer emails masked. */
export async function resellerRecentUses(resellerId: string, limit = 50) {
  const rows = await sql`
    SELECT x.id, x.status, x.base_amount_cents AS "baseAmountCents", x.discount_cents AS "discountCents",
      x.commission_cents AS "commissionCents", x.created_at AS "createdAt", x.redeemed_at AS "redeemedAt",
      x.paid_out_at AS "paidOutAt", u.email
    FROM reseller_redemptions x
    JOIN "User" u ON u.id = x.user_id
    WHERE x.reseller_id = ${resellerId}::uuid AND x.status IN ('pending', 'redeemed')
    ORDER BY x.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(({ email, ...row }) => ({ ...row, customer: maskEmail(String(email)) }));
}

/** The top three resellers for everyone to see, without names or codes. */
export async function topResellers() {
  const rows = await sql`
    SELECT
      COUNT(x.id)::int AS customers,
      COALESCE(SUM(x.base_amount_cents), 0)::bigint AS "salesCents"
    FROM resellers r
    JOIN reseller_redemptions x ON x.reseller_id = r.id AND x.status = 'redeemed'
    WHERE r.deleted_at IS NULL
    GROUP BY r.id
    ORDER BY customers DESC, "salesCents" DESC
    LIMIT 3
  `;
  return rows.map((row, index) => ({ rank: index + 1, customers: row.customers, salesCents: Number(row.salesCents) }));
}
