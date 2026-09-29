import { randomInt } from "node:crypto";
import sql from "../../db";
import { decryptSecret, encryptSecret } from "../../crypto";
import { sendPlainEmail } from "../gmail/mailsender";

/**
 * When a rental ends, the profile's lock PIN is changed through the Python
 * pin-service (see /pin-service) so the previous customer loses access, then the
 * slot goes back on sale and the customer is emailed. Off unless PIN_SERVICE_URL
 * and PIN_SERVICE_KEY are set.
 */

const CHECK_INTERVAL_MS = 60 * 1000;
export const MAX_ROTATION_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

let running = false;

type ExpiredRental = {
  subscription_id: string;
  profile_id: string;
  expires_at: Date;
  user_email: string;
  package_name: string;
  profile_name: string;
  profile_deleted: boolean;
  master_email: string;
  password_ciphertext: string;
  account_pin_ciphertext: string | null;
  failures: number;
};

// Latest ended rental per profile, skipping profiles that already have a follow-up rental.
async function findExpiredRentals(profileId: string | null = null) {
  return sql<ExpiredRental[]>`
    SELECT DISTINCT ON (s.profile_id)
      s.id AS subscription_id,
      s.profile_id,
      s.expires_at,
      u.email AS user_email,
      pkg.name AS package_name,
      p.profile_name,
      (p.deleted_at IS NOT NULL OR me.deleted_at IS NOT NULL) AS profile_deleted,
      me.email AS master_email,
      me.password_ciphertext,
      me.account_pin_ciphertext,
      (SELECT COUNT(*) FROM subscription_events se
        WHERE se.subscription_id = s.id AND se.event_type = 'pin_rotation_failed')::int AS failures
    FROM subscriptions s
    JOIN "User" u ON u.id = s.user_id
    JOIN packages pkg ON pkg.id = s.package_id
    JOIN profiles p ON p.id = s.profile_id
    JOIN master_emails me ON me.id = p.master_email_id
    WHERE s.status = 'active'
      AND s.expires_at <= NOW()
      AND (${profileId}::uuid IS NULL OR s.profile_id = ${profileId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM subscriptions n
        WHERE n.profile_id = s.profile_id
          AND n.status IN ('pending', 'active')
          AND n.expires_at > NOW()
      )
    ORDER BY s.profile_id, s.expires_at DESC
  `;
}

async function logEvent(subscriptionId: string, eventType: string, message: string) {
  await sql`
    INSERT INTO subscription_events (subscription_id, actor_user_id, event_type, message)
    VALUES (${subscriptionId}, NULL, ${eventType}, ${message})
  `;
}

async function expireRentals(profileId: string) {
  await sql`
    UPDATE subscriptions
    SET status = 'expired', updated_at = NOW()
    WHERE profile_id = ${profileId}::uuid AND status = 'active' AND expires_at <= NOW()
  `;
}

