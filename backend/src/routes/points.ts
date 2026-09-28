import { Hono, type Context } from "hono";
import sql from "../db";
import { getSessionUserId } from "../session";

const points = new Hono();

const VALID_TOPUP_METHODS: Record<string, string> = {
  promptpay: "PromptPay",
  wallet: "TrueMoney Wallet",
  truemoney: "TrueMoney Wallet",
};

export async function createTopUp(c: Context) {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const { points, paymentMethod } = await c.req.json<{
    points: number;
    amount: number;
    paymentMethod: string;
  }>();

  if (!points || points <= 0) {
    return c.json({ message: "จำนวน Point ไม่ถูกต้อง" }, 400);
  }
  if (!VALID_TOPUP_METHODS[paymentMethod]) {
    return c.json({ message: "ช่องทางการชำระเงินไม่ถูกต้อง" }, 400);
  }

  try {
    const result = await sql.begin(async (sql) => {
      const [user] = await sql`
        UPDATE "User" SET points = points + ${points}, "updatedAt" = NOW()
        WHERE id = ${userId}
          AND status = 'active'
        RETURNING points
      `;
      if (!user) throw new Error("บัญชีนี้ไม่พร้อมใช้งาน");
      await sql`
        INSERT INTO "Transaction" (id, "userId", type, amount, description, "createdAt")
        VALUES (${crypto.randomUUID()}, ${userId}, 'topup', ${points},
                ${`เติม ${points.toLocaleString()} Point — ${VALID_TOPUP_METHODS[paymentMethod]}`}, NOW())
      `;
      return { points: user.points };
    });

    return c.json({ points: result.points });
  } catch (err) {
    return c.json(
      { message: err instanceof Error ? err.message : "เติม Point ไม่สำเร็จ" },
      400,
    );
  }
}

points.post("/top-ups", createTopUp);

export default points;
