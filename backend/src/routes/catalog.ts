import { Hono } from "hono";
import sql from "../db";

const catalog = new Hono();

const PLAN_TAGS: Record<string, string> = {
  day: "เริ่มต้นง่าย",
  week: "คุ้มค่า",
  month: "ขายดี",
};

const ADMIN_KEY = process.env.ADMIN_KEY;
const isAdmin = (c: { req: { header: (h: string) => string | undefined } }) =>
  Boolean(ADMIN_KEY) && c.req.header("x-admin-key") === ADMIN_KEY;

// ─── Streaming Packages ─────────────────────────────────────────

catalog.get("/packages", async (c) => {
  const rows = await sql`
    SELECT
      pkg.id,
      pkg.slug,
      pkg.name,
      pkg.service,
      pkg.description,
      pkg.duration_days,
      pkg.price_amount,
      pkg.currency,
      pkg.status,
      COUNT(p.id)::int AS "availableStock"
    FROM packages pkg
    LEFT JOIN master_emails me
      ON me.service = pkg.service
      AND me.status = 'active'
      AND me.deleted_at IS NULL
      AND me.master_expired_at >= NOW() + (pkg.duration_days || ' days')::interval
    LEFT JOIN profiles p
      ON p.master_email_id = me.id
      AND p.status = 'available'
      AND p.deleted_at IS NULL
      AND (p.profile_expires_at IS NULL OR p.profile_expires_at >= NOW() + (pkg.duration_days || ' days')::interval)
      AND NOT EXISTS (
        SELECT 1
        FROM subscriptions s
        WHERE s.profile_id = p.id
          AND s.status IN ('pending', 'active')
          AND s.expires_at > NOW()
      )
    WHERE pkg.status = 'active'
      AND pkg.deleted_at IS NULL
    GROUP BY pkg.id
    ORDER BY pkg.sort_order, pkg.price_amount
  `;

  return c.json(
    rows.map((pkg) => ({
      id: pkg.id,
      slug: pkg.slug,
      name: pkg.name,
      service: pkg.service,
      description: pkg.description,
      durationDays: pkg.duration_days,
      priceAmount: pkg.price_amount,
      currency: pkg.currency,
      status: pkg.status,
      availableStock: pkg.availableStock,
    })),
  );
});

catalog.get("/streaming-rooms", async (c) => {
  const service = c.req.query("service");
  const [rooms, profiles, packages, activeSubscriptions] = await Promise.all([
    sql`
      SELECT
        me.id,
        me.service,
        me.status,
        me.master_expired_at,
        me.note,
        COUNT(p.id)::int AS "profileCount"
      FROM master_emails me
      LEFT JOIN profiles p
        ON p.master_email_id = me.id
        AND p.deleted_at IS NULL
      WHERE me.deleted_at IS NULL
        AND me.status = 'active'
        AND me.master_expired_at > NOW()
        AND (${service ?? null}::text IS NULL OR me.service = ${service ?? null})
      GROUP BY me.id
      ORDER BY me.master_expired_at ASC, me.created_at ASC
      LIMIT 80
    `,
    sql`
      SELECT
        p.id,
        p.master_email_id,
        p.profile_name,
        p.status,
        p.profile_expires_at
      FROM profiles p
      JOIN master_emails me ON me.id = p.master_email_id
      WHERE p.deleted_at IS NULL
        AND me.deleted_at IS NULL
        AND me.status = 'active'
        AND me.master_expired_at > NOW()
        AND (${service ?? null}::text IS NULL OR me.service = ${service ?? null})
      ORDER BY p.master_email_id, p.profile_name
    `,
    sql`
      SELECT
        id,
        slug,
        name,
        service,
        description,
        duration_days,
        price_amount,
        currency,
        status
      FROM packages
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND (${service ?? null}::text IS NULL OR service = ${service ?? null})
      ORDER BY sort_order, price_amount
    `,
    sql`
      SELECT profile_id
      FROM subscriptions
      WHERE status IN ('pending', 'active')
        AND expires_at > NOW()
    `,
  ]);

  const now = Date.now();
  const activeProfileIds = new Set(activeSubscriptions.map((row) => row.profile_id));
  const packagesByService = new Map<string, typeof packages>();
  for (const pkg of packages) {
    const list = packagesByService.get(pkg.service) ?? [];
    list.push(pkg);
    packagesByService.set(pkg.service, list);
  }

  const profilesByRoom = new Map<string, typeof profiles>();
  for (const profile of profiles) {
    const list = profilesByRoom.get(profile.master_email_id) ?? [];
    list.push(profile);
    profilesByRoom.set(profile.master_email_id, list);
  }

  const dateAfterDays = (days: number) => now + days * 24 * 60 * 60 * 1000;
  const isAfter = (value: string | Date | null, targetMs: number) =>
    value === null || new Date(value).getTime() >= targetMs;

  return c.json(
    rooms.map((room, index) => {
      const roomPackages = packagesByService.get(room.service) ?? [];
      const roomExpiresAt = new Date(room.master_expired_at).getTime();
      const slots = (profilesByRoom.get(room.id) ?? []).map((profile) => {
        const isFree =
          profile.status === "available" &&
          !activeProfileIds.has(profile.id);
        const availablePackages = roomPackages
          .filter((pkg) => {
            const requiredUntil = dateAfterDays(Number(pkg.duration_days));
            return (
              isFree &&
              roomExpiresAt >= requiredUntil &&
              isAfter(profile.profile_expires_at, requiredUntil)
            );
          })
          .map((pkg) => ({
            id: pkg.id,
            slug: pkg.slug,
            name: pkg.name,
            service: pkg.service,
            description: pkg.description,
            durationDays: pkg.duration_days,
            priceAmount: pkg.price_amount,
            currency: pkg.currency,
            status: pkg.status,
          }));

        return {
          id: profile.id,
          name: profile.profile_name,
          status: profile.status,
          profileExpiresAt: profile.profile_expires_at,
          isAvailable: availablePackages.length > 0,
          availablePackages,
        };
      });

      return {
        id: room.id,
        name: `${room.service.toUpperCase()} ห้อง ${index + 1}`,
        label: room.note || `หมดอายุ ${new Date(room.master_expired_at).toLocaleDateString("th-TH")}`,
        service: room.service,
        status: room.status,
        masterExpiredAt: room.master_expired_at,
        capacity: room.profileCount,
        availableSlots: slots.filter((slot) => slot.isAvailable).length,
        slots,
      };
    }),
  );
});

