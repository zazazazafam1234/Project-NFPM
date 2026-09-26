import { Hono } from "hono";
import prisma from "../db";
import { getSessionUserId } from "../session";

const orders = new Hono();

orders.post("/", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อนใช้งาน" }, 401);

  const body = await c.req.json<{
    roomId: string;
    planId: string;
    paymentMethod?: string;
    points?: number;
  }>();

  const { roomId, planId, paymentMethod = "points" } = body;

  if (!roomId || !planId) {
    return c.json({ message: "ข้อมูลไม่ครบถ้วน" }, 400);
  }

  const [plan, room] = await Promise.all([
    prisma.plan.findUnique({ where: { id: planId } }),
    prisma.room.findUnique({ where: { id: roomId } }),
  ]);

  if (!plan) return c.json({ message: "ไม่พบโปรที่เลือก" }, 400);
  if (!room) return c.json({ message: "ไม่พบห้องที่เลือก" }, 400);

  const price = plan.price;

  if (paymentMethod === "points") {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error("ไม่พบบัญชีผู้ใช้");
        if (user.points < price) throw new Error("Point ไม่เพียงพอ");

        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: { points: { decrement: price } },
        });

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + plan.durationDays);

        const order = await tx.order.create({
          data: { userId, roomId, planId, paymentMethod, status: "paid", expiresAt },
        });

        await tx.transaction.create({
          data: {
            userId,
            orderId: order.id,
            type: "debit",
            amount: price,
            description: `ใช้ Point เลือกโปร${plan.name} — ${room.name}`,
          },
        });

        return { orderId: order.id, points: updatedUser.points };
      });

      return c.json({ orderId: result.orderId, status: "paid", points: result.points });
    } catch (err) {
      const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
      return c.json({ message }, 400);
    }
  }

  // PromptPay / Wallet — pending order
  const order = await prisma.order.create({
    data: { userId, roomId, planId, paymentMethod, status: "pending" },
  });

  return c.json({ orderId: order.id, status: "pending", paymentMethod, amount: price });
});

export default orders;
