import { Hono } from "hono";
import sql from "../db";
import { getSessionUserId } from "../session";
import { PREPARE_HOLD_MINUTES, RENEW_GRACE_HOURS, pinRotationEnabled, runPinWorkerSoon } from "../libs/pin-rotation/worker";

const subscriptions = new Hono();

type PurchaseBody = {
  packageId?: string;
  packageSlug?: string;
  profileId?: string;
  paymentMethod?: string;
};

// Whole baht in the discount wallet come off the price (1 baht = 1 point), capped at the price.
function discountPointsFor(discountCents: number, price: number) {
  return Math.min(Math.floor(Number(discountCents) / 100), Number(price));
}

async function spendDiscount(
  db: typeof sql,
  { userId, points, subscriptionId, reason }: { userId: string; points: number; subscriptionId: string; reason: string },
) {
  if (points <= 0) return;
  const [user] = await db`
    UPDATE "User"
    SET discount_cents = discount_cents - ${points * 100}, "updatedAt" = NOW()
    WHERE id = ${userId}
    RETURNING discount_cents
  `;
  await db`
    INSERT INTO discount_ledger (user_id, amount_cents, balance_cents, kind, reason, subscription_id)
    VALUES (${userId}, ${-points * 100}, ${user.discount_cents}, 'purchase', ${reason}, ${subscriptionId})
  `;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

// A rental can be renewed until RENEW_GRACE_HOURS after it ends, unless an admin
// ended it, its PIN was already changed, or it was renewed already.
// Expects aliases s (subscriptions), p (profiles), me (master_emails), pkg (packages).
const renewable = () => sql`
  s.status = 'active'
  AND s.expires_at > NOW() - make_interval(hours => ${RENEW_GRACE_HOURS})
  AND p.deleted_at IS NULL
  AND me.deleted_at IS NULL
  AND pkg.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM subscriptions c
    WHERE c.parent_subscription_id = s.id AND c.status IN ('pending', 'active')
  )
  AND NOT EXISTS (
    SELECT 1 FROM subscription_events se
    WHERE se.subscription_id = s.id AND se.event_type IN ('expired_by_admin', 'pin_rotated', 'profile_recreated')
  )
`;

const noActiveRentalOnSameMasterForUser = (userId: string) => sql`
  NOT EXISTS (
    SELECT 1
    FROM subscriptions existing
    JOIN profiles occupied ON occupied.id = existing.profile_id
    WHERE existing.user_id = ${userId}
      AND existing.status IN ('pending', 'active')
      AND existing.expires_at > NOW()
      AND occupied.master_email_id = p.master_email_id
  )
`;

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
      pkg.duration_minutes AS "durationMinutes",
      p.profile_name AS "profileName",
      (LOWER(COALESCE(p.metadata->>'profileEmail', '')) = LOWER(u.email)) AS "ready",
      pkg.price_amount AS "renewPrice",
      (${renewable()}) AS "canRenew"
    FROM subscriptions s
    JOIN packages pkg ON pkg.id = s.package_id
    JOIN profiles p ON p.id = s.profile_id
    JOIN master_emails me ON me.id = p.master_email_id
    JOIN "User" u ON u.id = s.user_id
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
      durationMinutes: row.durationMinutes,
      profileName: row.profileName,
      ready: row.ready,
      canRenew: row.canRenew,
      renewPrice: row.renewPrice,
      renewDeadline: new Date(new Date(row.expires_at).getTime() + RENEW_GRACE_HOURS * 60 * 60 * 1000),
    })),
  });
});

