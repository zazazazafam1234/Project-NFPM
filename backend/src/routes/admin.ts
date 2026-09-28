import { Hono } from "hono";
import sql from "../db";
import { getAdminSession, requireAdmin } from "../adminAuth";
import { decryptSecret, encryptSecret } from "../crypto";

const admin = new Hono();

admin.use("*", requireAdmin);

function nullableDate(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (!value) return null;
  return value;
}

function addUpdate(
  sets: string[],
  values: unknown[],
  column: string,
  value: unknown,
  cast = "",
) {
  values.push(value);
  sets.push(`${column} = $${values.length}${cast}`);
}

admin.get("/inventory", async (c) => {
  const [packages, masterEmails, profiles, users, metrics] = await Promise.all([
    sql`
      SELECT
        pkg.*,
        COUNT(p.id) FILTER (
          WHERE p.status = 'available'
            AND p.deleted_at IS NULL
            AND (p.profile_expires_at IS NULL OR p.profile_expires_at >= NOW() + (pkg.duration_days || ' days')::interval)
            AND me.status = 'active'
            AND me.deleted_at IS NULL
            AND me.master_expired_at >= NOW() + (pkg.duration_days || ' days')::interval
            AND NOT EXISTS (
              SELECT 1
              FROM subscriptions s
              WHERE s.profile_id = p.id
                AND s.status IN ('pending', 'active')
                AND s.expires_at > NOW()
            )
        )::int AS "availableStock"
      FROM packages pkg
      LEFT JOIN master_emails me ON me.service = pkg.service
      LEFT JOIN profiles p ON p.master_email_id = me.id
      WHERE pkg.deleted_at IS NULL
      GROUP BY pkg.id
      ORDER BY pkg.sort_order, pkg.price_amount
    `,
    sql`
      SELECT
        me.id,
        me.package_id AS "packageId",
        pkg.name AS "packageName",
        pkg.slug AS "packageSlug",
        me.service,
        me.email,
        me.status,
        me.purchased_at,
        me.master_expired_at,
        me.note,
        COUNT(p.id)::int AS "profileCount",
        COUNT(p.id) FILTER (WHERE p.status = 'available')::int AS "availableProfiles"
      FROM master_emails me
      LEFT JOIN packages pkg ON pkg.id = me.package_id
      LEFT JOIN profiles p ON p.master_email_id = me.id AND p.deleted_at IS NULL
      WHERE me.deleted_at IS NULL
      GROUP BY me.id, pkg.id
      ORDER BY me.created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT
        p.id,
        p.master_email_id,
        p.profile_name,
        p.status,
        p.profile_expires_at,
        p.note,
        p.created_at,
        me.email AS "masterEmail",
        me.service,
        pkg.name AS "packageName",
        pkg.slug AS "packageSlug"
      FROM profiles p
      JOIN master_emails me ON me.id = p.master_email_id
      LEFT JOIN packages pkg ON pkg.id = me.package_id
      WHERE p.deleted_at IS NULL
      ORDER BY p.created_at DESC
      LIMIT 150
    `,
    sql`
      SELECT
        u.id,
        u.email,
        u.name,
        u.image,
        u.points,
        u.role,
        u.status,
        u."createdAt" AS "createdAt",
        u."updatedAt" AS "updatedAt",
        COUNT(DISTINCT s.id)::int AS "subscriptionCount",
        COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'active' AND s.expires_at > NOW())::int AS "activeSubscriptionCount",
        COUNT(DISTINCT t.id)::int AS "transactionCount"
      FROM "User" u
      LEFT JOIN subscriptions s ON s.user_id = u.id
      LEFT JOIN "Transaction" t ON t."userId" = u.id
      GROUP BY u.id
      ORDER BY u."createdAt" DESC
      LIMIT 200
    `,
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM packages WHERE status = 'active' AND deleted_at IS NULL) AS "activePackages",
        (SELECT COUNT(*)::int FROM master_emails WHERE status = 'active' AND deleted_at IS NULL) AS "activeMasterEmails",
        (SELECT COUNT(*)::int FROM profiles WHERE status = 'available' AND deleted_at IS NULL) AS "availableProfiles",
        (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active' AND expires_at > NOW()) AS "activeSubscriptions",
        (SELECT COUNT(*)::int FROM "User" WHERE status = 'active') AS "activeUsers",
        (SELECT COUNT(*)::int FROM "User") AS "totalUsers"
    `,
  ]);

  return c.json({
    packages,
    masterEmails,
    profiles,
    users,
    metrics: metrics[0],
  });
});

admin.get("/automation/master-emails", async (c) => {
  const service = c.req.query("service") ?? "netflix";
  const email = c.req.query("email");

  const accounts = await sql`
    SELECT
      me.id,
      me.package_id AS "packageId",
      pkg.name AS "packageName",
      pkg.slug AS "packageSlug",
      me.service,
      me.email,
      me.password_ciphertext,
      me.status,
      me.master_expired_at,
      me.note,
      COUNT(p.id)::int AS "profileCount",
      COUNT(p.id) FILTER (WHERE p.status = 'available' AND p.deleted_at IS NULL)::int AS "availableProfiles"
    FROM master_emails me
    LEFT JOIN packages pkg ON pkg.id = me.package_id
    LEFT JOIN profiles p ON p.master_email_id = me.id AND p.deleted_at IS NULL
    WHERE me.deleted_at IS NULL
      AND me.status = 'active'
      AND me.master_expired_at > NOW()
      AND me.service = ${service}
      AND (${email ?? null}::text IS NULL OR me.email = ${email ?? null})
    GROUP BY me.id, pkg.id
    ORDER BY me.created_at DESC
    LIMIT 100
  `;

  const masterEmails = [];
  const skipped = [];

  for (const account of accounts) {
    try {
      masterEmails.push({
        id: account.id,
        packageId: account.packageId,
        packageName: account.packageName,
        packageSlug: account.packageSlug,
        service: account.service,
        email: account.email,
        password: decryptSecret(account.password_ciphertext),
        status: account.status,
        masterExpiredAt: account.master_expired_at,
        note: account.note,
        profileCount: account.profileCount,
        availableProfiles: account.availableProfiles,
      });
    } catch (error) {
      skipped.push({
        id: account.id,
        email: account.email,
        reason: error instanceof Error ? error.message : "decrypt_failed",
      });
    }
  }

  return c.json({
    masterEmails,
    skipped,
  });
});

admin.post("/automation/profiles", async (c) => {
  const body = await c.req.json<{
    masterEmailId: string;
    profiles: Array<{
      profileName: string;
      pin?: string;
      status?: "available" | "rented" | "inactive" | "expired" | "reserved";
      profileExpiresAt?: string;
      note?: string;
    }>;
  }>();

  if (!body.masterEmailId || !Array.isArray(body.profiles) || body.profiles.length === 0) {
    return c.json({ message: "masterEmailId and profiles required" }, 400);
  }

  const created = [];
  for (const item of body.profiles) {
    if (!item.profileName) continue;
    const [profile] = await sql`
      INSERT INTO profiles (
        master_email_id, profile_name, profile_pin_ciphertext, status, profile_expires_at, note
      )
      VALUES (
        ${body.masterEmailId}::uuid,
        ${item.profileName},
        ${item.pin ? encryptSecret(item.pin) : null},
        ${item.status ?? "available"},
        ${item.profileExpiresAt ?? null},
        ${item.note ?? "Created by NetflixProfileCreator"}
      )
      RETURNING id, master_email_id, profile_name, status, profile_expires_at, note
    `;
    created.push(profile);
  }

  return c.json({ profiles: created }, 201);
});

admin.post("/packages", async (c) => {
  const body = await c.req.json<{
    slug: string;
    name: string;
    service?: string;
    description?: string;
    durationDays: number;
    priceAmount: number;
    currency?: string;
    status?: "active" | "inactive" | "archived";
  }>();

  if (!body.slug || !body.name || !body.durationDays || body.priceAmount === undefined) {
    return c.json({ message: "slug, name, durationDays, priceAmount required" }, 400);
  }

  const [pkg] = await sql`
    INSERT INTO packages (
      slug, name, service, description, duration_days, price_amount, currency, status, updated_at
    )
    VALUES (
      ${body.slug},
      ${body.name},
      ${body.service ?? "netflix"},
      ${body.description ?? null},
      ${body.durationDays},
      ${body.priceAmount},
      ${body.currency ?? "THB"},
      ${body.status ?? "active"},
      NOW()
    )
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      service = EXCLUDED.service,
      description = EXCLUDED.description,
      duration_days = EXCLUDED.duration_days,
      price_amount = EXCLUDED.price_amount,
      currency = EXCLUDED.currency,
      status = EXCLUDED.status,
      updated_at = NOW()
    RETURNING *
  `;

  return c.json(pkg, 201);
});

admin.patch("/packages/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    slug?: string;
    name?: string;
    service?: string;
    description?: string | null;
    durationDays?: number;
    priceAmount?: number;
    currency?: string;
    status?: "active" | "inactive" | "archived";
  }>();

  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.slug !== undefined) addUpdate(sets, values, "slug", body.slug);
  if (body.name !== undefined) addUpdate(sets, values, "name", body.name);
  if (body.service !== undefined) addUpdate(sets, values, "service", body.service);
  if (body.description !== undefined) addUpdate(sets, values, "description", body.description);
  if (body.durationDays !== undefined) addUpdate(sets, values, "duration_days", body.durationDays);
  if (body.priceAmount !== undefined) addUpdate(sets, values, "price_amount", body.priceAmount);
  if (body.currency !== undefined) addUpdate(sets, values, "currency", body.currency);
  if (body.status !== undefined) addUpdate(sets, values, "status", body.status, "::package_status");

  if (!sets.length) return c.json({ message: "Nothing to update" }, 400);
  values.push(id);

  const [pkg] = await sql.unsafe(
    `
    UPDATE packages
    SET ${sets.join(", ")}, updated_at = NOW()
    WHERE id = $${values.length}::uuid
      AND deleted_at IS NULL
    RETURNING *
    `,
    values,
  );

  if (!pkg) return c.json({ message: "ไม่พบโปรโมชัน" }, 404);
  return c.json(pkg);
});

admin.delete("/packages/:id", async (c) => {
  const id = c.req.param("id");
  const [pkg] = await sql`
    UPDATE packages
    SET status = 'archived', deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${id}::uuid
      AND deleted_at IS NULL
    RETURNING id
  `;

  if (!pkg) return c.json({ message: "ไม่พบโปรโมชัน" }, 404);
  return c.json({ ok: true });
});

admin.post("/master-emails", async (c) => {
  const body = await c.req.json<{
    packageId?: string;
    service?: string;
    email: string;
    password: string;
    purchasedAt?: string;
    masterExpiredAt: string;
    status?: "active" | "inactive" | "expired" | "suspended";
    note?: string;
  }>();

  if (!body.email || !body.password || !body.masterExpiredAt) {
    return c.json({ message: "email, password, masterExpiredAt required" }, 400);
  }

  if (!body.packageId) {
    return c.json({ message: "กรุณาเลือก package ที่จะผูกกับ Email แม่" }, 400);
  }

  const [pkg] = await sql`
    SELECT id, service
    FROM packages
    WHERE id = ${body.packageId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;

  if (!pkg) return c.json({ message: "ไม่พบ package ที่เลือก" }, 404);

  const [account] = await sql`
    INSERT INTO master_emails (
      package_id, service, email, password_ciphertext, status, purchased_at, master_expired_at, note
    )
    VALUES (
      ${pkg.id},
      ${pkg.service},
      ${body.email},
      ${encryptSecret(body.password)},
      ${body.status ?? "active"},
      ${body.purchasedAt ?? new Date().toISOString()},
      ${body.masterExpiredAt},
      ${body.note ?? null}
    )
    RETURNING id, package_id AS "packageId", service, email, status, purchased_at, master_expired_at, note
  `;

  return c.json(account, 201);
});

admin.patch("/master-emails/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    packageId?: string;
    email?: string;
    password?: string;
    purchasedAt?: string;
    masterExpiredAt?: string;
    status?: "active" | "inactive" | "expired" | "suspended";
    note?: string | null;
  }>();

  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.packageId !== undefined) {
    const [pkg] = await sql`
      SELECT id, service
      FROM packages
      WHERE id = ${body.packageId}::uuid
        AND deleted_at IS NULL
      LIMIT 1
    `;
    if (!pkg) return c.json({ message: "ไม่พบโปรโมชันที่เลือก" }, 404);
    addUpdate(sets, values, "package_id", pkg.id, "::uuid");
    addUpdate(sets, values, "service", pkg.service);
  }
  if (body.email !== undefined) addUpdate(sets, values, "email", body.email);
  if (body.password) addUpdate(sets, values, "password_ciphertext", encryptSecret(body.password));
  if (body.purchasedAt !== undefined) addUpdate(sets, values, "purchased_at", body.purchasedAt);
  if (body.masterExpiredAt !== undefined) addUpdate(sets, values, "master_expired_at", body.masterExpiredAt);
  if (body.status !== undefined) addUpdate(sets, values, "status", body.status, "::master_email_status");
  if (body.note !== undefined) addUpdate(sets, values, "note", body.note);

  if (!sets.length) return c.json({ message: "Nothing to update" }, 400);
  values.push(id);

  const [account] = await sql.unsafe(
    `
    UPDATE master_emails
    SET ${sets.join(", ")}, updated_at = NOW()
    WHERE id = $${values.length}::uuid
      AND deleted_at IS NULL
    RETURNING id, package_id AS "packageId", service, email, status, purchased_at, master_expired_at, note
    `,
    values,
  );

  if (!account) return c.json({ message: "ไม่พบห้องบัญชีแม่" }, 404);
  return c.json(account);
});

