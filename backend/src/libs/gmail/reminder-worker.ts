import sql from "../../db";
import { sendSubscriptionEmail } from "./mailsender";

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // ตรวจทุก 10 นาที

type ReminderWindow = {
  eventType: "reminder_1d_sent" | "reminder_3h_sent";
  label: string;
  fromHours: number;
  toHours: number;
};

const WINDOWS: ReminderWindow[] = [
  { eventType: "reminder_1d_sent",  label: "1 วัน",    fromHours: 23,  toHours: 25   },
  { eventType: "reminder_3h_sent",  label: "3 ชั่วโมง", fromHours: 2.5, toHours: 3.5  },
];

function buildReminderText({
  profileName,
  email,
  pin,
  expiresAt,
  label,
}: {
  profileName: string;
  email: string;
  pin: string | null;
  expiresAt: Date;
  label: string;
}): string {
  const expireStr = expiresAt.toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
  return [
    `แพ็กเกจของคุณจะหมดอายุใน ${label}`,
    `หมดอายุ: ${expireStr}`,
    "",
    `Email บัญชีหลัก: ${email}`,
    `โปรไฟล์: ${profileName}`,
    ...(pin ? [`PIN: ${pin}`] : []),
    "",
    "หากต้องการใช้งานต่อ กรุณาต่ออายุก่อนหมดเวลา หากพบปัญหากรุณาติดต่อแอดมิน",
    "",
    "อีเมลนี้ส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับ",
  ].join("\n");
}

async function processWindow(window: ReminderWindow) {
  const fromInterval = `${window.fromHours} hours`;
  const toInterval = `${window.toHours} hours`;

  const rows = await sql`
    SELECT
      s.id AS subscription_id,
      s.expires_at,
      s.profile_id,
      u.email AS user_email,
      p.profile_name,
      p.profile_pin_ciphertext,
      me.email AS master_email,
      me.password_ciphertext AS master_password_ciphertext
    FROM subscriptions s
    JOIN "User" u ON u.id = s.user_id
    JOIN profiles p ON p.id = s.profile_id
    JOIN master_emails me ON me.id = p.master_email_id
    WHERE s.status = 'active'
      AND s.expires_at BETWEEN NOW() + ${fromInterval}::interval AND NOW() + ${toInterval}::interval
      AND NOT EXISTS (
        SELECT 1
        FROM subscription_events se
        WHERE se.subscription_id = s.id
          AND se.event_type = ${window.eventType}
      )
  `;

  if (rows.length === 0) return;

  console.log(`[reminder-worker] ${window.eventType}: found ${rows.length} subscription(s) to notify`);

  for (const row of rows) {
    try {
      let pin: string | null = null;
      try {
        const { decryptSecret } = await import("../../crypto");
        if (row.profile_pin_ciphertext) pin = decryptSecret(row.profile_pin_ciphertext);
      } catch {
        // no pin
      }

      await sendSubscriptionEmail({
        to: row.user_email,
        subject: `แพ็กเกจจอ ${row.profile_name} จะหมดอายุใน ${window.label}`,
        credentials: {
          email: row.master_email,
          password: null,
          profileName: row.profile_name,
          pin,
        },
        bodyOverride: buildReminderText({
          profileName: row.profile_name,
          email: row.master_email,
          pin,
          expiresAt: new Date(row.expires_at),
          label: window.label,
        }),
      });

      await sql`
        INSERT INTO subscription_events (subscription_id, actor_user_id, event_type, message)
        VALUES (
          ${row.subscription_id},
          NULL,
          ${window.eventType},
          ${`Reminder email sent to ${row.user_email}`}
        )
      `;

      console.log(`[reminder-worker] ${window.eventType} sent sub=${row.subscription_id} user=${row.user_email}`);
    } catch (err) {
      console.error(`[reminder-worker] failed sub=${row.subscription_id}`, err instanceof Error ? err.message : err);
    }
  }
}

async function checkAndSendReminders() {
  for (const window of WINDOWS) {
    await processWindow(window);
  }
}

export function startReminderWorker() {
  void checkAndSendReminders();
  setInterval(() => {
    checkAndSendReminders().catch((err) => {
      console.error("[reminder-worker] check failed", err instanceof Error ? err.message : err);
    });
  }, CHECK_INTERVAL_MS);
  console.log(`[reminder-worker] started (interval=${CHECK_INTERVAL_MS / 1000}s)`);
}
