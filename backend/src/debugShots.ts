import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";

/**
 * Failure screenshots taken by the pin-service, shown in LINE alerts. LINE fetches
 * images from a public https URL, so the backend serves them at
 * /api/debug-shots/:name?exp=..&sig=.. — signed (HMAC with JWT_SECRET) and valid for a
 * week — proxying the file from the pin-service, which keeps it behind its service key.
 */

const VALID_FOR_SECONDS = 7 * 24 * 60 * 60;
const NAME = /^[0-9]{8}-[0-9]{6}-[A-Za-z0-9_.-]+\.png$/;

function signature(name: string, exp: number) {
  return createHmac("sha256", process.env.JWT_SECRET ?? process.env.PIN_SERVICE_KEY ?? "")
    .update(`${name}:${exp}`)
    .digest("hex")
    .slice(0, 32);
}

/** Public URLs for screenshot names; empty unless API_URL is https (LINE requires it). */
export function debugShotUrls(names: string[] | undefined) {
  const api = (process.env.API_URL ?? "").replace(/\/+$/, "");
  if (!api.startsWith("https://") || !names?.length) return [];
  const exp = Math.floor(Date.now() / 1000) + VALID_FOR_SECONDS;
  return names
    .filter((name) => NAME.test(name))
    .map((name) => `${api}/debug-shots/${encodeURIComponent(name)}?exp=${exp}&sig=${signature(name, exp)}`);
}

const debugShots = new Hono();

debugShots.get("/:name", async (c) => {
  const name = c.req.param("name");
  const exp = Number(c.req.query("exp"));
  const sig = c.req.query("sig") ?? "";
  if (!NAME.test(name) || !Number.isFinite(exp) || exp < Date.now() / 1000) return c.notFound();
  const expected = signature(name, exp);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return c.notFound();

  const service = process.env.PIN_SERVICE_URL;
  if (!service) return c.notFound();
  const response = await fetch(`${service.replace(/\/+$/, "")}/debug-shots/${encodeURIComponent(name)}`, {
    headers: { "x-service-key": process.env.PIN_SERVICE_KEY ?? "" },
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!response?.ok) return c.notFound();
  return new Response(response.body, {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
  });
});

export default debugShots;
