import { Hono } from "hono";
import sql from "../db";
import { getSessionUserId } from "../session";
import { getResellerDiscountPercent, resellerRecentUses, resellerStats, topResellers } from "../resellers";

/**
 * Reseller pages: the anonymous top 3 for everyone, a reseller's own sales, and every
 * reseller's sales for reseller managers (and admins).
 */
const resellers = new Hono();

function referralLink(code: string) {
  const origin = (process.env.WEB_ORIGIN ?? "").replace(/\/+$/, "");
  return `${origin}/payment?code=${encodeURIComponent(code)}`;
}

resellers.get("/top", async (c) => {
  return c.json({ top: await topResellers() });
});

resellers.get("/me", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const [user] = await sql`
    SELECT u.role, u.is_reseller_manager,
      (SELECT r.id FROM resellers r WHERE r.user_id = u.id AND r.deleted_at IS NULL) AS reseller_id
    FROM "User" u
    WHERE u.id = ${userId} AND u.status = 'active'
  `;
  if (!user) return c.json({ message: "ไม่พบบัญชีผู้ใช้" }, 404);

  const isManager = Boolean(user.is_reseller_manager) || user.role === "admin";
  const discountPercent = await getResellerDiscountPercent();
  const own = user.reseller_id ? (await resellerStats(user.reseller_id))[0] ?? null : null;

  return c.json({
    discountPercent,
    isManager,
    reseller: own
      ? {
          ...own,
          referralLink: referralLink(String(own.code)),
          uses: await resellerRecentUses(user.reseller_id),
        }
      : null,
    all: isManager ? await resellerStats() : null,
  });
});

export default resellers;
