import { Hono } from "hono";
import sql from "../db";
import { getSessionUserId } from "../session";
import { adminLink, pushToGroups } from "../libs/line-bot";
import {
  DEFAULT_RESELLER_COMMISSION_CENTS,
  THAI_BANKS,
  createReseller,
  listResellerRequests,
  parseMaxUses,
  searchUsersForResellers,
  getPayoutCycle,
  getResellerDiscountPercent,
  listResellerPayouts,
  maskAccountNumber,
  resellerBank,
  resellerRecentUses,
  resellerStats,
  saveResellerBank,
  topResellers,
} from "../resellers";

/**
 * Reseller pages: the anonymous top 3 for everyone, a reseller's own sales, and every
 * reseller's sales for reseller managers (and admins).
 */
const resellers = new Hono();

function referralLink(code: string) {
  const origin = (process.env.WEB_ORIGIN ?? "").replace(/\/+$/, "");
  return `${origin}/payment?code=${encodeURIComponent(code)}`;
}

// Reseller managers (and admins) only; null otherwise.
async function managerOf(c: Parameters<typeof getSessionUserId>[0]) {
  const userId = await getSessionUserId(c);
  if (!userId) return null;
  const [user] = await sql`
    SELECT id, name, role, is_reseller_manager FROM "User" WHERE id = ${userId} AND status = 'active'
  `;
  return user && (user.is_reseller_manager || user.role === "admin") ? user : null;
}

resellers.get("/top", async (c) => {
  return c.json({ top: await topResellers() });
});

resellers.get("/me", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const [user] = await sql`
    SELECT u.role, u.is_reseller_manager,
      (SELECT r.id FROM resellers r WHERE r.user_id = u.id AND r.deleted_at IS NULL AND r.approval = 'approved') AS reseller_id
    FROM "User" u
    WHERE u.id = ${userId} AND u.status = 'active'
  `;
  if (!user) return c.json({ message: "ไม่พบบัญชีผู้ใช้" }, 404);

  const isManager = Boolean(user.is_reseller_manager) || user.role === "admin";
  const [discountPercent, payoutCycle] = await Promise.all([getResellerDiscountPercent(), getPayoutCycle()]);
  const own = user.reseller_id ? (await resellerStats(user.reseller_id))[0] ?? null : null;
  const bank = own ? await resellerBank(user.reseller_id) : null;

  return c.json({
    discountPercent,
    payoutCycle,
    banks: THAI_BANKS,
    isManager,
    reseller: own
      ? {
          ...own,
          referralLink: referralLink(String(own.code)),
          uses: await resellerRecentUses(user.reseller_id),
          payouts: await listResellerPayouts({ resellerId: user.reseller_id }),
          bank: bank ? { ...bank, accountNumber: maskAccountNumber(bank.accountNumber) } : null,
        }
      : null,
    all: isManager ? await resellerStats() : null,
    // Managers: their requests, and every cut-off with masked account numbers (read-only).
    requests: isManager ? await listResellerRequests({ requestedBy: userId }) : null,
    payouts: isManager ? await listResellerPayouts() : null,
  });
});

resellers.get("/user-search", async (c) => {
  if (!(await managerOf(c))) return c.json({ message: "เฉพาะคนดูแลตัวแทนจำหน่าย" }, 403);
  return c.json({ users: await searchUsersForResellers((c.req.query("q") ?? "").trim()) });
});

// A manager asks for someone to become a reseller; it waits for an admin's approval.
resellers.post("/requests", async (c) => {
  const manager = await managerOf(c);
  if (!manager) return c.json({ message: "เฉพาะคนดูแลตัวแทนจำหน่าย" }, 403);
  const body = await c.req.json<{ userId?: string; maxUses?: number | null }>();
  if (!body.userId) return c.json({ message: "กรุณาเลือกผู้ใช้" }, 400);
  // Commission is the admin's call: requests start at the default and only admins change it.
  const commission = DEFAULT_RESELLER_COMMISSION_CENTS;
  const maxUses = parseMaxUses(body.maxUses);
  if (maxUses === "invalid") return c.json({ message: "จำนวนคนที่ใช้ได้ต้องเป็นจำนวนเต็ม 1 ขึ้นไป (เว้นว่าง = ไม่จำกัด)" }, 400);

  const created = await createReseller({ userId: body.userId, commissionCents: commission, maxUses, requestedBy: manager.id });
  if ("error" in created) return c.json({ message: created.error }, 400);
  void pushToGroups(
    [
      "📝 คำขอเพิ่มตัวแทนจำหน่าย รออนุมัติ",
      `ผู้ขอ: ${manager.name}`,
      `ตัวแทน: ${created.user.name} (${created.user.email})`,
      `ค่าคอม: ฿${(commission / 100).toFixed(2)}${maxUses ? ` · จำกัด ${maxUses} คน` : ""}`,
      `👉 อนุมัติ: ${adminLink("resellers") || "หลังบ้าน → ตัวแทนจำหน่าย"}`,
    ].join("\n"),
  ).catch(() => {});
  return c.json({ id: created.reseller.id }, 201);
});

// Read-only details of one reseller for managers (customer emails masked, no bank number).
resellers.get("/:id/uses", async (c) => {
  if (!(await managerOf(c))) return c.json({ message: "เฉพาะคนดูแลตัวแทนจำหน่าย" }, 403);
  return c.json({ uses: await resellerRecentUses(c.req.param("id")) });
});

resellers.put("/me/bank", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);
  const body = await c.req.json<{ bankName?: string; accountName?: string; accountNumber?: string }>();
  const error = await saveResellerBank(userId, body);
  if (error) return c.json({ message: error }, 400);
  return c.json({ ok: true });
});

export default resellers;
