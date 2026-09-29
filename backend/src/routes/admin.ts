import { Hono } from "hono";
import sql from "../db";
import { getAdminSession, requireAdmin } from "../adminAuth";
import { decryptSecret, encryptSecret } from "../crypto";
import reports from "./reports";

const admin = new Hono();

admin.use("*", requireAdmin);
admin.route("/reports", reports);

function bangkokDateOnlyToUtcIso(value: string, mode: "start" | "end") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = mode === "end" ? 23 : 0;
  const minute = mode === "end" ? 59 : 0;
  const second = mode === "end" ? 59 : 0;
  const millisecond = mode === "end" ? 999 : 0;

  // Bangkok is UTC+7. Convert the local wall-clock date to UTC before storing.
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, second, millisecond)).toISOString();
}

function masterPurchasedAt(value: string | undefined) {
  if (!value) return new Date().toISOString();
  return bangkokDateOnlyToUtcIso(value, "start");
}

function masterExpiredAt(value: string) {
  return bangkokDateOnlyToUtcIso(value, "end");
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

// Profiles without a rental expire with their master email.
function masterExpiryDefault(masterEmailId = "profiles.master_email_id") {
  return `profile_expires_at = (SELECT master_expired_at FROM master_emails WHERE id = ${masterEmailId})`;
}

function maskPromptPayId(value: string) {
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 3)}${"•".repeat(Math.min(6, value.length - 4))}${value.slice(-2)}`;
}

function publicPaymentAccount(row: Record<string, any>) {
  let promptPayIdMasked = "decrypt failed";
  try {
    promptPayIdMasked = maskPromptPayId(decryptSecret(row.promptpay_id_ciphertext));
  } catch {
    promptPayIdMasked = "decrypt failed";
  }

  return {
    id: row.id,
    name: row.name,
    promptPayIdMasked,
    hasLineCookie: Boolean(row.line_cookie_ciphertext),
    status: row.status,
    isDefault: Boolean(row.is_default),
    topupExpiresMinutes: Number(row.topup_expires_minutes),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

admin.get("/inventory", async (c) => {
  const [
    packages,
    masterEmails,
    profiles,
    users,
    paymentAccounts,
    lineTransferEvents,
    metrics,
  ] = await Promise.all([
    sql`
      SELECT
        pkg.*,
        COUNT(p.id) FILTER (
          WHERE (
              p.status = 'available'
              OR (p.status = 'rented' AND p.profile_expires_at <= NOW())
            )
            AND p.deleted_at IS NULL
            AND me.status = 'active'
            AND me.deleted_at IS NULL
            AND me.master_expired_at > NOW()
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
        NULL::uuid AS "packageId",
        NULL::text AS "packageName",
        NULL::text AS "packageSlug",
        me.service,
        me.email,
        me.status,
        me.max_profiles AS "maxProfiles",
        me.purchased_at,
        me.master_expired_at,
        me.note,
        COUNT(p.id)::int AS "profileCount",
        COUNT(p.id) FILTER (
          WHERE (
              p.status = 'available'
              OR (p.status = 'rented' AND p.profile_expires_at <= NOW())
            )
            AND NOT EXISTS (
              SELECT 1
              FROM subscriptions s
              WHERE s.profile_id = p.id
                AND s.status IN ('pending', 'active')
                AND s.expires_at > NOW()
            )
        )::int AS "availableProfiles"
      FROM master_emails me
      LEFT JOIN profiles p ON p.master_email_id = me.id AND p.deleted_at IS NULL
      WHERE me.deleted_at IS NULL
      GROUP BY me.id
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
        NULL::text AS "packageName",
        NULL::text AS "packageSlug"
      FROM profiles p
      JOIN master_emails me ON me.id = p.master_email_id
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
      SELECT *
      FROM payment_accounts
      WHERE deleted_at IS NULL
      ORDER BY is_default DESC, created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT
        lte.id,
        lte.payment_account_id AS "paymentAccountId",
        pa.name AS "paymentAccountName",
        lte.line_revision AS "lineRevision",
        lte.incoming_amount_cents AS "incomingAmountCents",
        lte.balance_cents AS "balanceCents",
        lte.destination_account AS "destinationAccount",
        lte.sender_name AS "senderName",
        lte.from_account AS "fromAccount",
        lte.transfer_type AS "transferType",
        lte.occurred_at AS "occurredAt",
        lte.occurred_raw AS "occurredRaw",
        lte.status,
        lte.matched_topup_id AS "matchedTopUpId",
        lte.match_reason AS "matchReason",
        pt.user_id AS "userId",
        u.email AS "userEmail",
        lte.created_at AS "createdAt"
      FROM line_transfer_events lte
      LEFT JOIN payment_accounts pa ON pa.id = lte.payment_account_id
      LEFT JOIN point_topups pt ON pt.id = lte.matched_topup_id
      LEFT JOIN "User" u ON u.id = pt.user_id
      ORDER BY lte.created_at DESC
      LIMIT 200
    `,
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM packages WHERE status = 'active' AND deleted_at IS NULL) AS "activePackages",
        (SELECT COUNT(*)::int FROM master_emails WHERE status = 'active' AND deleted_at IS NULL) AS "activeMasterEmails",
        (
          SELECT COUNT(*)::int
          FROM profiles p
          WHERE p.deleted_at IS NULL
            AND (
              p.status = 'available'
              OR (p.status = 'rented' AND p.profile_expires_at <= NOW())
            )
            AND NOT EXISTS (
              SELECT 1
              FROM subscriptions s
              WHERE s.profile_id = p.id
                AND s.status IN ('pending', 'active')
                AND s.expires_at > NOW()
            )
        ) AS "availableProfiles",
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
    paymentAccounts: paymentAccounts.map(publicPaymentAccount),
    lineTransferEvents,
    metrics: metrics[0],
  });
});

admin.post("/payment-accounts", async (c) => {
  const actor = await getAdminSession(c);
  const body = await c.req.json<{
    name: string;
    promptPayId: string;
    lineCookie?: string | null;
    status?: "active" | "inactive";
    isDefault?: boolean;
    topupExpiresMinutes?: number;
    note?: string | null;
  }>();

  const name = body.name?.trim();
  const promptPayId = body.promptPayId?.trim();
  const topupExpiresMinutes = Number(body.topupExpiresMinutes ?? 15);

  if (!name || !promptPayId) {
    return c.json({ message: "name and promptPayId required" }, 400);
  }
  if (!Number.isInteger(topupExpiresMinutes) || topupExpiresMinutes < 1 || topupExpiresMinutes > 1440) {
    return c.json({ message: "เวลาหมดอายุ QR ต้องอยู่ระหว่าง 1-1440 นาที" }, 400);
  }
  if (body.isDefault === true && body.status === "inactive") {
    return c.json({ message: "บัญชี default ต้องเป็น active" }, 400);
  }

  const account = await sql.begin(async (db) => {
    const [currentDefault] = await db`
      SELECT id
      FROM payment_accounts
      WHERE is_default = TRUE
        AND deleted_at IS NULL
      LIMIT 1
    `;
    const isActive = (body.status ?? "active") === "active";
    const shouldDefault = isActive && (Boolean(body.isDefault) || !currentDefault);

    if (shouldDefault) {
      await db`
        UPDATE payment_accounts
        SET is_default = FALSE, updated_at = NOW()
        WHERE is_default = TRUE
          AND deleted_at IS NULL
      `;
    }

    const [created] = await db`
      INSERT INTO payment_accounts (
        name,
        promptpay_id_ciphertext,
        line_cookie_ciphertext,
        status,
        is_default,
        topup_expires_minutes,
        note
      )
      VALUES (
        ${name},
        ${encryptSecret(promptPayId)},
        ${body.lineCookie ? encryptSecret(body.lineCookie) : null},
        ${body.status ?? "active"},
        ${shouldDefault},
        ${topupExpiresMinutes},
        ${body.note ?? null}
      )
      RETURNING *
    `;

    await db`
      INSERT INTO admin_audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (
        ${actor?.id ?? null},
        'payment_account.created',
        'payment_account',
        ${created.id},
        ${JSON.stringify({
          name,
          status: body.status ?? "active",
          isDefault: shouldDefault,
          hasLineCookie: Boolean(body.lineCookie),
          topupExpiresMinutes,
        })}
      )
    `;

    return created;
  });

  return c.json(publicPaymentAccount(account), 201);
});

admin.patch("/payment-accounts/:id", async (c) => {
  const id = c.req.param("id");
  const actor = await getAdminSession(c);
  const body = await c.req.json<{
    name?: string;
    promptPayId?: string;
    lineCookie?: string | null;
    status?: "active" | "inactive";
    isDefault?: boolean;
    topupExpiresMinutes?: number;
    note?: string | null;
  }>();

  if (
    body.topupExpiresMinutes !== undefined
    && (!Number.isInteger(Number(body.topupExpiresMinutes))
      || Number(body.topupExpiresMinutes) < 1
      || Number(body.topupExpiresMinutes) > 1440)
  ) {
    return c.json({ message: "เวลาหมดอายุ QR ต้องอยู่ระหว่าง 1-1440 นาที" }, 400);
  }
  if (body.isDefault === true && body.status === "inactive") {
    return c.json({ message: "บัญชี default ต้องเป็น active" }, 400);
  }

  try {
    const account = await sql.begin(async (db) => {
      const [current] = await db`
        SELECT *
        FROM payment_accounts
        WHERE id = ${id}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!current) throw new Error("ไม่พบบัญชีรับเงิน");

      const sets: string[] = [];
      const values: unknown[] = [];
      if (body.name !== undefined) addUpdate(sets, values, "name", body.name.trim());
      if (body.promptPayId) {
        addUpdate(sets, values, "promptpay_id_ciphertext", encryptSecret(body.promptPayId.trim()));
      }
      if (body.lineCookie !== undefined && body.lineCookie !== "") {
        addUpdate(
          sets,
          values,
          "line_cookie_ciphertext",
          body.lineCookie === null ? null : encryptSecret(body.lineCookie),
        );
      }
      if (body.status !== undefined) addUpdate(sets, values, "status", body.status);
      if (body.topupExpiresMinutes !== undefined) {
        addUpdate(sets, values, "topup_expires_minutes", Number(body.topupExpiresMinutes));
      }
      if (body.note !== undefined) addUpdate(sets, values, "note", body.note);

      if (body.isDefault === true) {
        await db`
          UPDATE payment_accounts
          SET is_default = FALSE, updated_at = NOW()
          WHERE id <> ${id}::uuid
            AND is_default = TRUE
            AND deleted_at IS NULL
        `;
        addUpdate(sets, values, "is_default", true);
      } else if ((body.isDefault === false || body.status === "inactive") && current.is_default) {
        const [otherActive] = await db`
          SELECT id
          FROM payment_accounts
          WHERE id <> ${id}::uuid
            AND status = 'active'
            AND deleted_at IS NULL
          ORDER BY created_at ASC
          LIMIT 1
        `;
        if (!otherActive) throw new Error("ต้องมีบัญชีรับเงิน default อย่างน้อย 1 บัญชี");
        addUpdate(sets, values, "is_default", false);
        await db`
          UPDATE payment_accounts
          SET is_default = TRUE, updated_at = NOW()
          WHERE id = ${otherActive.id}
        `;
      }

      if (!sets.length) throw new Error("Nothing to update");
      values.push(id);

      const [updated] = await db.unsafe(
        `
        UPDATE payment_accounts
        SET ${sets.join(", ")}, updated_at = NOW()
        WHERE id = $${values.length}::uuid
          AND deleted_at IS NULL
        RETURNING *
        `,
        values,
      );

      await db`
        INSERT INTO admin_audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
        VALUES (
          ${actor?.id ?? null},
          'payment_account.updated',
          'payment_account',
          ${id},
          ${JSON.stringify({
            before: {
              id: current.id,
              name: current.name,
              status: current.status,
              isDefault: current.is_default,
              topupExpiresMinutes: current.topup_expires_minutes,
              hasLineCookie: Boolean(current.line_cookie_ciphertext),
            },
            after: {
              id: updated.id,
              name: updated.name,
              status: updated.status,
              isDefault: updated.is_default,
              topupExpiresMinutes: updated.topup_expires_minutes,
              hasLineCookie: Boolean(updated.line_cookie_ciphertext),
            },
          })}
        )
      `;

      return updated;
    });

    return c.json(publicPaymentAccount(account));
  } catch (err) {
    return c.json(
      { message: err instanceof Error ? err.message : "แก้ไขบัญชีรับเงินไม่สำเร็จ" },
      400,
    );
  }
});

