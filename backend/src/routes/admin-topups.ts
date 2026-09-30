import { Hono } from "hono";
import sql from "../db";
import { getAdminSession } from "../adminAuth";
import { voidUnpaidRedemptions } from "../rewards";
import { confirmTopUpByAdmin, topUpReference } from "../topups";
import { getBotConfig, pushToGroups, saveBotCredentials } from "../libs/line-bot";

/** Admin view of customers' unpaid PromptPay QRs, with cancel. */
const topups = new Hono();

topups.get("/topups/pending", async (c) => {
  const rows = await sql`
    SELECT
      t.id, t.points, t.created_at AS "createdAt", t.expires_at AS "expiresAt",
      t.payable_amount_cents AS "payableCents", t.discount_cents AS "discountCents",
      t.check_requested_at AS "checkRequestedAt", t.check_request_count AS "checkRequestCount",
      u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
      s.name AS "streamerName", s.code AS "streamerCode"
    FROM point_topups t
    JOIN "User" u ON u.id = t.user_id
    LEFT JOIN streamer_redemptions r ON r.topup_id = t.id AND r.status = 'pending'
    LEFT JOIN streamers s ON s.id = r.streamer_id
    WHERE t.status = 'pending' AND t.expires_at >= NOW()
    ORDER BY t.created_at DESC
    LIMIT 100
  `;
  return c.json({ topups: rows.map((row) => ({ ...row, reference: topUpReference(row.id) })) });
});

topups.post("/topups/:id/cancel", async (c) => {
  const actor = await getAdminSession(c);
  const id = c.req.param("id");
  const cancelled = await sql.begin(async (db) => {
    const [topUp] = await db`
      UPDATE point_topups
      SET status = 'cancelled', note = 'Cancelled by admin', updated_at = NOW()
      WHERE id = ${id}::uuid AND status = 'pending'
      RETURNING id, user_id, payable_amount_cents
    `;
    if (!topUp) return null;
    // Frees a streamer code reserved by this QR so the customer can use it again.
    await voidUnpaidRedemptions(db);
    await db`
      INSERT INTO admin_audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (${actor?.id ?? null}, 'topup.cancelled', 'point_topup', ${topUp.id},
        ${sql.json({ userId: topUp.user_id, payableCents: topUp.payable_amount_cents })})
    `;
    return topUp;
  });
  if (!cancelled) return c.json({ message: "รายการนี้ไม่ได้รอชำระแล้ว (ชำระ/หมดอายุ/ยกเลิกไปแล้ว)" }, 400);
  return c.json({ ok: true });
});

// ─── Payment support: customer reports, LINE transfers, manual confirm ───

// Top-ups customers reported ("ฉันจ่ายเงินแล้ว ยังไม่เข้า") or that are still open,
// each with the LINE transfers that could belong to it.
topups.get("/topups/support", async (c) => {
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 7), 1), 90);
  const rows = await sql`
    SELECT
      t.id, t.status, t.points, t.payable_amount_cents AS "payableCents", t.discount_cents AS "discountCents",
      t.created_at AS "createdAt", t.expires_at AS "expiresAt", t.paid_at AS "paidAt",
      t.check_requested_at AS "checkRequestedAt", t.check_request_count AS "checkRequestCount",
      t.confirmed_via AS "confirmedVia", t.payment_account_id AS "paymentAccountId",
      pa.name AS "accountName", u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
      admin.name AS "confirmedByName",
      (SELECT e.id FROM line_transfer_events e WHERE e.matched_topup_id = t.id LIMIT 1) AS "matchedTransferId"
    FROM point_topups t
    JOIN "User" u ON u.id = t.user_id
    LEFT JOIN payment_accounts pa ON pa.id = t.payment_account_id
    LEFT JOIN "User" admin ON admin.id = t.confirmed_by
    WHERE t.created_at > NOW() - make_interval(days => ${days})
      AND (t.check_requested_at IS NOT NULL OR (t.status = 'pending' AND t.expires_at >= NOW()))
    ORDER BY (t.status = 'paid'), COALESCE(t.check_requested_at, t.created_at) DESC
    LIMIT 100
  `;
  const transfers = await sql`
    SELECT e.id, e.payment_account_id AS "paymentAccountId", e.incoming_amount_cents AS "amountCents",
      e.sender_name AS "senderName", e.from_account AS "fromAccount", e.occurred_at AS "occurredAt",
      e.occurred_raw AS "occurredRaw", e.created_at AS "receivedAt", e.status, e.match_reason AS "matchReason",
      pa.name AS "accountName"
    FROM line_transfer_events e
    LEFT JOIN payment_accounts pa ON pa.id = e.payment_account_id
    WHERE e.created_at > NOW() - make_interval(days => ${days})
      AND e.matched_topup_id IS NULL
      AND e.status IN ('received', 'unmatched', 'failed')
    ORDER BY e.created_at DESC
    LIMIT 200
  `;
  return c.json({
    topups: rows.map((row) => ({ ...row, reference: topUpReference(row.id) })),
    unmatchedTransfers: transfers,
  });
});

