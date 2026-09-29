import sql from "./db";

/**
 * Discount-wallet rewards granted when a top-up is paid:
 * - top-up promotions ("เติมครบ X ได้ส่วนลด Y บาท/%"), best one only
 * - streamer referral codes, once per customer on their first top-up
 */

type Db = typeof sql;

export type RewardRule = {
  reward_type: "fixed" | "percent";
  reward_value: string | number;
  max_reward_cents: number | null;
};

export type LedgerKind = "satang" | "topup_promotion" | "streamer_code" | "purchase" | "admin";

// Reward in satang for a top-up of baseCents (fixed = baht, percent = % of the top-up).
export function rewardCents(rule: RewardRule, baseCents: number) {
  const value = Number(rule.reward_value);
  const raw = rule.reward_type === "fixed" ? Math.round(value * 100) : Math.floor((baseCents * value) / 100);
  return rule.max_reward_cents ? Math.min(raw, Number(rule.max_reward_cents)) : raw;
}

export async function bestTopupPromotion(db: Db, baseCents: number) {
  const promotions = await db<Array<RewardRule & { id: string; name: string; min_amount_cents: number }>>`
    SELECT id, name, min_amount_cents, reward_type, reward_value, max_reward_cents
    FROM topup_promotions
    WHERE status = 'active' AND deleted_at IS NULL AND min_amount_cents <= ${baseCents}
  `;
  let best: { id: string; name: string; rewardCents: number } | null = null;
  for (const promotion of promotions) {
    const cents = rewardCents(promotion, baseCents);
    if (cents > 0 && (!best || cents > best.rewardCents)) {
      best = { id: promotion.id, name: promotion.name, rewardCents: cents };
    }
  }
  return best;
}

export async function creditDiscount(
  db: Db,
  {
    userId,
    cents,
    kind,
    reason,
    topupId = null,
    subscriptionId = null,
  }: {
    userId: string;
    cents: number;
    kind: LedgerKind;
    reason: string;
    topupId?: string | null;
    subscriptionId?: string | null;
  },
) {
  if (!cents) return null;
  const [user] = await db`
    UPDATE "User"
    SET discount_cents = discount_cents + ${cents}, "updatedAt" = NOW()
    WHERE id = ${userId}
    RETURNING discount_cents
  `;
  await db`
    INSERT INTO discount_ledger (user_id, amount_cents, balance_cents, kind, reason, topup_id, subscription_id)
    VALUES (${userId}, ${cents}, ${user.discount_cents}, ${kind}, ${reason}, ${topupId}, ${subscriptionId})
  `;
  return Number(user.discount_cents);
}

export type StreamerCodeCheck =
  | { ok: true; streamer: RewardRule & { id: string; name: string; code: string } }
  | { ok: false; message: string };

// A code works for an active streamer with quota left, for a customer who has never
// paid a top-up and has never used a streamer code.
export async function checkStreamerCode(db: Db, code: string, userId: string): Promise<StreamerCodeCheck> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { ok: false, message: "กรุณากรอกโค้ด" };

  const [streamer] = await db`
    SELECT s.id, s.name, s.code, s.reward_type, s.reward_value, s.max_reward_cents, s.max_uses,
      (SELECT COUNT(*) FROM streamer_redemptions r
        WHERE r.streamer_id = s.id AND r.status IN ('pending', 'redeemed'))::int AS used
    FROM streamers s
    WHERE UPPER(s.code) = ${normalized} AND s.status = 'active' AND s.deleted_at IS NULL
  `;
  if (!streamer) return { ok: false, message: "ไม่พบโค้ดนี้ หรือโค้ดถูกปิดใช้งานแล้ว" };

  const [history] = await db`
    SELECT
      EXISTS (SELECT 1 FROM point_topups WHERE user_id = ${userId} AND status = 'paid') AS has_paid_topup,
      EXISTS (SELECT 1 FROM streamer_redemptions WHERE user_id = ${userId} AND status = 'redeemed') AS used_code,
      EXISTS (
        SELECT 1 FROM streamer_redemptions r
        JOIN point_topups t ON t.id = r.topup_id
        WHERE r.user_id = ${userId} AND r.status = 'pending' AND t.status = 'pending'
      ) AS code_waiting
  `;
  if (history.used_code) return { ok: false, message: "บัญชีนี้เคยใช้โค้ดสตรีมเมอร์ไปแล้ว (ใช้ได้ 1 ครั้งต่อบัญชี)" };
  if (history.code_waiting) {
    return { ok: false, message: "มีรายการเติมที่ใช้โค้ดรอชำระอยู่ กรุณาชำระ QR เดิม หรือรอให้หมดอายุก่อน" };
  }
  if (history.has_paid_topup) return { ok: false, message: "โค้ดนี้ใช้ได้เฉพาะการเติมครั้งแรกของบัญชีใหม่เท่านั้น" };
  if (streamer.max_uses && Number(streamer.used) >= Number(streamer.max_uses)) {
    return { ok: false, message: "โค้ดนี้ถูกใช้ครบจำนวนแล้ว" };
  }
  return { ok: true, streamer: streamer as StreamerCodeCheck extends { ok: true; streamer: infer S } ? S : never };
}

// Pending redemptions of top-ups that were never paid free the customer's one use again.
export async function voidUnpaidRedemptions(db: Db) {
  await db`
    UPDATE streamer_redemptions r
    SET status = 'void'
    FROM point_topups t
    WHERE r.status = 'pending' AND t.id = r.topup_id AND t.status IN ('expired', 'cancelled', 'failed')
  `;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateStreamerCode(name: string) {
  const prefix = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 6);
  const suffix = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  return `${prefix || "FM"}${suffix}`;
}
