import { Hono } from "hono";
import sql from "../db";
import { getAdminSession } from "../adminAuth";
import { voidUnpaidRedemptions } from "../rewards";

/** Admin view of customers' unpaid PromptPay QRs, with cancel. */
const topups = new Hono();

topups.get("/topups/pending", async (c) => {
  const rows = await sql`
    SELECT
      t.id, t.points, t.created_at AS "createdAt", t.expires_at AS "expiresAt",
      t.payable_amount_cents AS "payableCents", t.discount_cents AS "discountCents",
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
  return c.json({ topups: rows });
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

export default topups;
