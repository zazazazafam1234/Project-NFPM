import { Hono } from "hono";
import sql from "../db";
import { decryptSecret } from "../crypto";
import { getSessionUserId } from "../session";

const subscriptions = new Hono();

type PurchaseBody = {
  packageId?: string;
  packageSlug?: string;
  paymentMethod?: string;
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

subscriptions.get("/", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อนใช้งาน" }, 401);

  const rows = await sql`
    SELECT
      s.id,
      s.status,
      s.payment_method,
      s.price_paid,
      s.started_at,
      s.expires_at,
      s.created_at,
      pkg.name AS "packageName",
      pkg.service,
      pkg.duration_days AS "durationDays",
      p.profile_name AS "profileName",
      me.email AS "masterEmail"
    FROM subscriptions s
    JOIN packages pkg ON pkg.id = s.package_id
    JOIN profiles p ON p.id = s.profile_id
    JOIN master_emails me ON me.id = p.master_email_id
    WHERE s.user_id = ${userId}
    ORDER BY s.created_at DESC
    LIMIT 50
  `;

  return c.json({
    subscriptions: rows.map((row) => ({
      id: row.id,
      status: row.status,
      paymentMethod: row.payment_method,
      pricePaid: row.price_paid,
      startedAt: row.started_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      packageName: row.packageName,
      service: row.service,
      durationDays: row.durationDays,
      profileName: row.profileName,
      masterEmail: row.masterEmail,
    })),
  });
});