admin.post("/payment-accounts/:id/default", async (c) => {
  const id = c.req.param("id");
  const actor = await getAdminSession(c);

  try {
    const account = await sql.begin(async (db) => {
      const [current] = await db`
        SELECT id
        FROM payment_accounts
        WHERE id = ${id}::uuid
          AND status = 'active'
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (!current) throw new Error("ไม่พบบัญชีรับเงินที่ active");

      await db`
        UPDATE payment_accounts
        SET is_default = FALSE, updated_at = NOW()
        WHERE is_default = TRUE
          AND deleted_at IS NULL
      `;

      const [updated] = await db`
        UPDATE payment_accounts
        SET is_default = TRUE, updated_at = NOW()
        WHERE id = ${id}::uuid
        RETURNING *
      `;

      await db`
        INSERT INTO admin_audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
        VALUES (
          ${actor?.id ?? null},
          'payment_account.default_set',
          'payment_account',
          ${id},
          ${JSON.stringify({ name: updated.name })}
        )
      `;

      return updated;
    });

    return c.json(publicPaymentAccount(account));
  } catch (err) {
    return c.json(
      { message: err instanceof Error ? err.message : "ตั้งบัญชี default ไม่สำเร็จ" },
      400,
    );
  }
});

admin.delete("/payment-accounts/:id", async (c) => {
  const id = c.req.param("id");
  const actor = await getAdminSession(c);

  try {
    await sql.begin(async (db) => {
      const [current] = await db`
        SELECT *
        FROM payment_accounts
        WHERE id = ${id}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!current) throw new Error("ไม่พบบัญชีรับเงิน");

      const [pending] = await db`
        SELECT COUNT(*)::int AS count
        FROM point_topups
        WHERE payment_account_id = ${id}::uuid
          AND status = 'pending'
          AND expires_at >= NOW()
      `;
      if (Number(pending.count) > 0) {
        throw new Error("ยังมีรายการเติมเงิน pending ของบัญชีนี้ กรุณารอให้หมดอายุหรือปิดบัญชีก่อน");
      }

      await db`
        UPDATE payment_accounts
        SET
          status = 'inactive',
          is_default = FALSE,
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE id = ${id}::uuid
      `;

      if (current.is_default) {
        await db`
          UPDATE payment_accounts
          SET is_default = TRUE, updated_at = NOW()
          WHERE id = (
            SELECT id
            FROM payment_accounts
            WHERE status = 'active'
              AND deleted_at IS NULL
            ORDER BY created_at ASC
            LIMIT 1
          )
        `;
      }

      await db`
        INSERT INTO admin_audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
        VALUES (
          ${actor?.id ?? null},
          'payment_account.deleted',
          'payment_account',
          ${id},
          ${JSON.stringify({
            name: current.name,
            wasDefault: current.is_default,
            hasLineCookie: Boolean(current.line_cookie_ciphertext),
          })}
        )
      `;
    });

    return c.json({ ok: true });
  } catch (err) {
    return c.json(
      { message: err instanceof Error ? err.message : "ลบบัญชีรับเงินไม่สำเร็จ" },
      400,
    );
  }
});

