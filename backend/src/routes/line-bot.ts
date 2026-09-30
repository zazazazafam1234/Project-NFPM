import { Hono } from "hono";
import sql from "../db";
import { getBotConfig, groupName, replyText, verifySignature } from "../libs/line-bot";

/** LINE Messaging API webhook: records the groups the alert bot is invited to. */
const lineBot = new Hono();

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { type?: string; groupId?: string; roomId?: string };
  message?: { type?: string; text?: string };
};

lineBot.post("/webhook", async (c) => {
  const rawBody = await c.req.text();
  const { secret, token } = await getBotConfig();
  if (!verifySignature(rawBody, c.req.header("x-line-signature"), secret)) {
    return c.json({ message: "invalid signature" }, 401);
  }

  const { events = [] } = JSON.parse(rawBody || "{}") as { events?: LineEvent[] };
  for (const event of events) {
    const groupId = event.source?.groupId ?? event.source?.roomId;
    if (!groupId) continue;
    try {
      if (event.type === "join") {
        const name = await groupName(token, groupId);
        await sql`
          INSERT INTO line_bot_groups (group_id, name) VALUES (${groupId}, ${name})
          ON CONFLICT (group_id) DO UPDATE SET name = EXCLUDED.name, joined_at = NOW(), left_at = NULL
        `;
        console.log(`[line-bot] joined group=${groupId} name=${name ?? "-"}`);
        if (event.replyToken) {
          await replyText(
            token,
            event.replyToken,
            "สวัสดีครับ 👋 บอทแจ้งเตือน Fast Movie พร้อมใช้งานในกลุ่มนี้แล้ว\nจะแจ้งเมื่อลูกค้ากด “ฉันจ่ายเงินแล้ว ยังไม่เข้า”",
          );
        }
      } else if (event.type === "leave") {
        await sql`UPDATE line_bot_groups SET left_at = NOW() WHERE group_id = ${groupId}`;
        console.log(`[line-bot] left group=${groupId}`);
      } else if (event.type === "message" && event.message?.text?.trim() === "!status" && event.replyToken) {
        const [group] = await sql`SELECT left_at IS NULL AS active FROM line_bot_groups WHERE group_id = ${groupId}`;
        await replyText(token, event.replyToken, group?.active ? "✅ กลุ่มนี้รับการแจ้งเตือนอยู่" : "⚠️ กลุ่มนี้ยังไม่ได้ลงทะเบียน กรุณาเชิญบอทเข้ากลุ่มใหม่");
      }
    } catch (err) {
      console.error(`[line-bot] event ${event.type} failed`, err instanceof Error ? err.message : err);
    }
  }
  return c.json({ ok: true });
});

export default lineBot;
