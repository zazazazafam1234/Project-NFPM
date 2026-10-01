import { randomInt } from "node:crypto";
import sql from "../../db";
import { decryptSecret, encryptSecret } from "../../crypto";
import { sendPlainEmail } from "../gmail/mailsender";

/**
 * After a purchase the customer's email is added to the rented Netflix profile
 * (pin-service POST /profile-email, action "add"); the email now on the profile
 * is kept in profiles.metadata.profileEmail.
 *
 * When a rental ends the slot is held and the customer gets RENEW_GRACE_HOURS to
 * renew with the same profile and PIN (emailed a renew link). After that — or right
 * away when an admin ends the rental — the profile's lock PIN is changed through
 * the Python pin-service (see /pin-service), after removing the customer's email
 * from the profile; then the slot goes back on sale and the customer is emailed. Without PIN_SERVICE_URL and PIN_SERVICE_KEY the last step
 * only expires the rental, releases the slot and emails.
 */

export const RENEW_GRACE_HOURS = 12;
const CHECK_INTERVAL_MS = 60 * 1000;
export const MAX_ROTATION_ATTEMPTS = 3;
const MAX_EMAIL_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

let running = false;
let tick: (() => void) | null = null;

type Service = { url: string; key: string };

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
  mailbox_password_ciphertext: string | null;
  profile_email: string | null;
  failures: number;
};

// Latest ended rental per profile whose renewal window is over (or that an admin
// ended, or whose slot was deleted), skipping profiles with a follow-up rental.
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
      me.mailbox_password_ciphertext,
      p.metadata->>'profileEmail' AS profile_email,
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
      AND (
        s.expires_at <= NOW() - make_interval(hours => ${RENEW_GRACE_HOURS})
        OR p.deleted_at IS NOT NULL
        OR me.deleted_at IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM subscription_events se
          WHERE se.subscription_id = s.id AND se.event_type = 'expired_by_admin'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM subscriptions n
        WHERE n.profile_id = s.profile_id
          AND n.status IN ('pending', 'active')
          AND n.expires_at > NOW()
      )
    ORDER BY s.profile_id, s.expires_at DESC
  `;
}

type GraceRental = Pick<ExpiredRental, "subscription_id" | "profile_id" | "expires_at" | "user_email" | "package_name" | "profile_name">;

// Rentals that just ended and have not been told about the renewal window yet.
async function findRentalsEnteringGrace() {
  return sql<GraceRental[]>`
    SELECT DISTINCT ON (s.profile_id)
      s.id AS subscription_id, s.profile_id, s.expires_at,
      u.email AS user_email, pkg.name AS package_name, p.profile_name
    FROM subscriptions s
    JOIN "User" u ON u.id = s.user_id
    JOIN packages pkg ON pkg.id = s.package_id
    JOIN profiles p ON p.id = s.profile_id
    JOIN master_emails me ON me.id = p.master_email_id
    WHERE s.status = 'active'
      AND s.expires_at <= NOW()
      AND s.expires_at > NOW() - make_interval(hours => ${RENEW_GRACE_HOURS})
      AND p.deleted_at IS NULL
      AND me.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM subscription_events se
        WHERE se.subscription_id = s.id AND se.event_type IN ('renewal_notice_sent', 'expired_by_admin')
      )
      AND NOT EXISTS (
        SELECT 1 FROM subscriptions n
        WHERE n.profile_id = s.profile_id
          AND n.status IN ('pending', 'active')
          AND n.expires_at > NOW()
      )
    ORDER BY s.profile_id, s.expires_at DESC
  `;
}

function formatBangkok(value: Date | string) {
  return new Date(value).toLocaleString("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
}

// Holds the slot (no sale, PIN untouched) and emails a renew link.
async function startRenewalWindow(rental: GraceRental) {
  await sql`
    UPDATE profiles SET status = 'reserved', updated_at = NOW()
    WHERE id = ${rental.profile_id}::uuid AND status <> 'reserved'
  `;
  const deadline = new Date(new Date(rental.expires_at).getTime() + RENEW_GRACE_HOURS * 60 * 60 * 1000);
  const site = (process.env.WEB_ORIGIN ?? "").replace(/\/+$/, "");
  const text = [
    "แพ็กเกจของคุณหมดอายุแล้ว",
    "",
    `แพ็กเกจ: ${rental.package_name}`,
    `โปรไฟล์: ${rental.profile_name}`,
    `หมดอายุเมื่อ: ${formatBangkok(rental.expires_at)} น.`,
    "",
    `คุณยังต่ออายุได้ภายใน ${RENEW_GRACE_HOURS} ชั่วโมง (ถึง ${formatBangkok(deadline)} น.)`,
    "ต่ออายุแล้วใช้โปรไฟล์และ PIN เดิมได้ทันที",
    ...(site ? ["", `ต่ออายุที่: ${site}/profile?renew=${rental.subscription_id}`] : []),
    "",
    "หากไม่ต่ออายุภายในเวลาที่กำหนด ระบบจะปิดการใช้งานโปรไฟล์นี้",
    "",
    "ขอบคุณที่ใช้บริการครับ",
    "อีเมลนี้ส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับ",
  ].join("\n");
  try {
    await sendPlainEmail({
      to: rental.user_email,
      subject: `แพ็กเกจจอ ${rental.profile_name} หมดอายุแล้ว — ต่ออายุได้ภายใน ${RENEW_GRACE_HOURS} ชม.`,
      text,
    });
    console.log(`[pin-rotation] 📧 ส่งเมลให้ต่ออายุภายใน ${RENEW_GRACE_HOURS} ชม. profile=${rental.profile_name} to=${rental.user_email}`);
  } catch (err) {
    console.error(
      `[pin-rotation] ❌ ส่งเมลให้ต่ออายุไม่สำเร็จ profile=${rental.profile_name} to=${rental.user_email}`,
      err instanceof Error ? err.message : err,
    );
  }
  // Logged even if the email failed so the customer is not emailed every minute.
  await logEvent(rental.subscription_id, "renewal_notice_sent", `Renewal window until ${deadline.toISOString()}`);
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
    console.log(`[pin-rotation] 📧 ส่งเมลแจ้งหมดอายุแล้ว profile=${rental.profile_name} to=${rental.user_email}`);
  } catch (err) {
    console.error(
      `[pin-rotation] ❌ ส่งเมลแจ้งหมดอายุไม่สำเร็จ profile=${rental.profile_name} to=${rental.user_email}`,
      err instanceof Error ? err.message : err,
    );
  }
}

// Throws with the pin-service's reason unless it reports success.
async function callService(service: Service, path: string, body: Record<string, unknown>) {
  const response = await fetch(`${service.url.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-service-key": service.key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => ({}))) as { success?: boolean; reason?: string };
  if (!response.ok || !data.success) throw new Error(data.reason ?? `HTTP ${response.status}`);
  return data.reason ?? "ok";
}

