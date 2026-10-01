import type { Context, MiddlewareHandler } from "hono";
import sql from "./db";
import { getSessionUserId } from "./session";

type AuditInput = {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

const MAX_METADATA_CHARS = 6000;

function clientIp(c: Context) {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-real-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

function boundedMetadata(metadata: Record<string, unknown> = {}) {
  const text = JSON.stringify(metadata);
  if (text.length <= MAX_METADATA_CHARS) return text;
  return JSON.stringify({
    truncated: true,
    originalLength: text.length,
    preview: text.slice(0, MAX_METADATA_CHARS),
  });
}

export async function logAudit({
  actorUserId = null,
  action,
  entityType,
  entityId = null,
  metadata = {},
}: AuditInput) {
  try {
    await sql`
      INSERT INTO admin_audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (${actorUserId}, ${action}, ${entityType}, ${entityId}, ${boundedMetadata(metadata)}::jsonb)
    `;
  } catch (err) {
    console.error("[audit] insert failed", err instanceof Error ? err.message : err);
  }
}

function requestEntity(pathname: string) {
  const parts = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "admin" && parts[1]) return `admin.${parts[1]}`;
  return parts[0] || "api";
}

export function auditRequestMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = Date.now();
    await next();

    const method = c.req.method.toUpperCase();
    if (method === "OPTIONS") return;

    const url = new URL(c.req.url);
    if (url.pathname === "/api/track" || url.pathname.startsWith("/api/admin/audit-logs")) return;

    const status = c.res.status;
    const isMutation = !["GET", "HEAD"].includes(method);
    const isError = status >= 400;
    if (!isMutation && !isError) return;

    const actorUserId = await getSessionUserId(c).catch(() => null);
    await logAudit({
      actorUserId,
      action: `request.${method.toLowerCase()}`,
      entityType: requestEntity(url.pathname),
      metadata: {
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        status,
        durationMs: Date.now() - startedAt,
        ip: clientIp(c),
        userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
      },
    });
  };
}

export function auditRequestMetadata(c: Context, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    ip: clientIp(c),
    userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
  };
}
