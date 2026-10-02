import { Hono } from "hono";
import sql from "../db";
import { getAdminSession } from "../adminAuth";
import { pushToGroups } from "../libs/line-bot";
import {
  DEFAULT_RESELLER_COMMISSION_CENTS,
  approveResellerPayout,
  cutResellerPayouts,
  getPayoutCycle,
  getResellerDiscountPercent,
  listResellerPayouts,
  newResellerCode,
  referralCodeTaken,
  resellerBank,
  resellerRecentUses,
  resellerStats,
  setPayoutCycle,
  setResellerDiscountPercent,
} from "../resellers";

/** Admin management of resellers and reseller managers (mounted under /admin). */
const adminResellers = new Hono();

function cleanCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

function referralLink(code: string) {
  const origin = (process.env.WEB_ORIGIN ?? "").replace(/\/+$/, "");
  return `${origin}/payment?code=${encodeURIComponent(code)}`;
}

// The picker sends the chosen user's id; a typed name/email still works as a fallback.
async function pickUser(userId: string | undefined, query: string | undefined) {
  if (userId) {
    const [user] = await sql`SELECT id, name, email FROM "User" WHERE id = ${userId}`;
    return user ? { user } : { error: "ไม่พบผู้ใช้ที่เลือก" };
  }
  return findUser(query);
}

// Finds one customer account by exact email, else by name; an error message when it is not exactly one.
async function findUser(query: string | undefined) {
  const value = query?.trim();
  if (!value) return { error: "กรุณาใส่ชื่อหรืออีเมลของผู้ใช้" };
  const byEmail = await sql`SELECT id, name, email FROM "User" WHERE LOWER(email) = LOWER(${value})`;
  if (byEmail.length === 1) return { user: byEmail[0] };
  const byName = await sql`
    SELECT id, name, email FROM "User"
    WHERE LOWER(name) = LOWER(${value}) OR name ILIKE ${`%${value}%`} OR email ILIKE ${`%${value}%`}
    ORDER BY (LOWER(name) = LOWER(${value})) DESC, "createdAt"
    LIMIT 6
  `;
  const exact = byName.filter((user) => String(user.name).toLowerCase() === value.toLowerCase());
  if (exact.length === 1) return { user: exact[0] };
  if (byName.length === 1) return { user: byName[0] };
  if (!byName.length) return { error: `ไม่พบผู้ใช้ "${value}"` };
  return {
    error: `พบผู้ใช้หลายคน กรุณาใช้อีเมลแทน: ${byName.slice(0, 5).map((user) => `${user.name} (${user.email})`).join(", ")}`,
  };
}

function parseCommission(value: unknown) {
  const baht = Number(value);
  if (!Number.isFinite(baht) || baht < 0 || baht > 100000) return null;
  return Math.round(baht * 100);
}

function parseMaxUses(value: unknown): number | null | "invalid" {
  if (value === null || value === "" || value === undefined) return null;
  const maxUses = Number(value);
  return Number.isInteger(maxUses) && maxUses >= 1 ? maxUses : "invalid";
}

// Search box of the reseller / manager pickers.
adminResellers.get("/reseller-user-search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 1) return c.json({ users: [] });
  const users = await sql`
    SELECT u.id, u.name, u.email, u.image, u.is_reseller_manager AS "isResellerManager",
      EXISTS (SELECT 1 FROM resellers r WHERE r.user_id = u.id AND r.deleted_at IS NULL) AS "isReseller"
    FROM "User" u
    WHERE u.status = 'active' AND (u.name ILIKE ${`%${q}%`} OR u.email ILIKE ${`%${q}%`})
    ORDER BY (LOWER(u.email) = LOWER(${q}) OR LOWER(u.name) = LOWER(${q})) DESC, u.name
    LIMIT 10
  `;
  return c.json({ users });
});

