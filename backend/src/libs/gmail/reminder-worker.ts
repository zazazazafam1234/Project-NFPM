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

function buildReminderHtml({
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
  const pinRow = pin
    ? `<p style="margin:0 0 4px;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;">PIN โปรไฟล์</p>
       <p style="margin:0;color:#fff;font-size:22px;font-weight:700;font-family:monospace;letter-spacing:4px;background:#111;padding:8px 14px;border-radius:6px;border:1px solid #333;display:inline-block;">${escapeHtml(pin)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>แพ็กเกจใกล้หมดอายุ</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#151515;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr>
            <td style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                แพ็กเกจของคุณจะหมดอายุใน ${label}
              </h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                หมดอายุ: ${expireStr}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 24px;color:#aaa;font-size:15px;line-height:1.6;">
                ต่ออายุแพ็กเกจเพื่อรับชมต่อเนื่องได้เลยครับ ข้อมูลจอของคุณด้านล่าง
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e1e1e;border-radius:12px;border:1px solid #2d2d2d;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 4px;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;">EMAIL บัญชีหลัก</p>
                    <p style="margin:0 0 20px;color:#fff;font-size:17px;font-weight:600;word-break:break-all;">${escapeHtml(email)}</p>
                    <hr style="border:none;border-top:1px solid #2d2d2d;margin:4px 0 20px;"/>
                    <p style="margin:0 0 4px;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;">หมายเลขจอ / โปรไฟล์</p>
                    <p style="margin:0 0 ${pin ? "20px" : "0"};color:#f59e0b;font-size:22px;font-weight:700;">${escapeHtml(profileName)}</p>
                    ${pinRow}
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 0;color:#555;font-size:13px;line-height:1.7;">
                หากพบปัญหาในการต่ออายุ กรุณาติดต่อแอดมินครับ
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #222;text-align:center;">
              <p style="margin:0;color:#444;font-size:12px;">อีเมลนี้ส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับ</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
        htmlOverride: buildReminderHtml({
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