function masterLogin(rental: Pick<ExpiredRental, "master_email" | "password_ciphertext" | "account_pin_ciphertext" | "mailbox_password_ciphertext" | "profile_name">) {
  return {
    masterEmail: rental.master_email,
    masterPassword: decryptSecret(rental.password_ciphertext),
    accountPin: rental.account_pin_ciphertext ? decryptSecret(rental.account_pin_ciphertext) : null,
    mailboxPassword: rental.mailbox_password_ciphertext ? decryptSecret(rental.mailbox_password_ciphertext) : null,
    profileName: rental.profile_name,
  };
}

type EmailJob = Omit<ExpiredRental, "expires_at" | "package_name" | "profile_deleted">;

// Running rentals whose profile does not carry the customer's email yet.
async function findRentalsNeedingEmail() {
  return sql<EmailJob[]>`
    SELECT
      s.id AS subscription_id,
      s.profile_id,
      u.email AS user_email,
      p.profile_name,
      me.email AS master_email,
      me.password_ciphertext,
      me.account_pin_ciphertext,
      me.mailbox_password_ciphertext,
      p.metadata->>'profileEmail' AS profile_email,
      (SELECT COUNT(*) FROM subscription_events se
        WHERE se.subscription_id = s.id AND se.event_type = 'profile_email_add_failed')::int AS failures
    FROM subscriptions s
    JOIN "User" u ON u.id = s.user_id
    JOIN profiles p ON p.id = s.profile_id
    JOIN master_emails me ON me.id = p.master_email_id
    WHERE s.status = 'active'
      AND s.started_at <= NOW()
      AND s.expires_at > NOW()
      AND p.deleted_at IS NULL
      AND me.deleted_at IS NULL
      AND LOWER(COALESCE(p.metadata->>'profileEmail', '')) <> LOWER(u.email)
    ORDER BY s.started_at
  `;
}

