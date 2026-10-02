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

/**
 * Link to an admin section for LINE alerts that need action, e.g.
 * adminLink("resellers") or adminLink("profiles", { q: "nab12c" }). Empty without WEB_ORIGIN.
 */
export function adminLink(section: string, params: Record<string, string> = {}) {
  const site = (process.env.WEB_ORIGIN ?? "").replace(/\/+$/, "");
  if (!site) return "";
  const query = new URLSearchParams({ section, ...params });
  return `${site}/admin?${query}`;
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
      ...(site ? [`👉 จัดการ: ${adminLink("payments")}`] : []),
    ].join("\n");
    const result = await pushToGroups(text);
    console.log(`[line-bot] top-up check alert topup=${topUpId} sent=${result.sent} failed=${result.failed}`);
  } catch (err) {
    console.error("[line-bot] top-up check alert failed", err instanceof Error ? err.message : err);
  }
}

// Alert for a credited top-up, with what the receiving account has taken in; failures are logged, never thrown.
export async function notifyTopUpPaid(topUpId: string) {
  try {
    const [row] = await sql`
      SELECT t.id, t.points, t.matched_amount_cents, t.discount_cents, t.paid_at, t.confirmed_via,
        t.payment_account_id, u.name, u.email, pa.name AS account_name
      FROM point_topups t
      JOIN "User" u ON u.id = t.user_id
      LEFT JOIN payment_accounts pa ON pa.id = t.payment_account_id
      WHERE t.id = ${topUpId}::uuid AND t.status = 'paid'
    `;
    if (!row) return;
    // Bangkok "today" so the daily total matches the bank statement day.
    const [totals] = await sql`
      SELECT
        COALESCE(SUM(matched_amount_cents) FILTER (
          WHERE (paid_at AT TIME ZONE 'Asia/Bangkok')::date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
        ), 0)::bigint AS today_cents,
        COUNT(*) FILTER (
          WHERE (paid_at AT TIME ZONE 'Asia/Bangkok')::date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
        )::int AS today_count,
        COALESCE(SUM(matched_amount_cents), 0)::bigint AS all_cents
      FROM point_topups
      WHERE status = 'paid'
        AND payment_account_id IS NOT DISTINCT FROM ${row.payment_account_id}::uuid
    `;
    const baht = (cents: unknown) =>
      (Number(cents) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const text = [
      "💰 ลูกค้าเติมเงินสำเร็จ",
      "",
      `ลูกค้า: ${row.name} (${row.email})`,
      `ยอดโอน: ฿${baht(row.matched_amount_cents)} · ได้ ${Number(row.points).toLocaleString()} Point`,
      ...(Number(row.discount_cents) > 0 ? [`ส่วนลด: ฿${baht(row.discount_cents)}`] : []),
      `ยืนยันโดย: ${row.confirmed_via === "admin" ? "แอดมิน" : "อัตโนมัติ (LINE)"} · ${bangkok(row.paid_at)}`,
      "",
      `บัญชีรับเงิน: ${row.account_name ?? "-"}`,
      `ยอดรวมวันนี้: ฿${baht(totals.today_cents)} (${totals.today_count} รายการ)`,
      `ยอดรวมทั้งหมด: ฿${baht(totals.all_cents)}`,
    ].join("\n");
    const result = await pushToGroups(text);
    console.log(`[line-bot] top-up paid alert topup=${topUpId} sent=${result.sent} failed=${result.failed}`);
  } catch (err) {
    console.error("[line-bot] top-up paid alert failed", err instanceof Error ? err.message : err);
  }
}

// Alert for a first-time sign-up; failures are logged, never thrown.
export async function notifyNewUser(userId: string) {
  try {
    const [row] = await sql`
      SELECT u.name, u.email, u."createdAt",
        (SELECT COUNT(*) FROM "User")::int AS total,
        (SELECT COUNT(*) FROM "User"
          WHERE ("createdAt" AT TIME ZONE 'Asia/Bangkok')::date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date)::int AS today
      FROM "User" u WHERE u.id = ${userId}
    `;
    if (!row) return;
    const link = adminLink("users");
    const text = [
      "👋 มีผู้ใช้ใหม่สมัครเข้ามา",
      "",
      `ชื่อ: ${row.name}`,
      `อีเมล: ${row.email}`,
      `เวลา: ${bangkok(row.createdAt)}`,
      `สมัครวันนี้ ${row.today} คน · ผู้ใช้ทั้งหมด ${row.total.toLocaleString()} คน`,
      ...(link ? ["", `👉 ดูผู้ใช้: ${link}`] : []),
    ].join("\n");
    const result = await pushToGroups(text);
    console.log(`[line-bot] new user alert user=${userId} sent=${result.sent} failed=${result.failed}`);
  } catch (err) {
    console.error("[line-bot] new user alert failed", err instanceof Error ? err.message : err);
  }
}
