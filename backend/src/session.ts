import { SignJWT, jwtVerify } from "jose";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "change-me-in-production"
);
const COOKIE_NAME = "session";
const isProd = process.env.NODE_ENV === "production";

export async function createSession(c: Context, userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(secret);

  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isProd,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function getSessionUserId(c: Context): Promise<string | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export function clearSession(c: Context) {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}
