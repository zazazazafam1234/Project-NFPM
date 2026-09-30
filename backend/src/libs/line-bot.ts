import { createHmac, timingSafeEqual } from "node:crypto";
import sql from "../db";
import { decryptSecret, encryptSecret } from "../crypto";

/**
 * LINE Messaging API bot for admin alerts. Invite it to a LINE group: the webhook
 * records the group, and alerts (e.g. a customer pressing "ฉันจ่ายเงินแล้ว ยังไม่เข้า")
 * are pushed to every connected group. Credentials come from the admin settings
 * (stored encrypted) or LINE_BOT_CHANNEL_SECRET / LINE_BOT_CHANNEL_ACCESS_TOKEN.
 */

const LINE_API = "https://api.line.me/v2/bot";

type BotConfig = { secret: string; token: string; source: "admin" | "env" | null };

async function readSetting(key: string) {
  const [row] = await sql`SELECT value FROM app_settings WHERE key = ${key}`;
  const ciphertext = typeof row?.value === "string" ? row.value : null;
  return ciphertext ? decryptSecret(ciphertext) ?? "" : "";
}

export async function getBotConfig(): Promise<BotConfig> {
  const [secret, token] = await Promise.all([readSetting("line_bot_secret"), readSetting("line_bot_token")]);
  if (secret && token) return { secret, token, source: "admin" };
  const envSecret = process.env.LINE_BOT_CHANNEL_SECRET ?? "";
  const envToken = process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN ?? "";
  if (envSecret && envToken) return { secret: envSecret, token: envToken, source: "env" };
  return { secret: secret || envSecret, token: token || envToken, source: null };
}

export async function saveBotCredentials({ secret, token }: { secret?: string; token?: string }) {
  for (const [key, value] of [["line_bot_secret", secret], ["line_bot_token", token]] as const) {
    if (value === undefined) continue;
    if (value === "") {
      await sql`DELETE FROM app_settings WHERE key = ${key}`;
      continue;
    }
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${key}, ${sql.json(encryptSecret(value))}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;
  }
}

export function verifySignature(rawBody: string, signature: string | undefined, secret: string) {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function lineApi(token: string, path: string, body?: unknown) {
  const response = await fetch(`${LINE_API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`LINE API ${response.status}: ${(data as { message?: string }).message ?? ""}`);
  return data as Record<string, unknown>;
}

export async function replyText(token: string, replyToken: string, text: string) {
  await lineApi(token, "/message/reply", { replyToken, messages: [{ type: "text", text }] });
}

export async function groupName(token: string, groupId: string) {
  try {
    const summary = await lineApi(token, `/group/${groupId}/summary`);
    return typeof summary.groupName === "string" ? summary.groupName : null;
  } catch {
    return null;
  }
}

// Sends text to every connected group; returns how many groups received it.
export async function pushToGroups(text: string) {
  const { token } = await getBotConfig();
  if (!token) return { sent: 0, failed: 0, reason: "not_configured" };
  const groups = await sql<Array<{ group_id: string }>>`SELECT group_id FROM line_bot_groups WHERE left_at IS NULL`;
  let sent = 0;
  let failed = 0;
  for (const { group_id } of groups) {
    try {
      await lineApi(token, "/message/push", { to: group_id, messages: [{ type: "text", text }] });
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`[line-bot] push failed group=${group_id}`, err instanceof Error ? err.message : err);
    }
  }
  return { sent, failed, reason: groups.length ? null : "no_groups" };
}

const bangkok = (value: Date | string) =>
  new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" });

// Alert for "ฉันจ่ายเงินแล้ว ยังไม่เข้า"; failures are logged, never thrown.
export async function notifyTopUpCheck(topUpId: string) {
  try {
    const [row] = await sql`
      SELECT t.id, t.points, t.payable_amount_cents, t.discount_cents, t.created_at, t.expires_at, t.check_request_count,
        u.name, u.email, pa.name AS account_name
      FROM point_topups t
      JOIN "User" u ON u.id = t.user_id
      LEFT JOIN payment_accounts pa ON pa.id = t.payment_account_id
      WHERE t.id = ${topUpId}::uuid
    `;
    if (!row) return;
    const amount = (Number(row.payable_amount_cents) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 });
    const site = (process.env.WEB_ORIGIN ?? "").replace(/\/+$/, "");
    const text = [
      "🔔 ลูกค้าแจ้งว่าโอนแล้ว แต่ Point ยังไม่เข้า",
      "",
      `รหัสรายการ: #${String(row.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      `ลูกค้า: ${row.name} (${row.email})`,
      `ยอดโอน: ฿${amount} · เติม ${Number(row.points).toLocaleString()} Point`,
      `บัญชีรับเงิน: ${row.account_name ?? "-"}`,
      `สร้าง QR: ${bangkok(row.created_at)} · หมดอายุ ${bangkok(row.expires_at)}`,
      `แจ้งครั้งที่: ${row.check_request_count}`,
      "",
      "ระบบกำลังเช็ค LINE ถี่ขึ้น (ทุก 10 วินาที) ถ้ายังไม่เข้าโปรดตรวจสอบยอดในบัญชีธนาคาร",
      ...(site ? [`ดูรายการ: ${site}/admin`] : []),
    ].join("\n");
    const result = await pushToGroups(text);
    console.log(`[line-bot] top-up check alert topup=${topUpId} sent=${result.sent} failed=${result.failed}`);
  } catch (err) {
    console.error("[line-bot] top-up check alert failed", err instanceof Error ? err.message : err);
  }
}
