import { Hono } from "hono";
import sql from "../db";
import { getSessionUserId } from "../session";

const profile = new Hono();

const VALID_TOPUP_METHODS: Record<string, string> = {
  promptpay: "PromptPay",
  wallet: "TrueMoney Wallet",
  truemoney: "TrueMoney Wallet",
};

profile.post("/top-ups", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const { points, paymentMethod } = await c.req.json<{ points: number; amount: number; paymentMethod: string }>();

  if (!points || points <= 0) return c.json({ message: "จำนวน Point ไม่ถูกต้อง" }, 400);
  if (!VALID_TOPUP_METHODS[paymentMethod]) return c.json({ message: "ช่องทางการชำระเงินไม่ถูกต้อง" }, 400);

  const result = await sql.begin(async (sql) => {
    const [user] = await sql`
      UPDATE "User" SET points = points + ${points}, "updatedAt" = NOW()
      WHERE id = ${userId} RETURNING points
    `;
    await sql`
      INSERT INTO "Transaction" (id, "userId", type, amount, description, "createdAt")
      VALUES (${crypto.randomUUID()}, ${userId}, 'topup', ${points},
              ${`เติม ${points.toLocaleString()} Point — ${VALID_TOPUP_METHODS[paymentMethod]}`}, NOW())
    `;
    return { points: user.points };
  });

  return c.json({ points: result.points });
});

profile.get("/transactions", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const rows = await sql`
    SELECT id, type, amount, description, "createdAt"
    FROM "Transaction"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" DESC
    LIMIT 50
  `;

  return c.json({ transactions: rows });
});

profile.get("/orders", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const rows = await sql`
    SELECT
      o.id, o.status, o."paymentMethod", o."expiresAt", o."createdAt",
      r.name AS "roomName", r.label AS "roomLabel",
      p.name AS "planName", p.duration AS "planDuration", p.price
    FROM "Order" o
    JOIN "Room" r ON r.id = o."roomId"
    JOIN "Plan" p ON p.id = o."planId"
    WHERE o."userId" = ${userId}
    ORDER BY o."createdAt" DESC
    LIMIT 30
  `;

  return c.json({ orders: rows });
});

export default profile;