admin.delete("/master-emails/:id", async (c) => {
  const id = c.req.param("id");
  const [account] = await sql`
    UPDATE master_emails
    SET status = 'inactive', deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${id}::uuid
      AND deleted_at IS NULL
    RETURNING id
  `;

  if (!account) return c.json({ message: "ไม่พบห้องบัญชีแม่" }, 404);

  await sql`
    UPDATE profiles
    SET status = CASE
      WHEN status IN ('rented', 'reserved') THEN status
      ELSE 'inactive'::profile_status
    END,
    deleted_at = CASE
      WHEN status IN ('rented', 'reserved') THEN deleted_at
      ELSE NOW()
    END,
    updated_at = NOW()
    WHERE master_email_id = ${id}::uuid
      AND deleted_at IS NULL
  `;

  return c.json({ ok: true });
});

admin.post("/profiles", async (c) => {
  const body = await c.req.json<{
    masterEmailId: string;
    profileName: string;
    pin?: string;
    status?: "available" | "rented" | "inactive" | "expired" | "reserved";
    profileExpiresAt?: string;
    note?: string;
  }>();

  if (!body.masterEmailId || !body.profileName) {
    return c.json({ message: "masterEmailId and profileName required" }, 400);
  }

  const [profile] = await sql`
    INSERT INTO profiles (
      master_email_id, profile_name, profile_pin_ciphertext, status, profile_expires_at, note
    )
    VALUES (
      ${body.masterEmailId}::uuid,
      ${body.profileName},
      ${body.pin ? encryptSecret(body.pin) : null},
      ${body.status ?? "available"},
      ${body.profileExpiresAt ?? null},
      ${body.note ?? null}
    )
    RETURNING id, master_email_id, profile_name, status, profile_expires_at, note
  `;

  return c.json(profile, 201);
});