// ─── Rooms ────────────────────────────────────────────────────────

catalog.get("/rooms", async (c) => {
  const [rooms, activeCounts] = await Promise.all([
    sql`SELECT * FROM "Room" ORDER BY id`,
    sql`
      SELECT "roomId", COUNT(*)::int AS members
      FROM "Order"
      WHERE status = 'paid'
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
      GROUP BY "roomId"
    `,
  ]);

  const memberMap: Record<string, number> = {};
  for (const r of activeCounts) memberMap[r.roomId] = r.members;

  return c.json(
    rooms.map((room) => {
      const members = memberMap[room.id] ?? 0;
      return {
        id: room.id,
        name: room.name,
        label: room.label,
        capacity: room.capacity,
        members,
        available: members < room.capacity,
      };
    })
  );
});

catalog.post("/rooms", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);
  const { id, name, label, capacity = 4 } = await c.req.json<{ id: string; name: string; label: string; capacity?: number }>();
  if (!id || !name || !label) return c.json({ message: "id, name, label required" }, 400);
  const [room] = await sql`INSERT INTO "Room" (id, name, label, capacity) VALUES (${id}, ${name}, ${label}, ${capacity}) RETURNING *`;
  return c.json(room, 201);
});

catalog.put("/rooms/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; label?: string; capacity?: number }>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name     !== undefined) { sets.push(`name = $${sets.length + 1}`);     vals.push(body.name); }
  if (body.label    !== undefined) { sets.push(`label = $${sets.length + 1}`);    vals.push(body.label); }
  if (body.capacity !== undefined) { sets.push(`capacity = $${sets.length + 1}`); vals.push(body.capacity); }
  if (!sets.length) return c.json({ message: "Nothing to update" }, 400);
  vals.push(id);
  const [room] = await sql.unsafe(`UPDATE "Room" SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals as string[]);
  return c.json(room);
});

catalog.delete("/rooms/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);
  await sql`DELETE FROM "Room" WHERE id = ${c.req.param("id")}`;
  return c.body(null, 204);
});

// ─── Plans ───────────────────────────────────────────────────────

catalog.get("/plans", async (c) => {
  const plans = await sql`SELECT * FROM "Plan" ORDER BY price`;
  return c.json(
    plans.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      duration: p.duration,
      durationDays: p.durationDays,
      tag: PLAN_TAGS[p.id] ?? "",
    }))
  );
});

catalog.put("/plans/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; price?: number; duration?: string; durationDays?: number }>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name         !== undefined) { sets.push(`name = $${sets.length + 1}`);         vals.push(body.name); }
  if (body.price        !== undefined) { sets.push(`price = $${sets.length + 1}`);        vals.push(body.price); }
  if (body.duration     !== undefined) { sets.push(`duration = $${sets.length + 1}`);     vals.push(body.duration); }
  if (body.durationDays !== undefined) { sets.push(`"durationDays" = $${sets.length + 1}`); vals.push(body.durationDays); }
  if (!sets.length) return c.json({ message: "Nothing to update" }, 400);
  vals.push(id);
  const [plan] = await sql.unsafe(`UPDATE "Plan" SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals as string[]);
  return c.json(plan);
});

// ─── Categories ──────────────────────────────────────────────────

catalog.get("/categories", async (c) => {
  const rows = await sql`
    SELECT c.*, COUNT(p.id) FILTER (WHERE p."isActive") ::int AS "productCount"
    FROM "Category" c
    LEFT JOIN "Product" p ON p."categoryId" = c.id
    GROUP BY c.id
    ORDER BY c."sortOrder"
  `;
  return c.json(rows.map((r) => ({
    id: r.id, name: r.name, slug: r.slug, icon: r.icon, productCount: r.productCount,
  })));
});

// ─── Products ────────────────────────────────────────────────────

catalog.get("/products", async (c) => {
  const slug = c.req.query("category");
  const rows = slug
    ? await sql`
        SELECT p.*, cat.name AS "catName", cat.slug AS "catSlug", cat.icon AS "catIcon"
        FROM "Product" p
        JOIN "Category" cat ON cat.id = p."categoryId"
        WHERE p."isActive" = TRUE AND cat.slug = ${slug}
        ORDER BY p.name
      `
    : await sql`
        SELECT p.*, cat.name AS "catName", cat.slug AS "catSlug", cat.icon AS "catIcon"
        FROM "Product" p
        JOIN "Category" cat ON cat.id = p."categoryId"
        WHERE p."isActive" = TRUE
        ORDER BY cat."sortOrder", p.name
      `;

  return c.json(
    rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      badge: p.badge,
      price: p.price,
      stock: p.stock,
      category: { name: p.catName, slug: p.catSlug, icon: p.catIcon },
    }))
  );
});

catalog.put("/products/:id/stock", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);
  const { stock } = await c.req.json<{ stock: number }>();
  const [p] = await sql`UPDATE "Product" SET stock = ${stock} WHERE id = ${c.req.param("id")} RETURNING id, stock`;
  return c.json(p);
});

export default catalog;