admin.get("/automation/master-emails", async (c) => {
  const service = c.req.query("service") ?? "netflix";
  const email = c.req.query("email");

  const accounts = await sql`
    SELECT
      me.id,
      NULL::uuid AS "packageId",
      NULL::text AS "packageName",
      NULL::text AS "packageSlug",
      me.service,
      me.email,
      me.password_ciphertext,
      me.status,
      me.master_expired_at,
      me.note,
      me.max_profiles AS "maxProfiles",
      COUNT(p.id)::int AS "profileCount",
      COUNT(p.id) FILTER (
        WHERE p.deleted_at IS NULL
          AND (
            p.status = 'available'
            OR (p.status = 'rented' AND p.profile_expires_at <= NOW())
          )
          AND NOT EXISTS (
            SELECT 1
            FROM subscriptions s
            WHERE s.profile_id = p.id
              AND s.status IN ('pending', 'active')
              AND s.expires_at > NOW()
          )
      )::int AS "availableProfiles"
    FROM master_emails me
    LEFT JOIN profiles p ON p.master_email_id = me.id AND p.deleted_at IS NULL
    WHERE me.deleted_at IS NULL
      AND me.status = 'active'
      AND me.master_expired_at > NOW()
      AND me.service = ${service}
      AND (${email ?? null}::text IS NULL OR me.email = ${email ?? null})
    GROUP BY me.id
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
        maxProfiles: account.maxProfiles,
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

  const [room] = await sql`
    SELECT id, email, max_profiles, master_expired_at
    FROM master_emails
    WHERE id = ${body.masterEmailId}::uuid
      AND deleted_at IS NULL
  `;
  if (!room) return c.json({ message: "ไม่พบห้องบัญชีแม่" }, 404);

  const [countRow] = await sql`
    SELECT COUNT(*)::int AS count
    FROM profiles
    WHERE master_email_id = ${body.masterEmailId}::uuid
      AND deleted_at IS NULL
  `;
  const currentCount = Number(countRow.count);
  const maxProfiles = Number(room.max_profiles);
  const validItems = body.profiles.filter((item) => item.profileName);
  if (currentCount + validItems.length > maxProfiles) {
    return c.json({
      message: `ห้องนี้รองรับสูงสุด ${maxProfiles} profile (ปัจจุบัน ${currentCount}) ไม่สามารถเพิ่มได้อีก ${validItems.length} profile`,
    }, 400);
  }

  const created = [];
  for (const item of validItems) {
    const [profile] = await sql`
      INSERT INTO profiles (
        master_email_id, profile_name, profile_pin_ciphertext, status, profile_expires_at, note
      )
      VALUES (
        ${body.masterEmailId}::uuid,
        ${item.profileName},
        ${item.pin ? encryptSecret(item.pin) : null},
        ${item.status ?? "available"},
        ${item.profileExpiresAt ? bangkokDateOnlyToUtcIso(item.profileExpiresAt, "end") : room.master_expired_at},
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
    service?: string;
    email: string;
    password: string;
    purchasedAt?: string;
    masterExpiredAt: string;
    status?: "active" | "inactive" | "expired" | "suspended";
    maxProfiles?: number;
    note?: string;
  }>();

  if (!body.service || !body.email || !body.password || !body.masterExpiredAt) {
    return c.json({ message: "service, email, password, masterExpiredAt required" }, 400);
  }

  const service = body.service.trim().toLowerCase();
  if (!service) return c.json({ message: "กรุณาระบุ service ของห้อง" }, 400);

  const maxProfiles = Number(body.maxProfiles ?? 5);
  if (!Number.isInteger(maxProfiles) || maxProfiles < 1 || maxProfiles > 100) {
    return c.json({ message: "จำนวน profile สูงสุดต้องอยู่ระหว่าง 1-100" }, 400);
  }

  const [account] = await sql`
    INSERT INTO master_emails (
      service, email, password_ciphertext, status, purchased_at, master_expired_at, max_profiles, note
    )
    VALUES (
      ${service},
      ${body.email},
      ${encryptSecret(body.password)},
      ${body.status ?? "active"},
      ${masterPurchasedAt(body.purchasedAt)},
      ${masterExpiredAt(body.masterExpiredAt)},
      ${maxProfiles},
      ${body.note ?? null}
    )
    RETURNING id, NULL::uuid AS "packageId", service, email, status, max_profiles AS "maxProfiles", purchased_at, master_expired_at, note
  `;

  return c.json(account, 201);
});

