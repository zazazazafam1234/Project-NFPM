import { Hono } from "hono";
import sql from "../db";
import { getSessionUserId } from "../session";

const orders = new Hono();

orders.post("/", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อนใช้งาน" }, 401);

  const { roomId, planId, paymentMethod = "points" } = await c.req.json<{
    roomId: string;
    planId: string;
    paymentMethod?: string;
  }>();

  if (!roomId || !planId) return c.json({ message: "ข้อมูลไม่ครบถ้วน" }, 400);

  const [[plan], [room]] = await Promise.all([
    sql`SELECT * FROM "Plan" WHERE id = ${planId}`,
    sql`SELECT * FROM "Room" WHERE id = ${roomId}`,
  ]);

  if (!plan) return c.json({ message: "ไม่พบโปรที่เลือก" }, 400);
  if (!room) return c.json({ message: "ไม่พบห้องที่เลือก" }, 400);

  if (paymentMethod === "points") {
    try {
      const result = await sql.begin(async (sql) => {
        const [user] = await sql`SELECT * FROM "User" WHERE id = ${userId} FOR UPDATE`;
        if (!user) throw new Error("ไม่พบบัญชีผู้ใช้");
        if (user.points < plan.price) throw new Error("Point ไม่เพียงพอ");

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + plan.durationDays);

        const [updatedUser] = await sql`
          UPDATE "User" SET points = points - ${plan.price}, "updatedAt" = NOW()
          WHERE id = ${userId} RETURNING points
        `;

        const orderId = crypto.randomUUID();
        await sql`
          INSERT INTO "Order" (id, "userId", "roomId", "planId", "paymentMethod", status, "expiresAt", "createdAt")
          VALUES (${orderId}, ${userId}, ${roomId}, ${planId}, ${paymentMethod}, 'paid', ${expiresAt.toISOString()}, NOW())
        `;

        await sql`
          INSERT INTO "Transaction" (id, "userId", "orderId", type, amount, description, "createdAt")
          VALUES (${crypto.randomUUID()}, ${userId}, ${orderId}, 'debit', ${plan.price},
                  ${`ใช้ Point เลือกโปร${plan.name} — ${room.name}`}, NOW())
        `;

        return { orderId, points: updatedUser.points };
      });

      return c.json({ orderId: result.orderId, status: "paid", points: result.points });
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : "เกิดข้อผิดพลาด" }, 400);
    }
  }

  // PromptPay / Wallet — pending order
  const orderId = crypto.randomUUID();
  await sql`
    INSERT INTO "Order" (id, "userId", "roomId", "planId", "paymentMethod", status, "createdAt")
    VALUES (${orderId}, ${userId}, ${roomId}, ${planId}, ${paymentMethod}, 'pending', NOW())
  `;

  return c.json({ orderId, status: "pending", paymentMethod, amount: plan.price });
});

export default orders;