admin.patch("/profiles/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    status?: "available" | "rented" | "inactive" | "expired" | "reserved";
    profileExpiresAt?: string | null;
    note?: string | null;
    pin?: string | null;
  }>();

  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.status !== undefined) addUpdate(sets, values, "status", body.status, "::profile_status");
  if (body.profileExpiresAt !== undefined) {
    addUpdate(sets, values, "profile_expires_at", nullableDate(body.profileExpiresAt));
  }
  if (body.note !== undefined) addUpdate(sets, values, "note", body.note);
  if (body.pin) addUpdate(sets, values, "profile_pin_ciphertext", encryptSecret(body.pin));

  if (!sets.length) return c.json({ message: "Nothing to update" }, 400);
  values.push(id);

  const [profile] = await sql.unsafe(
    `
    UPDATE profiles
    SET ${sets.join(", ")}, updated_at = NOW()
    WHERE id = $${values.length}::uuid
      AND deleted_at IS NULL
    RETURNING id, master_email_id, profile_name, status, profile_expires_at, note
    `,
    values,
  );

  if (!profile) return c.json({ message: "ไม่พบโปรไฟล์" }, 404);
  return c.json(profile);
});

admin.put("/profiles/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    masterEmailId?: string;
    profileName?: string;
    pin?: string;
    status?: "available" | "rented" | "inactive" | "expired" | "reserved";
    profileExpiresAt?: string | null;
    note?: string | null;
  }>();

  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.masterEmailId !== undefined) addUpdate(sets, values, "master_email_id", body.masterEmailId, "::uuid");
  if (body.profileName !== undefined) addUpdate(sets, values, "profile_name", body.profileName);
  if (body.status !== undefined) addUpdate(sets, values, "status", body.status, "::profile_status");
  if (body.profileExpiresAt !== undefined) addUpdate(sets, values, "profile_expires_at", nullableDate(body.profileExpiresAt));
  if (body.note !== undefined) addUpdate(sets, values, "note", body.note);
  if (body.pin) addUpdate(sets, values, "profile_pin_ciphertext", encryptSecret(body.pin));

  if (!sets.length) return c.json({ message: "Nothing to update" }, 400);
  values.push(id);

  const [profile] = await sql.unsafe(
    `
    UPDATE profiles
    SET ${sets.join(", ")}, updated_at = NOW()
    WHERE id = $${values.length}::uuid
      AND deleted_at IS NULL
    RETURNING id, master_email_id, profile_name, status, profile_expires_at, note
    `,
    values,
  );

  if (!profile) return c.json({ message: "ไม่พบโปรไฟล์" }, 404);
  return c.json(profile);
});

