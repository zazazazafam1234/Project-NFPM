import type { Context, Next } from "hono";
import sql from "./db";
import { getSessionUserId } from "./session";

export async function requireAdmin(c: Context, next: Next) {
  const userId = await getSessionUserId(c);
  if (userId) {
    const [user] = await sql`SELECT role FROM "User" WHERE id = ${userId}`;
    if (user?.role === "admin") return next();
  }

  // Fallback: static API key for programmatic access
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && c.req.header("x-admin-key") === adminKey) return next();

  return c.json({ message: "Unauthorized" }, 401);
}

export async function getAdminSession(c: Context) {
  const userId = await getSessionUserId(c);
  if (!userId) return null;
  const [user] = await sql`SELECT id, name, email, image, role FROM "User" WHERE id = ${userId}`;
  return user?.role === "admin" ? user : null;
}