async function sendExpiredEmail(rental: ExpiredRental, { pinChanged }: { pinChanged: boolean }) {
  const expiredAt = new Date(rental.expires_at).toLocaleString("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
  const site = process.env.WEB_ORIGIN;
  const text = [
    "แพ็กเกจของคุณหมดอายุแล้ว",
    "",
    `แพ็กเกจ: ${rental.package_name}`,
    `โปรไฟล์: ${rental.profile_name}`,
    `หมดอายุเมื่อ: ${expiredAt} น.`,
    "",
    pinChanged
      ? "ระบบได้เปลี่ยน PIN ของโปรไฟล์นี้แล้ว จึงไม่สามารถใช้งานต่อได้"
      : "โปรไฟล์นี้ไม่สามารถใช้งานต่อได้แล้ว",
    `หากต้องการใช้งานต่อ สามารถเลือกซื้อแพ็กเกจใหม่ได้ที่เว็บไซต์${site ? ` ${site}` : ""}`,
    "",
    "ขอบคุณที่ใช้บริการครับ",
    "อีเมลนี้ส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับ",
  ].join("\n");
  try {
    await sendPlainEmail({ to: rental.user_email, subject: `แพ็กเกจจอ ${rental.profile_name} หมดอายุแล้ว`, text });
    await logEvent(rental.subscription_id, "expiry_email_sent", `Expiry email sent to ${rental.user_email}`);
  } catch (err) {
    console.error(`[pin-rotation] expiry email failed sub=${rental.subscription_id}`, err instanceof Error ? err.message : err);
  }
}

async function rotate(rental: ExpiredRental, serviceUrl: string, serviceKey: string) {
  const newPin = String(randomInt(0, 10000)).padStart(4, "0");
  // Keep the new PIN before touching Netflix so it is never lost if the DB update below fails.
  await sql`
    UPDATE profiles
    SET metadata = metadata || ${sql.json({ pendingPinCiphertext: encryptSecret(newPin) })}, updated_at = NOW()
    WHERE id = ${rental.profile_id}::uuid
  `;

  const attempt = rental.failures + 1;
  try {
    const response = await fetch(`${serviceUrl.replace(/\/+$/, "")}/rotate-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-key": serviceKey },
      body: JSON.stringify({
        masterEmail: rental.master_email,
        masterPassword: decryptSecret(rental.password_ciphertext),
        accountPin: rental.account_pin_ciphertext ? decryptSecret(rental.account_pin_ciphertext) : null,
        profileName: rental.profile_name,
        newPin,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => ({}))) as { success?: boolean; reason?: string };
    if (!response.ok || !data.success) throw new Error(data.reason ?? `HTTP ${response.status}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await logEvent(
      rental.subscription_id,
      "pin_rotation_failed",
      `Attempt ${attempt}/${MAX_ROTATION_ATTEMPTS}: ${reason}`.slice(0, 500),
    );
    console.error(`[pin-rotation] failed sub=${rental.subscription_id} attempt=${attempt} reason=${reason}`);
    return;
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE profiles p
      SET profile_pin_ciphertext = ${encryptSecret(newPin)},
          status = 'available',
          profile_expires_at = me.master_expired_at,
          metadata = p.metadata - 'pendingPinCiphertext',
          updated_at = NOW()
      FROM master_emails me
      WHERE p.id = ${rental.profile_id}::uuid AND me.id = p.master_email_id
    `;
    await tx`
      UPDATE subscriptions
      SET status = 'expired', updated_at = NOW()
      WHERE profile_id = ${rental.profile_id}::uuid AND status = 'active' AND expires_at <= NOW()
    `;
    await tx`
      INSERT INTO subscription_events (subscription_id, actor_user_id, event_type, message)
      VALUES (${rental.subscription_id}, NULL, 'pin_rotated', ${`Profile ${rental.profile_name} PIN rotated`})
    `;
  });
  console.log(`[pin-rotation] rotated profile=${rental.profile_name} sub=${rental.subscription_id}`);
  await sendExpiredEmail(rental, { pinChanged: true });
}

async function checkExpiredRentals(serviceUrl: string, serviceKey: string) {
  const rentals = await findExpiredRentals();
  if (rentals.length === 0) return;

  // Hold every ended slot first so it cannot be sold while its PIN is still the old one.
  const heldIds = rentals.filter((rental) => !rental.profile_deleted).map((rental) => rental.profile_id);
  if (heldIds.length) {
    await sql`
      UPDATE profiles SET status = 'reserved', updated_at = NOW()
      WHERE id = ANY(${heldIds}::uuid[]) AND status <> 'reserved'
    `;
  }

  for (const rental of rentals) {
    if (rental.profile_deleted) {
      await expireRentals(rental.profile_id);
      await sendExpiredEmail(rental, { pinChanged: false });
      continue;
    }
    if (rental.failures >= MAX_ROTATION_ATTEMPTS) continue; // left reserved for an admin
    await rotate(rental, serviceUrl, serviceKey);
  }
}

export function pinRotationEnabled() {
  return Boolean(process.env.PIN_SERVICE_URL && process.env.PIN_SERVICE_KEY);
}

/**
 * Admin action: end the running rental on a profile now. With PIN rotation on, the
 * worker picks it up within a minute (new PIN, slot released, customer emailed);
 * otherwise the slot is released right away and the customer is emailed.
 * Returns how many rentals were ended.
 */
export async function expireProfileRentalNow(profileId: string, actorUserId: string | null) {
  const ended = await sql.begin(async (tx) => {
    // Renewals that have not started yet are cancelled outright.
    const cancelled = await tx`
      UPDATE subscriptions
      SET status = 'cancelled', cancelled_at = started_at, updated_at = NOW()
      WHERE profile_id = ${profileId}::uuid AND status IN ('pending', 'active') AND started_at > NOW()
      RETURNING id
    `;
    const current = await tx`
      UPDATE subscriptions
      SET expires_at = GREATEST(NOW(), started_at + INTERVAL '1 millisecond'), updated_at = NOW()
      WHERE profile_id = ${profileId}::uuid AND status IN ('pending', 'active') AND expires_at > NOW()
      RETURNING id
    `;
    const ids = [...cancelled, ...current].map((row) => row.id as string);
    for (const id of ids) {
      await tx`
        INSERT INTO subscription_events (subscription_id, actor_user_id, event_type, message)
        VALUES (${id}, ${actorUserId}, 'expired_by_admin', 'Rental ended early by an admin')
      `;
    }
    return ids.length;
  });
  if (ended === 0 || pinRotationEnabled()) return ended;

  for (const rental of await findExpiredRentals(profileId)) {
    await expireRentals(rental.profile_id);
    await sql`
      UPDATE profiles p
      SET status = 'available', profile_expires_at = me.master_expired_at, updated_at = NOW()
      FROM master_emails me
      WHERE p.id = ${rental.profile_id}::uuid AND me.id = p.master_email_id AND p.deleted_at IS NULL
    `;
    await sendExpiredEmail(rental, { pinChanged: false });
  }
  return ended;
}

export function startPinRotationWorker() {
  const serviceUrl = process.env.PIN_SERVICE_URL;
  const serviceKey = process.env.PIN_SERVICE_KEY;
  if (!serviceUrl || !serviceKey) {
    console.log("[pin-rotation] disabled (set PIN_SERVICE_URL and PIN_SERVICE_KEY to enable)");
    return;
  }

  const tick = () => {
    if (running) return;
    running = true;
    checkExpiredRentals(serviceUrl, serviceKey)
      .catch((err) => console.error("[pin-rotation] check failed", err instanceof Error ? err.message : err))
      .finally(() => {
        running = false;
      });
  };
  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
  console.log(`[pin-rotation] started (interval=${CHECK_INTERVAL_MS / 1000}s url=${serviceUrl})`);
}