admin.delete("/profiles/:id", async (c) => {
  const id = c.req.param("id");
  const [profile] = await sql`
    UPDATE profiles
    SET status = 'inactive', deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${id}::uuid
      AND deleted_at IS NULL
    RETURNING id
  `;

  if (!profile) return c.json({ message: "ไม่พบโปรไฟล์" }, 404);
  return c.json({ ok: true });
});

admin.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const actor = await getAdminSession(c);
  const body = await c.req.json<{
    name?: string;
    role?: "user" | "admin";
    status?: "active" | "suspended";
    points?: number;
  }>();

  if (body.role !== undefined && !["user", "admin"].includes(body.role)) {
    return c.json({ message: "role ไม่ถูกต้อง" }, 400);
  }
  if (body.status !== undefined && !["active", "suspended"].includes(body.status)) {
    return c.json({ message: "status ไม่ถูกต้อง" }, 400);
  }
  if (
    body.points !== undefined
    && (!Number.isInteger(body.points) || body.points < 0)
  ) {
    return c.json({ message: "Point ต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป" }, 400);
  }

  try {
    const updated = await sql.begin(async (sql) => {
      const [current] = await sql`
        SELECT id, name, email, points, role, status
        FROM "User"
        WHERE id = ${id}
        FOR UPDATE
      `;

      if (!current) throw new Error("ไม่พบผู้ใช้");

      const willRemoveActiveAdmin =
        current.role === "admin"
        && current.status === "active"
        && (
          (body.role !== undefined && body.role !== "admin")
          || (body.status !== undefined && body.status !== "active")
        );

      if (willRemoveActiveAdmin) {
        const [remaining] = await sql`
          SELECT COUNT(*)::int AS count
          FROM "User"
          WHERE id <> ${id}
            AND role = 'admin'
            AND status = 'active'
        `;
        if (!remaining || remaining.count < 1) {
          throw new Error("ต้องเหลือ Admin ที่ active อย่างน้อย 1 บัญชี");
        }
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      if (body.name !== undefined) addUpdate(sets, values, "name", body.name);
      if (body.role !== undefined) addUpdate(sets, values, "role", body.role);
      if (body.status !== undefined) addUpdate(sets, values, "status", body.status);
      if (body.points !== undefined) addUpdate(sets, values, "points", body.points);

      if (!sets.length) throw new Error("Nothing to update");
      values.push(id);

      const [user] = await sql.unsafe(
        `
        UPDATE "User"
        SET ${sets.join(", ")}, "updatedAt" = NOW()
        WHERE id = $${values.length}
        RETURNING id, email, name, image, points, role, status, "createdAt", "updatedAt"
        `,
        values,
      );

      if (body.points !== undefined && body.points !== current.points) {
        const delta = body.points - Number(current.points);
        await sql`
          INSERT INTO "Transaction" (id, "userId", type, amount, description, "createdAt")
          VALUES (
            ${crypto.randomUUID()},
            ${id},
            'admin_adjustment',
            ${delta},
            ${`Admin ปรับ Point จาก ${Number(current.points).toLocaleString()} เป็น ${body.points.toLocaleString()}`},
            NOW()
          )
        `;
      }

      await sql`
        INSERT INTO admin_audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
        VALUES (
          ${actor?.id ?? null},
          'user.updated',
          'user',
          ${id},
          ${JSON.stringify({ before: current, after: user })}
        )
      `;

      return user;
    });

    return c.json(updated);
  } catch (err) {
    return c.json(
      { message: err instanceof Error ? err.message : "แก้ไขผู้ใช้ไม่สำเร็จ" },
      400,
    );
  }
});