// Re-sync with LINE now (the worker checks every 10 s for the next few minutes).
topups.post("/topups/:id/resync", async (c) => {
  const [row] = await sql`
    UPDATE point_topups SET check_requested_at = NOW(), updated_at = NOW()
    WHERE id = ${c.req.param("id")}::uuid AND status = 'pending'
    RETURNING id
  `;
  if (!row) return c.json({ message: "เช็คกับ LINE ได้เฉพาะรายการที่ยังรอชำระ" }, 400);
  return c.json({ ok: true });
});

topups.post("/topups/:id/confirm", async (c) => {
  const actor = await getAdminSession(c);
  const body = await c.req.json<{ transferEventId?: string | null }>().catch(() => ({}) as { transferEventId?: null });
  try {
    const result = await confirmTopUpByAdmin({
      topUpId: c.req.param("id"),
      adminUserId: actor?.id ?? null,
      transferEventId: body.transferEventId || null,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ message: err instanceof Error ? err.message : "ยืนยันไม่สำเร็จ" }, 400);
  }
});

// ─── LINE alert bot ───

topups.get("/line-bot", async (c) => {
  const config = await getBotConfig();
  const groups = await sql`
    SELECT group_id AS "groupId", name, joined_at AS "joinedAt"
    FROM line_bot_groups WHERE left_at IS NULL ORDER BY joined_at DESC
  `;
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "";
  const proto = c.req.header("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const apiOrigin = `${proto}://${host}`;
  return c.json({
    configured: Boolean(config.secret && config.token),
    source: config.source,
    hasSecret: Boolean(config.secret),
    hasToken: Boolean(config.token),
    webhookUrl: `${process.env.PUBLIC_API_ORIGIN ?? apiOrigin}/api/line-bot/webhook`,
    groups,
  });
});

topups.patch("/line-bot", async (c) => {
  const body = await c.req.json<{ secret?: string; token?: string }>();
  await saveBotCredentials({ secret: body.secret?.trim(), token: body.token?.trim() });
  return c.json({ ok: true });
});

topups.post("/line-bot/test", async (c) => {
  const result = await pushToGroups("✅ ทดสอบแจ้งเตือนจาก Fast Movie admin — บอทใช้งานได้");
  if (result.reason === "not_configured") return c.json({ message: "ยังไม่ได้ใส่ Channel Access Token" }, 400);
  if (result.reason === "no_groups") return c.json({ message: "ยังไม่มีกลุ่ม · เชิญบอทเข้ากลุ่ม LINE ก่อน" }, 400);
  return c.json(result);
});

topups.delete("/line-bot/groups/:groupId", async (c) => {
  await sql`UPDATE line_bot_groups SET left_at = NOW() WHERE group_id = ${c.req.param("groupId")}`;
  return c.json({ ok: true });
});

export default topups;