adminResellers.get("/resellers", async (c) => {
  const [resellers, managers, discountPercent, payoutCycle, payouts] = await Promise.all([
    resellerStats(),
    sql`SELECT id, name, email FROM "User" WHERE is_reseller_manager ORDER BY name`,
    getResellerDiscountPercent(),
    getPayoutCycle(),
    listResellerPayouts({ fullAccount: true }),
  ]);
  return c.json({
    discountPercent,
    payoutCycle,
    resellers: resellers.map((row) => ({ ...row, referralLink: referralLink(String(row.code)) })),
    managers,
    payouts,
  });
});

adminResellers.get("/resellers/:id/uses", async (c) => {
  const id = c.req.param("id");
  const [uses, bank] = await Promise.all([resellerRecentUses(id), resellerBank(id)]);
  return c.json({ uses, bank });
});

adminResellers.post("/resellers", async (c) => {
  const body = await c.req.json<{ userId?: string; user?: string; commission?: number; maxUses?: number | null; code?: string }>();
  const found = await pickUser(body.userId, body.user);
  if ("error" in found) return c.json({ message: found.error }, 400);

  const commission = body.commission === undefined ? DEFAULT_RESELLER_COMMISSION_CENTS : parseCommission(body.commission);
  if (commission === null) return c.json({ message: "ค่าคอมต้องเป็นตัวเลข 0 ขึ้นไป (บาท)" }, 400);
  const maxUses = parseMaxUses(body.maxUses);
  if (maxUses === "invalid") return c.json({ message: "จำนวนคนที่ใช้ได้ต้องเป็นจำนวนเต็ม 1 ขึ้นไป (เว้นว่าง = ไม่จำกัด)" }, 400);

  const [existing] = await sql`SELECT id FROM resellers WHERE user_id = ${found.user.id} AND deleted_at IS NULL`;
  if (existing) return c.json({ message: `${found.user.name} เป็นตัวแทนอยู่แล้ว` }, 400);

  const requested = body.code ? cleanCode(body.code) : "";
  if (requested && (await referralCodeTaken(requested))) return c.json({ message: `โค้ด ${requested} ถูกใช้แล้ว` }, 400);
  const code = requested || (await newResellerCode(String(found.user.name)));

  const [reseller] = await sql`
    INSERT INTO resellers (user_id, code, commission_cents, max_uses)
    VALUES (${found.user.id}, ${code}, ${commission}, ${maxUses})
    RETURNING id, code
  `;
  return c.json({ ...reseller, user: found.user, referralLink: referralLink(reseller.code) }, 201);
});

adminResellers.patch("/resellers/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    commission?: number;
    maxUses?: number | null;
    status?: "active" | "inactive";
    code?: string;
    regenerateCode?: boolean;
  }>();
  const columns: Record<string, unknown> = {};
  if (body.commission !== undefined) {
    const commission = parseCommission(body.commission);
    if (commission === null) return c.json({ message: "ค่าคอมต้องเป็นตัวเลข 0 ขึ้นไป (บาท)" }, 400);
    columns.commission_cents = commission;
  }
  if (body.maxUses !== undefined) {
    const maxUses = parseMaxUses(body.maxUses);
    if (maxUses === "invalid") return c.json({ message: "จำนวนคนที่ใช้ได้ต้องเป็นจำนวนเต็ม 1 ขึ้นไป (เว้นว่าง = ไม่จำกัด)" }, 400);
    columns.max_uses = maxUses;
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "inactive") return c.json({ message: "สถานะไม่ถูกต้อง" }, 400);
    columns.status = body.status;
  }
  if (body.regenerateCode) {
    const [current] = await sql`
      SELECT u.name FROM resellers r JOIN "User" u ON u.id = r.user_id WHERE r.id = ${id}::uuid
    `;
    columns.code = await newResellerCode(String(current?.name ?? ""));
  } else if (body.code) {
    const code = cleanCode(body.code);
    if (await referralCodeTaken(code, id)) return c.json({ message: `โค้ด ${code} ถูกใช้แล้ว` }, 400);
    columns.code = code;
  }
  if (!Object.keys(columns).length) return c.json({ message: "Nothing to update" }, 400);

  const [reseller] = await sql`
    UPDATE resellers SET ${sql(columns)}, updated_at = NOW()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
    RETURNING id, code
  `;
  if (!reseller) return c.json({ message: "ไม่พบตัวแทนนี้" }, 404);
  return c.json({ ...reseller, referralLink: referralLink(reseller.code) });
});