admin.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  const actor = await getAdminSession(c);

  try {
    const result = await sql.begin(async (sql) => {
      const [current] = await sql`
        SELECT id, role, status
        FROM "User"
        WHERE id = ${id}
        FOR UPDATE
      `;

      if (!current) throw new Error("ไม่พบผู้ใช้");

      if (current.role === "admin" && current.status === "active") {
        const [remaining] = await sql`
          SELECT COUNT(*)::int AS count
          FROM "User"
          WHERE id <> ${id}
            AND role = 'admin'
            AND status = 'active'
        `;
        if (!remaining || remaining.count < 1) {
          throw new Error("ต้องเหลือ Admin ที่ active อย่างน้อย 1 บัญชี");
        }
      }

      const [user] = await sql`
        UPDATE "User"
        SET status = 'suspended', "updatedAt" = NOW()
        WHERE id = ${id}
        RETURNING id
      `;

      await sql`
        INSERT INTO admin_audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
        VALUES (
          ${actor?.id ?? null},
          'user.suspended',
          'user',
          ${id},
          ${JSON.stringify({ before: current })}
        )
      `;

      return user;
    });

    return c.json({ ok: Boolean(result) });
  } catch (err) {
    return c.json(
      { message: err instanceof Error ? err.message : "ปิดผู้ใช้ไม่สำเร็จ" },
      400,
    );
  }
});

export default admin;
