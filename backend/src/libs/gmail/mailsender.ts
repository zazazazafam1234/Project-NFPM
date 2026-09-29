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

export type SubscriptionOrder = {
  packageName: string;
  startedAt: Date | string;
  expiresAt: Date | string;
};

function formatBangkokDateTime(value: Date | string) {
  const text = new Date(value).toLocaleString("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
  return `${text} น.`;
}

function buildSubscriptionEmailText(credentials: SubscriptionCredentials, order?: SubscriptionOrder): string {
  const { email, password, profileName, pin } = credentials;
  return [
    "การสั่งซื้อสำเร็จแล้ว ขอบคุณที่ใช้บริการครับ",
    "",
    ...(order
      ? [
          `แพ็กเกจ: ${order.packageName}`,
          `วันที่ซื้อ: ${formatBangkokDateTime(order.startedAt)}`,
          `หมดอายุ: ${formatBangkokDateTime(order.expiresAt)}`,
          "",
        ]
      : []),
    "ข้อมูลสำหรับเข้าใช้งาน (กรุณาอย่าแชร์ให้ผู้อื่น)",
    "",
    `Email บัญชีหลัก: ${email}`,
    ...(password ? [`รหัสผ่าน: ${password}`] : []),
    `โปรไฟล์: ${profileName}`,
    ...(pin ? [`PIN: ${pin}`] : []),
    "",
    "หากพบปัญหาในการเข้าใช้งาน กรุณาติดต่อแอดมิน",
    "",
    "อีเมลนี้ส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับ",
  ].join("\n");
}

function encodeRfc2047(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`;
}

async function sendRawEmail({
  to,
  subject,
  textBody,
}: {
  to: string;
  subject: string;
  textBody: string;
}) {
  const accessToken = await getAccessToken();
  const from = process.env.GMAIL_FROM ?? "noreply@gmail.com";
  const rawMessage = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeRfc2047(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    "",
    Buffer.from(textBody.replace(/\r?\n/g, "\r\n"), "utf-8").toString("base64"),
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
 * @param bodyOverride  ถ้าส่งมาจะใช้แทนข้อความค่าเริ่มต้น (ใช้สำหรับ reminder)
 * @param subject       ถ้าส่งมาจะ override subject ค่าเริ่มต้น
 */
export async function sendSubscriptionEmail({
  to,
  credentials,
  order,
  subject,
  bodyOverride,
}: {
  to: string;
  credentials: SubscriptionCredentials;
  order?: SubscriptionOrder;
  subject?: string;
  bodyOverride?: string;
}) {
  const text = bodyOverride ?? buildSubscriptionEmailText(credentials, order);
  const resolvedSubject = subject ?? `ข้อมูลการเข้าใช้งาน — จอ ${credentials.profileName}`;
  const result = await sendRawEmail({ to, subject: resolvedSubject, textBody: text });
  console.log(`[gmail] sent email to=${to} subject="${resolvedSubject}" messageId=${result.messageId}`);
  return result;
}
