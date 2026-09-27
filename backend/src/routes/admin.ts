import { Hono } from "hono";
import sql from "../db";
import { requireAdmin } from "../adminAuth";
import { decryptSecret, encryptSecret } from "../crypto";

const admin = new Hono();

admin.use("*", requireAdmin);

admin.get("/inventory", async (c) => {
  const [packages, masterEmails, profiles, metrics] = await Promise.all([
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
      LEFT JOIN master_emails me ON me.package_id = pkg.id
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
        (SELECT COUNT(*)::int FROM packages WHERE status = 'active' AND deleted_at IS NULL) AS "activePackages",
        (SELECT COUNT(*)::int FROM master_emails WHERE status = 'active' AND deleted_at IS NULL) AS "activeMasterEmails",
        (SELECT COUNT(*)::int FROM profiles WHERE status = 'available' AND deleted_at IS NULL) AS "availableProfiles",
        (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active' AND expires_at > NOW()) AS "activeSubscriptions"
    `,
  ]);

  return c.json({
    packages,
    masterEmails,
    profiles,
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

  const [profile] = await sql`
    UPDATE profiles
    SET
      status = COALESCE(${body.status ?? null}, status),
      profile_expires_at = COALESCE(${body.profileExpiresAt ?? null}, profile_expires_at),
      note = COALESCE(${body.note ?? null}, note),
      profile_pin_ciphertext = CASE
        WHEN ${body.pin ?? null} IS NULL THEN profile_pin_ciphertext
        ELSE ${body.pin ? encryptSecret(body.pin) : null}
      END,
      updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING id, master_email_id, profile_name, status, profile_expires_at, note
  `;

  if (!profile) return c.json({ message: "ไม่พบโปรไฟล์" }, 404);
  return c.json(profile);
});

export default admin;