adminResellers.delete("/resellers/:id", async (c) => {
  const [reseller] = await sql`
    UPDATE resellers SET deleted_at = NOW(), status = 'inactive', updated_at = NOW()
    WHERE id = ${c.req.param("id")}::uuid AND deleted_at IS NULL
    RETURNING id
  `;
  if (!reseller) return c.json({ message: "ไม่พบตัวแทนนี้" }, 404);
  return c.json({ ok: true });
});

// Cuts commission earned before the current weekly/monthly cycle into pending payouts.
adminResellers.post("/reseller-payouts/cut", async (c) => {
  const admin = await getAdminSession(c);
  const result = await cutResellerPayouts(admin?.id ?? null);
  return c.json({
    cycle: result.cycle,
    cutoff: result.cutoff,
    count: result.payouts.length,
    totalCents: result.payouts.reduce((sum, payout) => sum + payout.amountCents, 0),
  });
});

// The admin has transferred the payout to the reseller's bank account.
adminResellers.post("/reseller-payouts/:id/approve", async (c) => {
  const admin = await getAdminSession(c);
  const payout = await approveResellerPayout(c.req.param("id"), admin?.id ?? null);
  if (!payout) return c.json({ message: "ไม่พบรายการ หรืออนุมัติไปแล้ว" }, 404);
  const [row] = await sql`
    SELECT u.name, u.email FROM reseller_payouts p JOIN resellers r ON r.id = p.reseller_id
    JOIN "User" u ON u.id = r.user_id WHERE p.id = ${payout.id}
  `;
  void pushToGroups(
    [
      "✅ โอนค่าคอมตัวแทนแล้ว",
      `ตัวแทน: ${row?.name} (${row?.email})`,
      `ยอด: ฿${(Number(payout.amount_cents) / 100).toFixed(2)}`,
      `อนุมัติโดย: ${admin?.name ?? "admin"}`,
    ].join("\n"),
  ).catch(() => {});
  return c.json({ ok: true });
});

adminResellers.put("/reseller-settings", async (c) => {
  const body = await c.req.json<{ discountPercent?: number; payoutCycle?: string }>();
  if (body.discountPercent !== undefined) {
    const percent = Number(body.discountPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return c.json({ message: "ส่วนลดต้องอยู่ระหว่าง 0-100%" }, 400);
    }
    await setResellerDiscountPercent(Math.round(percent * 100) / 100);
  }
  if (body.payoutCycle !== undefined) {
    if (body.payoutCycle !== "weekly" && body.payoutCycle !== "monthly") {
      return c.json({ message: "รอบตัดยอดต้องเป็นรายสัปดาห์หรือรายเดือน" }, 400);
    }
    await setPayoutCycle(body.payoutCycle);
  }
  return c.json({ discountPercent: await getResellerDiscountPercent(), payoutCycle: await getPayoutCycle() });
});

adminResellers.post("/reseller-managers", async (c) => {
  const body = await c.req.json<{ userId?: string; user?: string }>();
  const found = await pickUser(body.userId, body.user);
  if ("error" in found) return c.json({ message: found.error }, 400);
  await sql`UPDATE "User" SET is_reseller_manager = TRUE, "updatedAt" = NOW() WHERE id = ${found.user.id}`;
  return c.json({ user: found.user }, 201);
});

adminResellers.delete("/reseller-managers/:userId", async (c) => {
  await sql`UPDATE "User" SET is_reseller_manager = FALSE, "updatedAt" = NOW() WHERE id = ${c.req.param("userId")}`;
  return c.json({ ok: true });
});

export default adminResellers;
