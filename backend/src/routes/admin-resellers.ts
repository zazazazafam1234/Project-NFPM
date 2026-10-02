import { Hono } from "hono";
import sql from "../db";
import {
  DEFAULT_RESELLER_COMMISSION_CENTS,
  getResellerDiscountPercent,
  newResellerCode,
  referralCodeTaken,
  resellerRecentUses,
  resellerStats,
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

adminResellers.get("/resellers", async (c) => {
  const [resellers, managers, discountPercent] = await Promise.all([
    resellerStats(),
    sql`SELECT id, name, email FROM "User" WHERE is_reseller_manager ORDER BY name`,
    getResellerDiscountPercent(),
  ]);
  return c.json({
    discountPercent,
    resellers: resellers.map((row) => ({ ...row, referralLink: referralLink(String(row.code)) })),
    managers,
  });
});

adminResellers.get("/resellers/:id/uses", async (c) => {
  return c.json({ uses: await resellerRecentUses(c.req.param("id")) });
});

adminResellers.post("/resellers", async (c) => {
  const body = await c.req.json<{ user?: string; commission?: number; maxUses?: number | null; code?: string }>();
  const found = await findUser(body.user);
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

// Admin transferred the commission by hand: everything earned so far is marked paid.
adminResellers.post("/resellers/:id/payout", async (c) => {
  const [paid] = await sql`
    WITH paid AS (
      UPDATE reseller_redemptions
      SET paid_out_at = NOW()
      WHERE reseller_id = ${c.req.param("id")}::uuid AND status = 'redeemed' AND paid_out_at IS NULL
      RETURNING commission_cents
    )
    SELECT COUNT(*)::int AS uses, COALESCE(SUM(commission_cents), 0)::bigint AS cents FROM paid
  `;
  return c.json({ uses: paid.uses, paidCents: Number(paid.cents) });
});

adminResellers.put("/reseller-settings", async (c) => {
  const body = await c.req.json<{ discountPercent?: number }>();
  const percent = Number(body.discountPercent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return c.json({ message: "ส่วนลดต้องอยู่ระหว่าง 0-100%" }, 400);
  }
  await setResellerDiscountPercent(Math.round(percent * 100) / 100);
  return c.json({ discountPercent: await getResellerDiscountPercent() });
});

adminResellers.post("/reseller-managers", async (c) => {
  const body = await c.req.json<{ user?: string }>();
  const found = await findUser(body.user);
  if ("error" in found) return c.json({ message: found.error }, 400);
  await sql`UPDATE "User" SET is_reseller_manager = TRUE, "updatedAt" = NOW() WHERE id = ${found.user.id}`;
  return c.json({ user: found.user }, 201);
});

adminResellers.delete("/reseller-managers/:userId", async (c) => {
  await sql`UPDATE "User" SET is_reseller_manager = FALSE, "updatedAt" = NOW() WHERE id = ${c.req.param("userId")}`;
  return c.json({ ok: true });
});

export default adminResellers;
