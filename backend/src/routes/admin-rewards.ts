import { Hono } from "hono";
import sql from "../db";
import { generateStreamerCode } from "../rewards";
import { referralCodeTaken } from "../resellers";

/** Admin CRUD for top-up promotions and streamer referral codes (mounted under /admin). */
const rewards = new Hono();

type RewardBody = {
  rewardType?: "fixed" | "percent";
  rewardValue?: number;
  maxReward?: number | null; // baht, percent rewards only
  status?: "active" | "inactive";
};

// Validates reward fields; returns DB columns or an error message.
function rewardColumns(body: RewardBody, partial: boolean) {
  const columns: Record<string, unknown> = {};
  if (body.rewardType !== undefined || !partial) {
    if (body.rewardType !== "fixed" && body.rewardType !== "percent") return "เลือกประเภทส่วนลด (บาท หรือ %)";
    columns.reward_type = body.rewardType;
  }
  if (body.rewardValue !== undefined || !partial) {
    const value = Number(body.rewardValue);
    if (!Number.isFinite(value) || value <= 0) return "มูลค่าส่วนลดต้องมากกว่า 0";
    if (body.rewardType === "percent" && value > 100) return "ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100%";
    columns.reward_value = Math.round(value * 100) / 100;
  }
  if (body.maxReward !== undefined) {
    const max = body.maxReward === null ? null : Number(body.maxReward);
    if (max !== null && (!Number.isFinite(max) || max <= 0)) return "ส่วนลดสูงสุดต้องมากกว่า 0";
    columns.max_reward_cents = max === null ? null : Math.round(max * 100);
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "inactive") return "สถานะไม่ถูกต้อง";
    columns.status = body.status;
  }
  return columns;
}

// ─── Top-up promotions ───

rewards.get("/topup-promotions", async (c) => {
  const promotions = await sql`
    SELECT p.id, p.name, p.min_amount_cents AS "minAmountCents", p.reward_type AS "rewardType",
      p.reward_value::float AS "rewardValue", p.max_reward_cents AS "maxRewardCents", p.status,
      p.created_at AS "createdAt",
      COUNT(t.id) FILTER (WHERE t.status = 'paid')::int AS "timesUsed",
      COALESCE(SUM(t.promotion_reward_cents) FILTER (WHERE t.status = 'paid'), 0)::int AS "rewardGivenCents"
    FROM topup_promotions p
    LEFT JOIN point_topups t ON t.promotion_id = p.id
    WHERE p.deleted_at IS NULL
    GROUP BY p.id
    ORDER BY p.min_amount_cents
  `;
  return c.json({ promotions });
});

rewards.post("/topup-promotions", async (c) => {
  const body = await c.req.json<RewardBody & { name?: string; minAmount?: number }>();
  const name = body.name?.trim();
  const minAmount = Number(body.minAmount);
  if (!name) return c.json({ message: "กรุณาตั้งชื่อโปร" }, 400);
  if (!Number.isFinite(minAmount) || minAmount <= 0) return c.json({ message: "ยอดเติมขั้นต่ำต้องมากกว่า 0" }, 400);
  const columns = rewardColumns(body, false);
  if (typeof columns === "string") return c.json({ message: columns }, 400);

  const [promotion] = await sql`
    INSERT INTO topup_promotions ${sql({
      name,
      min_amount_cents: Math.round(minAmount * 100),
      max_reward_cents: null,
      status: "active",
      ...columns,
    })}
    RETURNING id
  `;
  return c.json(promotion, 201);
});

