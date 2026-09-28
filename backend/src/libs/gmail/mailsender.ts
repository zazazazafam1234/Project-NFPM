/**
 * Gmail sender using the Google OAuth2 REST API (no googleapis SDK needed).
 * Required env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 * Optional:          GMAIL_FROM  (defaults to "noreply@gmail.com")
 */

export type SubscriptionCredentials = {
  email: string;
  password: string | null;
  profileName: string;
  pin: string | null;
};

async function getAccessToken(): Promise<string> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN ยังไม่ได้ตั้งค่า");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json() as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Gmail token refresh failed: ${data.error ?? res.status}`);
  }
  return data.access_token;
}

function buildSubscriptionEmailHtml(credentials: SubscriptionCredentials): string {
  const { email, password, profileName, pin } = credentials;
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>ข้อมูลการเข้าใช้งาน</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#151515;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#e50914 0%,#b00710 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">
                ข้อมูลการเข้าใช้งานของคุณ
              </h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">
                การสั่งซื้อสำเร็จแล้ว ✓
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 24px;color:#aaa;font-size:15px;line-height:1.6;">
                ขอบคุณที่ใช้บริการครับ นี่คือข้อมูลสำหรับเข้าใช้งาน กรุณาเก็บข้อมูลนี้ไว้และอย่าแชร์ให้ผู้อื่น
              </p>

              <!-- Credentials card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e1e1e;border-radius:12px;border:1px solid #2d2d2d;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 4px;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;">EMAIL บัญชีหลัก</p>
                    <p style="margin:0 0 20px;color:#fff;font-size:18px;font-weight:600;word-break:break-all;">${escapeHtml(email)}</p>

                    ${password ? `
                    <p style="margin:0 0 4px;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;">รหัสผ่านบัญชีหลัก</p>
                    <p style="margin:0 0 20px;color:#fff;font-size:18px;font-weight:600;font-family:monospace;background:#111;padding:8px 12px;border-radius:6px;border:1px solid #333;">${escapeHtml(password)}</p>
                    ` : ""}

                    <hr style="border:none;border-top:1px solid #2d2d2d;margin:4px 0 20px;"/>

                    <p style="margin:0 0 4px;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;">หมายเลขจอ / โปรไฟล์</p>
                    <p style="margin:0 0 20px;color:#e50914;font-size:22px;font-weight:700;">${escapeHtml(profileName)}</p>

                    ${pin ? `
                    <p style="margin:0 0 4px;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;">รหัส PIN โปรไฟล์</p>
                    <p style="margin:0;color:#fff;font-size:26px;font-weight:700;font-family:monospace;letter-spacing:6px;background:#111;padding:10px 16px;border-radius:6px;border:1px solid #333;display:inline-block;">${escapeHtml(pin)}</p>
                    ` : ""}
                  </td>
                </tr>
              </table>

              <p style="margin:28px 0 0;color:#555;font-size:13px;line-height:1.7;">
                หากพบปัญหาในการเข้าใช้งาน กรุณาติดต่อแอดมินผ่านช่องทางที่กำหนดไว้
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #222;text-align:center;">
              <p style="margin:0;color:#444;font-size:12px;">
                อีเมลนี้ส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับ
              </p>
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

function encodeRfc2047(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`;
}

async function sendRawEmail({
  to,
  subject,
  htmlBody,
}: {
  to: string;
  subject: string;
  htmlBody: string;
}) {
  const accessToken = await getAccessToken();
  const from = process.env.GMAIL_FROM ?? "noreply@gmail.com";
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const rawMessage = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeRfc2047(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    "",
    Buffer.from(htmlBody, "utf-8").toString("base64"),
    "",
    `--${boundary}--`,
  ].join("\r\n");

  const encoded = Buffer.from(rawMessage).toString("base64url");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded }),
  });

  const data = await res.json() as { id?: string; threadId?: string; error?: unknown };
  if (!res.ok) {
    throw new Error(`Gmail send failed: ${JSON.stringify(data.error)}`);
  }

  return { messageId: data.id, threadId: data.threadId };
}

/**
 * ส่ง email แจ้งข้อมูลการเข้าใช้งานหลังซื้อสำเร็จ
 * Fire-and-forget: ควร call โดยไม่ await และ .catch(console.error)
 *
 * @param htmlOverride  ถ้าส่งมาจะใช้แทน template ค่าเริ่มต้น (ใช้สำหรับ reminder)
 * @param subject       ถ้าส่งมาจะ override subject ค่าเริ่มต้น
 */
export async function sendSubscriptionEmail({
  to,
  credentials,
  subject,
  htmlOverride,
}: {
  to: string;
  credentials: SubscriptionCredentials;
  subject?: string;
  htmlOverride?: string;
}) {
  const html = htmlOverride ?? buildSubscriptionEmailHtml(credentials);
  const resolvedSubject = subject ?? `ข้อมูลการเข้าใช้งาน — จอ ${credentials.profileName}`;
  const result = await sendRawEmail({ to, subject: resolvedSubject, htmlBody: html });
  console.log(`[gmail] sent email to=${to} subject="${resolvedSubject}" messageId=${result.messageId}`);
  return result;
}
