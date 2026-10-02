import sql from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import { generateStreamerCode } from "./rewards";

/**
 * Resellers ("ตัวแทนจำหน่าย"): customer accounts with their own code. A customer may
 * use a given reseller's code once, on a top-up: the transfer gets
 * reseller_discount_percent off (app setting, default 5%) and, once the top-up is
 * paid, the reseller earns their commission_cents (default ฿0.25) — never as points.
 * "ยอดขาย" is the number of customers. An admin cuts earned commission into payouts
 * per cycle (reseller_payout_cycle: weekly from Monday / monthly from the 1st, Bangkok
 * time), transfers it to the reseller's bank account and approves the payout.
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
  /** ยอดขาย: customers whose top-up with this code was paid. */
  customers: number;
  pending: number;
  topupCents: number;
  discountCents: number;
  /** All commission earned (ค่าคอมทั้งหมด). */
  commissionEarnedCents: number;
  /** Earned but not cut into a payout yet (ยังไม่ถึงรอบ). */
  commissionOpenCents: number;
  /** Cut into payouts waiting for the admin's transfer (รอโอน). */
  commissionPendingCents: number;
  /** Approved payouts (โอนแล้ว). */
  commissionPaidCents: number;
  hasBank: boolean;
};

/** Sales per reseller (paid uses only). `resellerId` narrows it to one reseller. */
export async function resellerStats(resellerId: string | null = null): Promise<ResellerStat[]> {
  const rows = await sql<ResellerStat[]>`
    SELECT
      r.id, r.code, r.commission_cents AS "commissionCents", r.max_uses AS "maxUses", r.status,
      r.created_at AS "createdAt", u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
      (r.bank_account_number_ciphertext IS NOT NULL) AS "hasBank",
      COUNT(x.id) FILTER (WHERE x.status = 'redeemed')::int AS customers,
      COUNT(x.id) FILTER (WHERE x.status = 'pending')::int AS pending,
      COALESCE(SUM(x.base_amount_cents) FILTER (WHERE x.status = 'redeemed'), 0)::bigint AS "topupCents",
      COALESCE(SUM(x.discount_cents) FILTER (WHERE x.status = 'redeemed'), 0)::bigint AS "discountCents",
      COALESCE(SUM(x.commission_cents) FILTER (WHERE x.status = 'redeemed'), 0)::bigint AS "commissionEarnedCents",
      COALESCE(SUM(x.commission_cents) FILTER (WHERE x.status = 'redeemed' AND x.payout_id IS NULL), 0)::bigint
        AS "commissionOpenCents",
      COALESCE(SUM(x.commission_cents) FILTER (WHERE x.status = 'redeemed' AND p.status = 'pending'), 0)::bigint
        AS "commissionPendingCents",
      COALESCE(SUM(x.commission_cents) FILTER (WHERE x.status = 'redeemed' AND p.status = 'approved'), 0)::bigint
        AS "commissionPaidCents"
    FROM resellers r
    JOIN "User" u ON u.id = r.user_id
    LEFT JOIN reseller_redemptions x ON x.reseller_id = r.id
    LEFT JOIN reseller_payouts p ON p.id = x.payout_id
    WHERE r.deleted_at IS NULL AND (${resellerId}::uuid IS NULL OR r.id = ${resellerId}::uuid)
    GROUP BY r.id, u.id
    ORDER BY customers DESC, "topupCents" DESC, r.created_at
  `;
  return rows.map((row) => ({
    ...row,
    topupCents: Number(row.topupCents),
    discountCents: Number(row.discountCents),
    commissionEarnedCents: Number(row.commissionEarnedCents),
    commissionOpenCents: Number(row.commissionOpenCents),
    commissionPendingCents: Number(row.commissionPendingCents),
    commissionPaidCents: Number(row.commissionPaidCents),
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
      p.status AS "payoutStatus", u.email
    FROM reseller_redemptions x
    JOIN "User" u ON u.id = x.user_id
    LEFT JOIN reseller_payouts p ON p.id = x.payout_id
    WHERE x.reseller_id = ${resellerId}::uuid AND x.status IN ('pending', 'redeemed')
    ORDER BY x.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(({ email, ...row }) => ({ ...row, customer: maskEmail(String(email)) }));
}

/** The top three resellers for everyone to see, without names or codes. */
export async function topResellers() {
  const rows = await sql`
    SELECT COUNT(x.id)::int AS customers, MIN(x.redeemed_at) AS first_sale
    FROM resellers r
    JOIN reseller_redemptions x ON x.reseller_id = r.id AND x.status = 'redeemed'
    WHERE r.deleted_at IS NULL
    GROUP BY r.id
    ORDER BY customers DESC, first_sale
    LIMIT 3
  `;
  return rows.map((row, index) => ({ rank: index + 1, customers: Number(row.customers) }));
}

// ─── Bank account for payouts ───

export const THAI_BANKS = [
  "พร้อมเพย์ (PromptPay)",
  "กสิกรไทย (KBANK)",
  "ไทยพาณิชย์ (SCB)",
  "กรุงเทพ (BBL)",
  "กรุงไทย (KTB)",
  "กรุงศรีอยุธยา (BAY)",
  "ทหารไทยธนชาต (ttb)",
  "ออมสิน (GSB)",
  "ธ.ก.ส. (BAAC)",
  "อาคารสงเคราะห์ (GHB)",
  "ยูโอบี (UOB)",
  "ซีไอเอ็มบี ไทย (CIMB)",
  "เกียรตินาคินภัทร (KKP)",
  "ทิสโก้ (TISCO)",
  "แลนด์ แอนด์ เฮ้าส์ (LH Bank)",
  "ไอซีบีซี (ไทย) (ICBC)",
] as const;

export function maskAccountNumber(number: string) {
  const digits = number.replace(/\D/g, "");
  return digits.length > 4 ? `${"x".repeat(digits.length - 4)}${digits.slice(-4)}` : digits;
}

export async function saveResellerBank(
  userId: string,
  { bankName, accountName, accountNumber }: { bankName?: string; accountName?: string; accountNumber?: string },
) {
  const bank = THAI_BANKS.find((name) => name === bankName);
  const holder = accountName?.trim();
  const number = (accountNumber ?? "").replace(/[\s-]/g, "");
  if (!bank) return "กรุณาเลือกธนาคาร";
  if (!holder) return "กรุณาใส่ชื่อบัญชี";
  if (!/^\d{10,15}$/.test(number)) return "เลขบัญชีต้องเป็นตัวเลข 10-15 หลัก";
  const [reseller] = await sql`
    UPDATE resellers
    SET bank_name = ${bank}, bank_account_name = ${holder},
        bank_account_number_ciphertext = ${encryptSecret(number)}, bank_updated_at = NOW(), updated_at = NOW()
    WHERE user_id = ${userId} AND deleted_at IS NULL
    RETURNING id
  `;
  return reseller ? null : "บัญชีนี้ไม่ได้เป็นตัวแทนจำหน่าย";
}

export async function resellerBank(resellerId: string) {
  const [row] = await sql`
    SELECT bank_name, bank_account_name, bank_account_number_ciphertext FROM resellers WHERE id = ${resellerId}::uuid
  `;
  if (!row?.bank_account_number_ciphertext) return null;
  const number = decryptSecret(row.bank_account_number_ciphertext) ?? "";
  return { bankName: row.bank_name as string, accountName: row.bank_account_name as string, accountNumber: number };
}

// ─── Payout cycle and cut-off ───

export type PayoutCycle = "weekly" | "monthly";

export async function getPayoutCycle(): Promise<PayoutCycle> {
  const [row] = await sql`SELECT value FROM app_settings WHERE key = 'reseller_payout_cycle'`;
  return row?.value === "weekly" ? "weekly" : "monthly";
}

export async function setPayoutCycle(cycle: PayoutCycle) {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('reseller_payout_cycle', ${sql.json(cycle)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

/** Start of the current cycle in Bangkok time: this Monday 00:00 or the 1st 00:00. */
export async function currentCycleStart(cycle: PayoutCycle) {
  const [row] = await sql`
    SELECT (
      date_trunc(${cycle === "weekly" ? "week" : "month"}, NOW() AT TIME ZONE 'Asia/Bangkok')
      AT TIME ZONE 'Asia/Bangkok'
    ) AS start
  `;
  return new Date(row.start);
}

/**
 * Cuts everything earned before the current cycle into one pending payout per
 * reseller, with a snapshot of their bank account. Returns the payouts made.
 */
export async function cutResellerPayouts(adminUserId: string | null) {
  const cycle = await getPayoutCycle();
  const cutoff = await currentCycleStart(cycle);
  return sql.begin(async (tx) => {
    // One cut at a time, so two admins clicking together cannot pay the same commission twice.
    await tx`SELECT pg_advisory_xact_lock(hashtext('reseller_payout_cut'))`;
    const due = await tx`
      SELECT x.reseller_id, COUNT(*)::int AS customers, SUM(x.commission_cents)::int AS amount_cents,
        r.bank_name, r.bank_account_name, r.bank_account_number_ciphertext
      FROM reseller_redemptions x
      JOIN resellers r ON r.id = x.reseller_id
      WHERE x.status = 'redeemed' AND x.payout_id IS NULL AND x.redeemed_at < ${cutoff}
      GROUP BY x.reseller_id, r.id
    `;
    const made: Array<{ id: string; resellerId: string; amountCents: number }> = [];
    for (const row of due) {
      const [payout] = await tx`
        INSERT INTO reseller_payouts (
          reseller_id, period_end, customers, amount_cents, bank_name, bank_account_name,
          bank_account_number_ciphertext, created_by
        )
        VALUES (
          ${row.reseller_id}, ${cutoff}, ${row.customers}, ${row.amount_cents}, ${row.bank_name},
          ${row.bank_account_name}, ${row.bank_account_number_ciphertext}, ${adminUserId}
        )
        RETURNING id
      `;
      await tx`
        UPDATE reseller_redemptions SET payout_id = ${payout.id}
        WHERE reseller_id = ${row.reseller_id} AND status = 'redeemed' AND payout_id IS NULL AND redeemed_at < ${cutoff}
      `;
      made.push({ id: payout.id, resellerId: row.reseller_id, amountCents: Number(row.amount_cents) });
    }
    return { cycle, cutoff, payouts: made };
  });
}

export type ResellerPayout = {
  id: string;
  resellerId: string;
  userName: string;
  userEmail: string;
  code: string;
  periodEnd: Date;
  customers: number;
  amountCents: number;
  status: "pending" | "approved";
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  createdAt: Date;
  approvedAt: Date | null;
};

/** Payouts, newest first; account numbers are shown in full only when `fullAccount`. */
export async function listResellerPayouts({
  resellerId = null,
  fullAccount = false,
}: { resellerId?: string | null; fullAccount?: boolean } = {}): Promise<ResellerPayout[]> {
  const rows = await sql`
    SELECT p.id, p.reseller_id, u.name, u.email, r.code, p.period_end, p.customers, p.amount_cents, p.status,
      p.bank_name, p.bank_account_name, p.bank_account_number_ciphertext, p.created_at, p.approved_at
    FROM reseller_payouts p
    JOIN resellers r ON r.id = p.reseller_id
    JOIN "User" u ON u.id = r.user_id
    WHERE (${resellerId}::uuid IS NULL OR p.reseller_id = ${resellerId}::uuid)
    ORDER BY (p.status = 'pending') DESC, p.created_at DESC
    LIMIT 200
  `;
  return rows.map((row) => {
    const number = row.bank_account_number_ciphertext ? decryptSecret(row.bank_account_number_ciphertext) ?? "" : null;
    return {
      id: row.id,
      resellerId: row.reseller_id,
      userName: row.name,
      userEmail: row.email,
      code: row.code,
      periodEnd: row.period_end,
      customers: Number(row.customers),
      amountCents: Number(row.amount_cents),
      status: row.status,
      bankName: row.bank_name,
      bankAccountName: row.bank_account_name,
      bankAccountNumber: number === null ? null : fullAccount ? number : maskAccountNumber(number),
      createdAt: row.created_at,
      approvedAt: row.approved_at,
    };
  });
}

export async function approveResellerPayout(payoutId: string, adminUserId: string | null) {
  const [payout] = await sql`
    UPDATE reseller_payouts SET status = 'approved', approved_by = ${adminUserId}, approved_at = NOW()
    WHERE id = ${payoutId}::uuid AND status = 'pending'
    RETURNING id, amount_cents
  `;
  return payout ?? null;
}