subscriptions.post("/", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อนใช้งาน" }, 401);

  const { packageId, packageSlug, profileId, paymentMethod = "points" } = await c.req.json<PurchaseBody>();
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
      // With the pin-service the rental waits as "pending" (time not counted) until the
      // customer's email is on the profile; expiresAt only holds the slot meanwhile.
      const prepare = pinRotationEnabled();
      const expiresAt = addMinutes(now, pkg.duration_minutes + (prepare ? PREPARE_HOLD_MINUTES : 0));

      const [user] = await sql`
        SELECT id, email, points, discount_cents, status
        FROM "User"
        WHERE id = ${userId}
          AND status = 'active'
        FOR UPDATE
      `;
      if (!user) throw new Error("ไม่พบบัญชีผู้ใช้");
      const discountPoints = discountPointsFor(user.discount_cents, pkg.price_amount);
      const pricePaid = Number(pkg.price_amount) - discountPoints;
      if (user.points < pricePaid) throw new Error("Point ไม่เพียงพอ");

      const [profile] = profileId
        ? await sql`
            SELECT
              p.*,
              me.email AS master_email,
              me.password_ciphertext AS master_password_ciphertext,
              me.master_expired_at
            FROM profiles p
            JOIN master_emails me ON me.id = p.master_email_id
              WHERE p.id = ${profileId}::uuid
                AND (
                  p.status = 'available'
                  OR (p.status = 'rented' AND p.profile_expires_at <= NOW())
                )
                AND p.deleted_at IS NULL
                AND me.service = ${pkg.service}
                AND me.status = 'active'
                AND me.deleted_at IS NULL
                AND me.master_expired_at > NOW()
                AND ${noActiveRentalOnSameMasterForUser(userId)}
                AND NOT EXISTS (
                SELECT 1
                FROM subscriptions s
                WHERE s.profile_id = p.id
                  AND s.status IN ('pending', 'active')
                  AND s.expires_at > NOW()
              )
            FOR UPDATE OF p
            LIMIT 1
          `
        : await sql`
            SELECT
              p.*,
              me.email AS master_email,
              me.password_ciphertext AS master_password_ciphertext,
              me.master_expired_at
            FROM profiles p
            JOIN master_emails me ON me.id = p.master_email_id
            WHERE (
                p.status = 'available'
                OR (p.status = 'rented' AND p.profile_expires_at <= NOW())
              )
              AND p.deleted_at IS NULL
              AND me.service = ${pkg.service}
              AND me.status = 'active'
              AND me.deleted_at IS NULL
              AND me.master_expired_at > NOW()
              AND ${noActiveRentalOnSameMasterForUser(userId)}
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

      if (!profile) {
        throw new Error(
          profileId
            ? "Slot นี้ไม่ว่างแล้ว หรือใช้กับโปรโมชันที่เลือกไม่ได้"
            : "สต็อกหมด หรือไม่มีโปรไฟล์ที่พร้อมใช้งาน",
        );
      }

      const [updatedUser] = await sql`
        UPDATE "User"
        SET points = points - ${pricePaid}, "updatedAt" = NOW()
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
          user_id, profile_id, package_id, status, payment_method, price_paid, started_at, expires_at, metadata
        )
        VALUES (
          ${userId}, ${profile.id}, ${pkg.id}, ${prepare ? "pending" : "active"}::subscription_status, ${paymentMethod}, ${pricePaid},
          ${now.toISOString()}, ${expiresAt.toISOString()}, ${sql.json({ discountPoints })}
        )
        RETURNING id, started_at, expires_at, status
      `;
      await spendDiscount(sql, {
        userId,
        points: discountPoints,
        subscriptionId: subscription.id,
        reason: `ใช้ส่วนลดซื้อ${pkg.name}`,
      });

      await sql`
        INSERT INTO "Transaction" (id, "userId", type, amount, description, "createdAt")
        VALUES (
          ${crypto.randomUUID()},
          ${userId},
          'debit',
          ${pricePaid},
          ${`เช่า${pkg.name} — ${profile.profile_name}${discountPoints ? ` (ส่วนลด ${discountPoints} Point)` : ""}`},
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
        userEmail: user.email,
        points: updatedUser.points,
        pricePaid,
        discountPoints,
      };
    });

    // The master account is never sent to the customer: the worker adds the customer's
    // email to the profile, then emails the PIN saying it is ready (see libs/pin-rotation/worker).
    runPinWorkerSoon();

    return c.json({
      subscriptionId: result.subscription.id,
      status: result.subscription.status,
      startedAt: result.subscription.started_at,
      expiresAt: result.subscription.expires_at,
      points: result.points,
      pricePaid: result.pricePaid,
      discountPoints: result.discountPoints,
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
          pkg.duration_minutes,
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
          AND ${renewable()}
        FOR UPDATE OF s
      `;

      if (!current) {
        throw new Error(`ต่ออายุรายการนี้ไม่ได้แล้ว (เลยกำหนด ${RENEW_GRACE_HOURS} ชม. หลังหมดอายุ หรือถูกปิด/ต่ออายุไปแล้ว)`);
      }

      const baseDate = new Date(current.expires_at) > new Date()
        ? new Date(current.expires_at)
        : new Date();
      const nextExpiresAt = addMinutes(baseDate, current.duration_minutes);

      if (new Date(current.master_expired_at) < nextExpiresAt) {
        throw new Error("บัญชีแม่หมดอายุก่อนระยะเวลาต่ออายุ กรุณาติดต่อแอดมิน");
      }

      const [user] = await sql`
        SELECT *
        FROM "User"
        WHERE id = ${userId}
          AND status = 'active'
        FOR UPDATE
      `;
      if (!user) throw new Error("ไม่พบบัญชีผู้ใช้");
      const discountPoints = discountPointsFor(user.discount_cents, current.price_amount);
      const pricePaid = Number(current.price_amount) - discountPoints;
      if (user.points < pricePaid) throw new Error("Point ไม่เพียงพอ");

      const [updatedUser] = await sql`
        UPDATE "User"
        SET points = points - ${pricePaid}, "updatedAt" = NOW()
        WHERE id = ${userId}
        RETURNING points
      `;

      const [renewal] = await sql`
        INSERT INTO subscriptions (
          user_id, profile_id, package_id, parent_subscription_id, status,
          payment_method, price_paid, started_at, expires_at, metadata
        )
        VALUES (
          ${userId}, ${current.profile_id}, ${current.package_id}, ${current.id},
          'active', 'points', ${pricePaid}, ${baseDate.toISOString()}, ${nextExpiresAt.toISOString()},
          ${sql.json({ discountPoints })}
        )
        RETURNING id, started_at, expires_at, status
      `;
      await spendDiscount(sql, {
        userId,
        points: discountPoints,
        subscriptionId: renewal.id,
        reason: `ใช้ส่วนลดต่ออายุ${current.package_name}`,
      });
      // A rental renewed during its renewal window is closed; the renewal takes over.
      await sql`
        UPDATE subscriptions SET status = 'expired', updated_at = NOW()
        WHERE id = ${current.id} AND expires_at <= NOW()
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
          ${pricePaid},
          ${`ต่ออายุ${current.package_name}${discountPoints ? ` (ส่วนลด ${discountPoints} Point)` : ""}`},
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
