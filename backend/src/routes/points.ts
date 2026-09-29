import { Hono, type Context } from "hono";
import { getSessionUserId } from "../session";
import { getMinTopupPoints } from "../settings";
import { createPromptPayTopUp, getTopUpForUser } from "../topups";

const points = new Hono();

const VALID_TOPUP_METHODS: Record<string, string> = {
  promptpay: "PromptPay",
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
    return c.json({ message: "ตอนนี้รองรับ PromptPay QR เท่านั้น" }, 400);
  }

  try {
    const topUp = await createPromptPayTopUp({ userId, points });
    return c.json(topUp, 201);
  } catch (err) {
    return c.json(
      { message: err instanceof Error ? err.message : "สร้างรายการเติม Point ไม่สำเร็จ" },
      400,
    );
  }
}

points.post("/top-ups", createTopUp);
points.get("/settings", async (c) => c.json({ minTopupPoints: await getMinTopupPoints() }));
points.get("/top-ups/:id", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const topUp = await getTopUpForUser(c.req.param("id"), userId);
  if (!topUp) return c.json({ message: "ไม่พบรายการเติมเงิน" }, 404);

  return c.json(topUp);
});

export default points;
