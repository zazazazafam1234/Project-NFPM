import { Hono } from "hono";
import sql from "../db";
import { getSessionUserId } from "../session";

const track = new Hono();

const VISITOR_ID = /^[A-Za-z0-9-]{8,64}$/;

// Records one page view from the storefront; feeds the admin visitor report.
track.post("/", async (c) => {
  const body = await c.req.json<{ visitorId?: string; path?: string; referrer?: string }>().catch(() => null);
  const visitorId = body?.visitorId ?? "";
  const path = body?.path ?? "";
  if (!VISITOR_ID.test(visitorId) || !path.startsWith("/") || path.length > 300) {
    return c.body(null, 204);
  }

  const userId = await getSessionUserId(c);
  const referrer = body?.referrer ? body.referrer.slice(0, 300) : null;
  try {
    await sql`
      INSERT INTO page_views (visitor_id, user_id, path, referrer)
      VALUES (${visitorId}, ${userId}, ${path}, ${referrer})
    `;
  } catch (err) {
    // Tracking must never break the storefront (e.g. a session for a deleted user).
    console.error("[track] insert failed", err instanceof Error ? err.message : err);
  }
  return c.body(null, 204);
});

export default track;
