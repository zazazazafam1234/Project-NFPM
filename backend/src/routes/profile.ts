import { Hono } from "hono";
import sql from "../db";
import { getSessionUserId } from "../session";
import { createTopUp } from "./points";

const profile = new Hono();

profile.post("/top-ups", createTopUp);

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