async function addProfileEmail(job: EmailJob, service: Service) {
  const attempt = job.failures + 1;
  console.log(
    `[profile-email] ⏳ เริ่มเพิ่มอีเมล ${job.user_email} ในโปรไฟล์ ${job.profile_name} master=${job.master_email} ครั้งที่ ${attempt}/${MAX_EMAIL_ATTEMPTS}`,
  );
  try {
    const reason = await callService(service, "/profile-email", {
      action: "add",
      ...masterLogin(job),
      customerEmail: job.user_email,
    });
    await sql`
      UPDATE profiles
      SET metadata = metadata || ${sql.json({ profileEmail: job.user_email })}, updated_at = NOW()
      WHERE id = ${job.profile_id}::uuid
    `;
    await logEvent(job.subscription_id, "profile_email_added", `Added ${job.user_email} to profile ${job.profile_name} (${reason})`);
    console.log(`[profile-email] ✅ เพิ่มอีเมล ${job.user_email} ในโปรไฟล์ ${job.profile_name} แล้ว`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await logEvent(
      job.subscription_id,
      "profile_email_add_failed",
      `Attempt ${attempt}/${MAX_EMAIL_ATTEMPTS}: ${reason}`.slice(0, 500),
    );
    console.error(
      attempt >= MAX_EMAIL_ATTEMPTS
        ? `[profile-email] ❌ เพิ่มอีเมลไม่สำเร็จ profile=${job.profile_name} ครบ ${MAX_EMAIL_ATTEMPTS} ครั้งแล้ว หยุดลอง (รอแอดมิน) reason=${reason}`
        : `[profile-email] ❌ เพิ่มอีเมลไม่สำเร็จ profile=${job.profile_name} ครั้งที่ ${attempt}/${MAX_EMAIL_ATTEMPTS} จะลองใหม่ใน 1 นาที reason=${reason}`,
    );
  }
}

// Takes the ended customer's email off the profile. Returns false (and counts a failed rotation) if it could not.
async function removeProfileEmail(rental: ExpiredRental, service: Service, attempt: number) {
  console.log(`[profile-email] ⏳ เริ่มลบอีเมล ${rental.profile_email} ออกจากโปรไฟล์ ${rental.profile_name}`);
  try {
    const reason = await callService(service, "/profile-email", { action: "remove", ...masterLogin(rental) });
    await sql`
      UPDATE profiles SET metadata = metadata - 'profileEmail', updated_at = NOW()
      WHERE id = ${rental.profile_id}::uuid
    `;
    await logEvent(rental.subscription_id, "profile_email_removed", `Removed ${rental.profile_email} from profile ${rental.profile_name} (${reason})`);
    console.log(`[profile-email] ✅ ลบอีเมลออกจากโปรไฟล์ ${rental.profile_name} แล้ว`);
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await logEvent(
      rental.subscription_id,
      "pin_rotation_failed",
      `Attempt ${attempt}/${MAX_ROTATION_ATTEMPTS}: remove profile email: ${reason}`.slice(0, 500),
    );
    console.error(
      `[profile-email] ❌ ลบอีเมลไม่สำเร็จ profile=${rental.profile_name} ครั้งที่ ${attempt}/${MAX_ROTATION_ATTEMPTS} reason=${reason}`,
    );
    return false;
  }
}

async function rotate(rental: ExpiredRental, service: Service) {
  const attempt = rental.failures + 1;
  // The email goes first: a failure here retries the whole rotation next minute.
  if (rental.profile_email && !(await removeProfileEmail(rental, service, attempt))) return;

  const newPin = String(randomInt(0, 10000)).padStart(4, "0");
  // Keep the new PIN before touching Netflix so it is never lost if the DB update below fails.
  await sql`
    UPDATE profiles
    SET metadata = metadata || ${sql.json({ pendingPinCiphertext: encryptSecret(newPin) })}, updated_at = NOW()
    WHERE id = ${rental.profile_id}::uuid
  `;

  console.log(
    `[pin-rotation] ⏳ เริ่มเปลี่ยน PIN profile=${rental.profile_name} master=${rental.master_email} ครั้งที่ ${attempt}/${MAX_ROTATION_ATTEMPTS}`,
  );
  try {
    await callService(service, "/rotate-pin", { ...masterLogin(rental), newPin });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await logEvent(
      rental.subscription_id,
      "pin_rotation_failed",
      `Attempt ${attempt}/${MAX_ROTATION_ATTEMPTS}: ${reason}`.slice(0, 500),
    );
    console.error(
      attempt >= MAX_ROTATION_ATTEMPTS
        ? `[pin-rotation] ❌ เปลี่ยน PIN ไม่สำเร็จ profile=${rental.profile_name} ครบ ${MAX_ROTATION_ATTEMPTS} ครั้งแล้ว หยุดลอง (Slot ค้าง reserved รอแอดมิน) reason=${reason}`
        : `[pin-rotation] ❌ เปลี่ยน PIN ไม่สำเร็จ profile=${rental.profile_name} ครั้งที่ ${attempt}/${MAX_ROTATION_ATTEMPTS} จะลองใหม่ใน 1 นาที reason=${reason}`,
    );
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
  console.log(`[pin-rotation] ✅ เปลี่ยน PIN สำเร็จ profile=${rental.profile_name} ปล่อย Slot กลับมาขายแล้ว`);
  await sendExpiredEmail(rental, { pinChanged: true });
}

// Ends a rental without a PIN change: rental expired, slot back on sale, customer emailed.
async function releaseWithoutRotation(rental: ExpiredRental) {
  await expireRentals(rental.profile_id);
  await sql`
    UPDATE profiles p
    SET status = 'available', profile_expires_at = me.master_expired_at, updated_at = NOW()
    FROM master_emails me
    WHERE p.id = ${rental.profile_id}::uuid AND me.id = p.master_email_id AND p.deleted_at IS NULL
  `;
  await sendExpiredEmail(rental, { pinChanged: false });
  console.log(`[pin-rotation] ✅ ปิดการเช่าแล้ว (ไม่ได้เปลี่ยน PIN) profile=${rental.profile_name} ปล่อย Slot กลับมาขายแล้ว`);
}

async function checkExpiredRentals(service: Service | null) {
  if (service) {
    for (const job of await findRentalsNeedingEmail()) {
      if (job.failures < MAX_EMAIL_ATTEMPTS) await addProfileEmail(job, service);
    }
  }

  for (const rental of await findRentalsEnteringGrace()) await startRenewalWindow(rental);

  const rentals = await findExpiredRentals();
  if (rentals.length === 0) return;

  // Without the pin-service there is nothing to wait for: notify and release.
  if (!service) {
    for (const rental of rentals) await releaseWithoutRotation(rental);
    return;
  }

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
      await releaseWithoutRotation(rental);
      continue;
    }
    if (rental.failures >= MAX_ROTATION_ATTEMPTS) continue; // left reserved for an admin
    await rotate(rental, service);
  }
}