admin.patch("/master-emails/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    service?: string;
    email?: string;
    password?: string;
    purchasedAt?: string;
    masterExpiredAt?: string;
    status?: "active" | "inactive" | "expired" | "suspended";
    maxProfiles?: number;
    note?: string | null;
  }>();

  if (body.maxProfiles !== undefined) {
    const mp = Number(body.maxProfiles);
    if (!Number.isInteger(mp) || mp < 1 || mp > 100) {
      return c.json({ message: "จำนวน profile สูงสุดต้องอยู่ระหว่าง 1-100" }, 400);
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.service !== undefined) {
    const service = body.service.trim().toLowerCase();
    if (!service) return c.json({ message: "กรุณาระบุ service ของห้อง" }, 400);
    addUpdate(sets, values, "service", service);
    addUpdate(sets, values, "package_id", null);
  }
  if (body.email !== undefined) addUpdate(sets, values, "email", body.email);
  if (body.password) addUpdate(sets, values, "password_ciphertext", encryptSecret(body.password));
  if (body.purchasedAt !== undefined) addUpdate(sets, values, "purchased_at", masterPurchasedAt(body.purchasedAt));
  if (body.masterExpiredAt !== undefined) addUpdate(sets, values, "master_expired_at", masterExpiredAt(body.masterExpiredAt));
  if (body.status !== undefined) addUpdate(sets, values, "status", body.status, "::master_email_status");
  if (body.maxProfiles !== undefined) addUpdate(sets, values, "max_profiles", Number(body.maxProfiles));
  if (body.note !== undefined) addUpdate(sets, values, "note", body.note);

  if (!sets.length) return c.json({ message: "Nothing to update" }, 400);
  values.push(id);

  const [previous] = await sql`
    SELECT master_expired_at FROM master_emails WHERE id = ${id}::uuid AND deleted_at IS NULL
  `;

  const [account] = await sql.unsafe(
    `
    UPDATE master_emails
    SET ${sets.join(", ")}, updated_at = NOW()
    WHERE id = $${values.length}::uuid
      AND deleted_at IS NULL
    RETURNING id, NULL::uuid AS "packageId", service, email, status, max_profiles AS "maxProfiles", purchased_at, master_expired_at, note
    `,
    values,
  );

  if (!account) return c.json({ message: "ไม่พบห้องบัญชีแม่" }, 404);

  if (previous && body.masterExpiredAt !== undefined) {
    await sql`
      UPDATE profiles p
      SET profile_expires_at = ${account.master_expired_at}, updated_at = NOW()
      WHERE p.master_email_id = ${id}::uuid
        AND p.deleted_at IS NULL
        AND (p.profile_expires_at IS NULL OR p.profile_expires_at = ${previous.master_expired_at})
        AND NOT EXISTS (
          SELECT 1
          FROM subscriptions s
          WHERE s.profile_id = p.id
            AND s.status IN ('pending', 'active')
            AND s.expires_at > NOW()
        )
    `;
  }

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

  try {
    const profile = await sql.begin(async (db) => {
      const [room] = await db`
        SELECT id, email, max_profiles, master_expired_at
        FROM master_emails
        WHERE id = ${body.masterEmailId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!room) throw new Error("ไม่พบห้องบัญชีแม่");

      const [countRow] = await db`
        SELECT COUNT(*)::int AS count
        FROM profiles
        WHERE master_email_id = ${body.masterEmailId}::uuid
          AND deleted_at IS NULL
      `;
      if (Number(countRow.count) >= Number(room.max_profiles)) {
        throw new Error(`ห้องนี้รองรับสูงสุด ${room.max_profiles} profile แล้ว (ปัจจุบัน ${countRow.count})`);
      }

      const [created] = await db`
        INSERT INTO profiles (
          master_email_id, profile_name, profile_pin_ciphertext, status, profile_expires_at, note
        )
        VALUES (
          ${body.masterEmailId}::uuid,
          ${body.profileName},
          ${body.pin ? encryptSecret(body.pin) : null},
          ${body.status ?? "available"},
          ${body.profileExpiresAt ? bangkokDateOnlyToUtcIso(body.profileExpiresAt, "end") : room.master_expired_at},
          ${body.note ?? null}
        )
        RETURNING id, master_email_id, profile_name, status, profile_expires_at, note
      `;
      return created;
    });

    return c.json(profile, 201);
  } catch (err) {
    return c.json({ message: err instanceof Error ? err.message : "เพิ่ม profile ไม่สำเร็จ" }, 400);
  }
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
  if (body.profileExpiresAt) {
    addUpdate(sets, values, "profile_expires_at", bangkokDateOnlyToUtcIso(body.profileExpiresAt, "end"));
  } else if (body.profileExpiresAt !== undefined) {
    sets.push(masterExpiryDefault());
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
  if (body.profileExpiresAt) {
    addUpdate(sets, values, "profile_expires_at", bangkokDateOnlyToUtcIso(body.profileExpiresAt, "end"));
  } else if (body.profileExpiresAt !== undefined) {
    if (body.masterEmailId !== undefined) {
      values.push(body.masterEmailId);
      sets.push(masterExpiryDefault(`$${values.length}::uuid`));
    } else {
      sets.push(masterExpiryDefault());
    }
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