rewards.patch("/topup-promotions/:id", async (c) => {
  const body = await c.req.json<RewardBody & { name?: string; minAmount?: number }>();
  const columns = rewardColumns(body, true);
  if (typeof columns === "string") return c.json({ message: columns }, 400);
  if (body.name !== undefined) {
    if (!body.name.trim()) return c.json({ message: "กรุณาตั้งชื่อโปร" }, 400);
    columns.name = body.name.trim();
  }
  if (body.minAmount !== undefined) {
    const minAmount = Number(body.minAmount);
    if (!Number.isFinite(minAmount) || minAmount <= 0) return c.json({ message: "ยอดเติมขั้นต่ำต้องมากกว่า 0" }, 400);
    columns.min_amount_cents = Math.round(minAmount * 100);
  }
  if (!Object.keys(columns).length) return c.json({ message: "Nothing to update" }, 400);

  const [promotion] = await sql`
    UPDATE topup_promotions SET ${sql(columns)}, updated_at = NOW()
    WHERE id = ${c.req.param("id")}::uuid AND deleted_at IS NULL
    RETURNING id
  `;
  if (!promotion) return c.json({ message: "ไม่พบโปรนี้" }, 404);
  return c.json(promotion);
});

rewards.delete("/topup-promotions/:id", async (c) => {
  const [promotion] = await sql`
    UPDATE topup_promotions SET deleted_at = NOW(), status = 'inactive', updated_at = NOW()
    WHERE id = ${c.req.param("id")}::uuid AND deleted_at IS NULL
    RETURNING id
  `;
  if (!promotion) return c.json({ message: "ไม่พบโปรนี้" }, 404);
  return c.json({ ok: true });
});

// ─── Streamers ───

function referralLink(code: string) {
  const origin = (process.env.WEB_ORIGIN ?? "").replace(/\/+$/, "");
  return `${origin}/payment?code=${encodeURIComponent(code)}`;
}

function cleanCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

rewards.get("/streamers", async (c) => {
  const streamers = await sql`
    SELECT
      s.id, s.name, s.link, s.code, s.reward_type AS "rewardType", s.reward_value::float AS "rewardValue",
      s.max_reward_cents AS "maxRewardCents", s.max_uses AS "maxUses", s.status, s.created_at AS "createdAt",
      (SELECT COUNT(*) FROM streamer_redemptions r WHERE r.streamer_id = s.id AND r.status = 'redeemed')::int AS "redeemed",
      (SELECT COUNT(*) FROM streamer_redemptions r WHERE r.streamer_id = s.id AND r.status = 'pending')::int AS "pending",
      (SELECT COALESCE(SUM(r.reward_cents), 0) FROM streamer_redemptions r
        WHERE r.streamer_id = s.id AND r.status = 'redeemed')::int AS "rewardGivenCents",
      (SELECT COUNT(*) FROM "User" u WHERE u.referred_streamer_id = s.id)::int AS "customers",
      (SELECT COUNT(*) FROM point_topups t JOIN "User" u ON u.id = t.user_id
        WHERE u.referred_streamer_id = s.id AND t.status = 'paid')::int AS "topups",
      (SELECT COALESCE(SUM(COALESCE(t.matched_amount_cents, t.payable_amount_cents)), 0) FROM point_topups t
        JOIN "User" u ON u.id = t.user_id
        WHERE u.referred_streamer_id = s.id AND t.status = 'paid')::bigint AS "topupCents",
      (SELECT COUNT(*) FROM subscriptions sub JOIN "User" u ON u.id = sub.user_id
        WHERE u.referred_streamer_id = s.id)::int AS "purchases",
      (SELECT COALESCE(SUM(sub.price_paid), 0) FROM subscriptions sub JOIN "User" u ON u.id = sub.user_id
        WHERE u.referred_streamer_id = s.id)::int AS "pointsSpent"
    FROM streamers s
    WHERE s.deleted_at IS NULL
    ORDER BY s.created_at DESC
  `;
  return c.json({
    streamers: streamers.map((row) => ({
      ...row,
      topupCents: Number(row.topupCents),
      referralLink: referralLink(row.code),
    })),
  });
});

