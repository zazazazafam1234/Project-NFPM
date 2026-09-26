import { Hono } from "hono";
import prisma from "../db";
import { getSessionUserId } from "../session";

const profile = new Hono();

const VALID_TOPUP_AMOUNTS = [50, 100, 150, 300, 350, 500, 1000];
const VALID_TOPUP_METHODS: Record<string, string> = {
  promptpay: "PromptPay",
  wallet: "TrueMoney Wallet",
  truemoney: "TrueMoney Wallet",
};

profile.post("/top-ups", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const body = await c.req.json<{ points: number; amount: number; paymentMethod: string }>();
  const { points, paymentMethod } = body;

  if (!points || points <= 0) {
    return c.json({ message: "จำนวน Point ไม่ถูกต้อง" }, 400);
  }
  if (!VALID_TOPUP_METHODS[paymentMethod]) {
    return c.json({ message: "ช่องทางการชำระเงินไม่ถูกต้อง" }, 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { points: { increment: points } },
    });

    await tx.transaction.create({
      data: {
        userId,
        type: "topup",
        amount: points,
        description: `เติม ${points.toLocaleString()} Point — ${VALID_TOPUP_METHODS[paymentMethod]}`,
      },
    });

    return { points: updatedUser.points };
  });

  return c.json({ points: result.points });
});

profile.get("/transactions", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const transactions = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return c.json({
    transactions: transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      description: t.description,
      createdAt: t.createdAt,
    })),
  });
});

profile.get("/orders", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const orders = await prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      room: { select: { name: true, label: true } },
      plan: { select: { name: true, price: true, duration: true } },
    },
  });

  return c.json({
    orders: orders.map((o) => ({
      id: o.id,
      roomName: o.room.name,
      roomLabel: o.room.label,
      planName: o.plan.name,
      planDuration: o.plan.duration,
      price: o.plan.price,
      status: o.status,
      paymentMethod: o.paymentMethod,
      expiresAt: o.expiresAt,
      createdAt: o.createdAt,
    })),
  });
});

export default profile;
