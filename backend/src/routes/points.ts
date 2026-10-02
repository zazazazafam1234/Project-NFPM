import { Hono, type Context } from "hono";
import { getSessionUserId } from "../session";
import sql from "../db";
import { checkStreamerCode } from "../rewards";
import { checkResellerCode } from "../resellers";
import { getMinTopupPoints } from "../settings";
import { cancelTopUpForUser, createPromptPayTopUp, getTopUpForUser, listTopUpsForUser, requestTopUpCheck } from "../topups";

const points = new Hono();

const VALID_TOPUP_METHODS: Record<string, string> = {
  promptpay: "PromptPay",
};

export async function createTopUp(c: Context) {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const { points, paymentMethod, code } = await c.req.json<{
    points: number;
    amount: number;
    paymentMethod: string;
    code?: string | null;
  }>();

  if (!points || points <= 0) {
    return c.json({ message: "จำนวน Point ไม่ถูกต้อง" }, 400);
  }
  if (!VALID_TOPUP_METHODS[paymentMethod]) {
    return c.json({ message: "ตอนนี้รองรับ PromptPay QR เท่านั้น" }, 400);
  }

  try {
    const topUp = await createPromptPayTopUp({ userId, points, code });
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
points.get("/top-ups", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const topUps = await listTopUpsForUser(userId);
  return c.json({ topUps });
});

// Active "เติมครบ ... ได้ส่วนลด ..." promotions shown on the top-up page.
points.get("/promotions", async (c) => {
  const promotions = await sql`
    SELECT id, name, min_amount_cents AS "minAmountCents", reward_type AS "rewardType",
      reward_value::float AS "rewardValue", max_reward_cents AS "maxRewardCents"
    FROM topup_promotions
    WHERE status = 'active' AND deleted_at IS NULL
    ORDER BY min_amount_cents
  `;
  return c.json({ promotions });
});

// Checks a reseller or streamer code before the customer creates the QR.
points.get("/codes/:code", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);
  const reseller = await checkResellerCode(sql, c.req.param("code"), userId);
  if (reseller.ok) {
    return c.json({
      streamerName: "ตัวแทนจำหน่าย",
      code: reseller.reseller.code,
      rewardType: "percent",
      rewardValue: reseller.percent,
      maxRewardCents: null,
    });
  }
  if (!reseller.notFound) return c.json({ message: reseller.message }, 400);
  const check = await checkStreamerCode(sql, c.req.param("code"), userId);
  if (!check.ok) return c.json({ message: check.message }, 400);
  return c.json({
    streamerName: check.streamer.name,
    code: check.streamer.code,
    rewardType: check.streamer.reward_type,
    rewardValue: Number(check.streamer.reward_value),
    maxRewardCents: check.streamer.max_reward_cents,
  });
});
points.get("/top-ups/:id", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const topUp = await getTopUpForUser(c.req.param("id"), userId);
  if (!topUp) return c.json({ message: "ไม่พบรายการเติมเงิน" }, 404);

  return c.json(topUp);
});

points.post("/top-ups/:id/check", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);
  const result = await requestTopUpCheck(c.req.param("id"), userId);
  if (!result.ok) return c.json({ message: result.message }, 400);
  return c.json({ ok: true });
});

points.post("/top-ups/:id/cancel", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ message: "กรุณาเข้าสู่ระบบก่อน" }, 401);

  const topUp = await cancelTopUpForUser(c.req.param("id"), userId);
  if (!topUp) {
    return c.json({ message: "รายการนี้ยกเลิกไม่ได้แล้ว หรือไม่ได้อยู่ในสถานะรอชำระ" }, 400);
  }

  return c.json(topUp);
});

export default points;