export function pinRotationEnabled() {
  return Boolean(process.env.PIN_SERVICE_URL && process.env.PIN_SERVICE_KEY);
}

/**
 * Admin action: end the running rental on a profile now (no renewal window). With PIN rotation on, the
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

  for (const rental of await findExpiredRentals(profileId)) await releaseWithoutRotation(rental);
  return ended;
}

/** Runs the worker now (e.g. right after a purchase) instead of waiting for the next minute. */
export function runPinWorkerSoon() {
  tick?.();
}

export function startPinRotationWorker() {
  const serviceUrl = process.env.PIN_SERVICE_URL;
  const serviceKey = process.env.PIN_SERVICE_KEY;
  const service = serviceUrl && serviceKey ? { url: serviceUrl, key: serviceKey } : null;

  tick = () => {
    if (running) return;
    running = true;
    checkExpiredRentals(service)
      .catch((err) => console.error("[pin-rotation] ❌ ตรวจการเช่าที่หมดเวลาไม่สำเร็จ", err instanceof Error ? err.message : err))
      .finally(() => {
        running = false;
      });
  };
  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
  console.log(
    service
      ? `[pin-rotation] started (interval=${CHECK_INTERVAL_MS / 1000}s url=${service.url})`
      : "[pin-rotation] started in notify-only mode: expiry emails, no PIN change (set PIN_SERVICE_URL and PIN_SERVICE_KEY to rotate PINs)",
  );
}