rewards.post("/streamers", async (c) => {
  const body = await c.req.json<RewardBody & { name?: string; link?: string | null; code?: string; maxUses?: number | null }>();
  const name = body.name?.trim();
  if (!name) return c.json({ message: "กรุณาใส่ชื่อสตรีมเมอร์" }, 400);
  const columns = rewardColumns(body, false);
  if (typeof columns === "string") return c.json({ message: columns }, 400);
  const maxUses = body.maxUses === null || body.maxUses === undefined ? null : Number(body.maxUses);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
    return c.json({ message: "จำนวนคนที่ใช้ได้ต้องเป็นจำนวนเต็ม 1 ขึ้นไป (เว้นว่าง = ไม่จำกัด)" }, 400);
  }

  const requested = body.code ? cleanCode(body.code) : "";
  if (requested && (await referralCodeTaken(requested))) return c.json({ message: `โค้ด ${requested} ถูกใช้แล้ว` }, 400);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = requested || generateStreamerCode(name);
    try {
      const [streamer] = await sql`
        INSERT INTO streamers ${sql({
          name,
          link: body.link?.trim() || null,
          code,
          max_uses: maxUses,
          max_reward_cents: null,
          status: "active",
          ...columns,
        })}
        RETURNING id, code
      `;
      return c.json({ ...streamer, referralLink: referralLink(streamer.code) }, 201);
    } catch (err) {
      const duplicate = err instanceof Error && /streamers_code_unique/.test(err.message);
      if (!duplicate) throw err;
      if (requested) return c.json({ message: `โค้ด ${requested} ถูกใช้แล้ว` }, 400);
    }
  }
  return c.json({ message: "สร้างโค้ดไม่สำเร็จ กรุณาลองใหม่" }, 500);
});

rewards.patch("/streamers/:id", async (c) => {
  const body = await c.req.json<
    RewardBody & { name?: string; link?: string | null; code?: string; regenerateCode?: boolean; maxUses?: number | null }
  >();
  const columns = rewardColumns(body, true);
  if (typeof columns === "string") return c.json({ message: columns }, 400);
  if (body.name !== undefined) {
    if (!body.name.trim()) return c.json({ message: "กรุณาใส่ชื่อสตรีมเมอร์" }, 400);
    columns.name = body.name.trim();
  }
  if (body.link !== undefined) columns.link = body.link?.trim() || null;
  if (body.maxUses !== undefined) {
    const maxUses = body.maxUses === null ? null : Number(body.maxUses);
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
      return c.json({ message: "จำนวนคนที่ใช้ได้ต้องเป็นจำนวนเต็ม 1 ขึ้นไป (เว้นว่าง = ไม่จำกัด)" }, 400);
    }
    columns.max_uses = maxUses;
  }
  if (body.code) {
    columns.code = cleanCode(body.code);
    const [reseller] = await sql`SELECT 1 FROM resellers WHERE UPPER(code) = ${columns.code} AND deleted_at IS NULL`;
    if (reseller) return c.json({ message: "โค้ดนี้ถูกใช้แล้ว" }, 400);
  }
  if (body.regenerateCode) {
    const [current] = await sql`SELECT name FROM streamers WHERE id = ${c.req.param("id")}::uuid`;
    columns.code = generateStreamerCode(String(columns.name ?? current?.name ?? ""));
  }
  if (!Object.keys(columns).length) return c.json({ message: "Nothing to update" }, 400);

  try {
    const [streamer] = await sql`
      UPDATE streamers SET ${sql(columns)}, updated_at = NOW()
      WHERE id = ${c.req.param("id")}::uuid AND deleted_at IS NULL
      RETURNING id, code
    `;
    if (!streamer) return c.json({ message: "ไม่พบสตรีมเมอร์นี้" }, 404);
    return c.json({ ...streamer, referralLink: referralLink(streamer.code) });
  } catch (err) {
    if (err instanceof Error && /streamers_code_unique/.test(err.message)) {
      return c.json({ message: "โค้ดนี้ถูกใช้แล้ว" }, 400);
    }
    throw err;
  }
});

rewards.delete("/streamers/:id", async (c) => {
  const [streamer] = await sql`
    UPDATE streamers SET deleted_at = NOW(), status = 'inactive', updated_at = NOW()
    WHERE id = ${c.req.param("id")}::uuid AND deleted_at IS NULL
    RETURNING id
  `;
  if (!streamer) return c.json({ message: "ไม่พบสตรีมเมอร์นี้" }, 404);
  return c.json({ ok: true });
});

export default rewards;