subscriptions.post("/", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อนใช้งาน" }, 401);

  const { packageId, packageSlug, paymentMethod = "points" } = await c.req.json<PurchaseBody>();
  if (!packageId && !packageSlug) {
    return c.json({ message: "กรุณาเลือกแพ็กเกจ" }, 400);
  }
  if (paymentMethod !== "points") {
    return c.json({ message: "รองรับการชำระด้วย Point เท่านั้นในขั้นตอนนี้" }, 400);
  }

  try {
    const result = await sql.begin(async (sql) => {
      const [pkg] = packageId
        ? await sql`
            SELECT *
            FROM packages
            WHERE id = ${packageId}::uuid
              AND status = 'active'
              AND deleted_at IS NULL
            FOR SHARE
          `
        : await sql`
            SELECT *
            FROM packages
            WHERE slug = ${packageSlug}
              AND status = 'active'
              AND deleted_at IS NULL
            FOR SHARE
          `;

      if (!pkg) throw new Error("ไม่พบแพ็กเกจที่เลือก");

      const now = new Date();
      const expiresAt = addDays(now, pkg.duration_days);

      const [user] = await sql`SELECT * FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (!user) throw new Error("ไม่พบบัญชีผู้ใช้");
      if (user.points < pkg.price_amount) throw new Error("Point ไม่เพียงพอ");

      const [profile] = await sql`
        SELECT
          p.*,
          me.email AS master_email,
          me.password_ciphertext AS master_password_ciphertext,
          me.master_expired_at
        FROM profiles p
        JOIN master_emails me ON me.id = p.master_email_id
        WHERE p.status = 'available'
          AND p.deleted_at IS NULL
          AND (p.profile_expires_at IS NULL OR p.profile_expires_at >= ${expiresAt.toISOString()})
          AND me.package_id = ${pkg.id}
          AND me.status = 'active'
          AND me.deleted_at IS NULL
          AND me.master_expired_at >= ${expiresAt.toISOString()}
          AND NOT EXISTS (
            SELECT 1
            FROM subscriptions s
            WHERE s.profile_id = p.id
              AND s.status IN ('pending', 'active')
              AND s.expires_at > NOW()
          )
        ORDER BY me.master_expired_at ASC, p.created_at ASC
        FOR UPDATE OF p SKIP LOCKED
        LIMIT 1
      `;

      if (!profile) throw new Error("สต็อกหมด หรือไม่มีโปรไฟล์ที่ใช้งานได้ถึงวันหมดอายุแพ็กเกจ");

      const [updatedUser] = await sql`
        UPDATE "User"
        SET points = points - ${pkg.price_amount}, "updatedAt" = NOW()
        WHERE id = ${userId}
        RETURNING points
      `;

      await sql`
        UPDATE profiles
        SET status = 'rented', profile_expires_at = ${expiresAt.toISOString()}, updated_at = NOW()
        WHERE id = ${profile.id}
      `;

      const [subscription] = await sql`
        INSERT INTO subscriptions (
          user_id, profile_id, package_id, status, payment_method, price_paid, started_at, expires_at
        )
        VALUES (
          ${userId}, ${profile.id}, ${pkg.id}, 'active', ${paymentMethod}, ${pkg.price_amount},
          ${now.toISOString()}, ${expiresAt.toISOString()}
        )
        RETURNING id, started_at, expires_at, status
      `;

      await sql`
        INSERT INTO "Transaction" (id, "userId", type, amount, description, "createdAt")
        VALUES (
          ${crypto.randomUUID()},
          ${userId},
          'debit',
          ${pkg.price_amount},
          ${`เช่า${pkg.name} — ${profile.profile_name}`},
          NOW()
        )
      `;

      await sql`
        INSERT INTO subscription_events (subscription_id, actor_user_id, event_type, message)
        VALUES (${subscription.id}, ${userId}, 'created', 'Subscription created by customer purchase')
      `;

      return {
        subscription,
        package: pkg,
        profile,
        points: updatedUser.points,
      };
    });

    return c.json({
      subscriptionId: result.subscription.id,
      status: result.subscription.status,
      startedAt: result.subscription.started_at,
      expiresAt: result.subscription.expires_at,
      points: result.points,
      credentials: {
        email: result.profile.master_email,
        password: decryptSecret(result.profile.master_password_ciphertext),
        profileName: result.profile.profile_name,
        pin: decryptSecret(result.profile.profile_pin_ciphertext),
      },
    }, 201);
  } catch (err) {
    return c.json(
      { message: err instanceof Error ? err.message : "ไม่สามารถสร้างคำสั่งซื้อได้" },
      400,
    );
  }
});

subscriptions.post("/:id/renew", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อนใช้งาน" }, 401);

  const subscriptionId = c.req.param("id");

  try {
    const result = await sql.begin(async (sql) => {
      const [current] = await sql`
        SELECT
          s.*,
          pkg.duration_days,
          pkg.price_amount,
          pkg.name AS package_name,
          p.profile_expires_at,
          me.master_expired_at
        FROM subscriptions s
        JOIN packages pkg ON pkg.id = s.package_id
        JOIN profiles p ON p.id = s.profile_id
        JOIN master_emails me ON me.id = p.master_email_id
        WHERE s.id = ${subscriptionId}::uuid
          AND s.user_id = ${userId}
          AND s.status = 'active'
        FOR UPDATE OF s
      `;

      if (!current) throw new Error("ไม่พบรายการเช่าที่ต่ออายุได้");

      const baseDate = new Date(current.expires_at) > new Date()
        ? new Date(current.expires_at)
        : new Date();
      const nextExpiresAt = addDays(baseDate, current.duration_days);

      if (new Date(current.master_expired_at) < nextExpiresAt) {
        throw new Error("บัญชีแม่หมดอายุก่อนระยะเวลาต่ออายุ กรุณาติดต่อแอดมิน");
      }

      const [user] = await sql`SELECT * FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (!user) throw new Error("ไม่พบบัญชีผู้ใช้");
      if (user.points < current.price_amount) throw new Error("Point ไม่เพียงพอ");

      const [updatedUser] = await sql`
        UPDATE "User"
        SET points = points - ${current.price_amount}, "updatedAt" = NOW()
        WHERE id = ${userId}
        RETURNING points
      `;

      const [renewal] = await sql`
        INSERT INTO subscriptions (
          user_id, profile_id, package_id, parent_subscription_id, status,
          payment_method, price_paid, started_at, expires_at
        )
        VALUES (
          ${userId}, ${current.profile_id}, ${current.package_id}, ${current.id},
          'active', 'points', ${current.price_amount}, ${baseDate.toISOString()}, ${nextExpiresAt.toISOString()}
        )
        RETURNING id, started_at, expires_at, status
      `;

      await sql`
        UPDATE profiles
        SET status = 'rented', profile_expires_at = ${nextExpiresAt.toISOString()}, updated_at = NOW()
        WHERE id = ${current.profile_id}
      `;

      await sql`
        INSERT INTO "Transaction" (id, "userId", type, amount, description, "createdAt")
        VALUES (
          ${crypto.randomUUID()},
          ${userId},
          'debit',
          ${current.price_amount},
          ${`ต่ออายุ${current.package_name}`},
          NOW()
        )
      `;

      await sql`
        INSERT INTO subscription_events (subscription_id, actor_user_id, event_type, message)
        VALUES (${renewal.id}, ${userId}, 'renewed', ${`Renewed from ${current.id}`})
      `;

      return { renewal, points: updatedUser.points };
    });

    return c.json({
      subscriptionId: result.renewal.id,
      status: result.renewal.status,
      startedAt: result.renewal.started_at,
      expiresAt: result.renewal.expires_at,
      points: result.points,
    }, 201);
  } catch (err) {
    return c.json(
      { message: err instanceof Error ? err.message : "ไม่สามารถต่ออายุได้" },
      400,
    );
  }
});

export default subscriptions;
