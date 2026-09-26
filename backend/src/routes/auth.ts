import { Hono } from "hono";
import prisma from "../db";
import { createSession, clearSession, getSessionUserId } from "../session";

const auth = new Hono();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const API_URL = process.env.API_URL ?? "http://localhost:4000/api";

auth.get("/google", (c) => {
  const redirectTo = c.req.query("redirectTo") ?? "/";
  const callbackUrl = `${API_URL}/auth/callback/google`;

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state: encodeURIComponent(redirectTo),
    access_type: "online",
  });

  return c.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
});

auth.get("/callback/google", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const redirectTo = state ? decodeURIComponent(state) : "/";

  if (!code) return c.json({ message: "No code provided" }, 400);

  const callbackUrl = `${API_URL}/auth/callback/google`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return c.json({ message: "OAuth token exchange failed" }, 400);
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const userRes = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  if (!userRes.ok) {
    return c.json({ message: "Failed to get Google user info" }, 400);
  }

  const googleUser = (await userRes.json()) as {
    sub: string;
    email: string;
    name: string;
    picture?: string;
  };

  const user = await prisma.user.upsert({
    where: { googleId: googleUser.sub },
    update: { name: googleUser.name, image: googleUser.picture ?? null },
    create: {
      googleId: googleUser.sub,
      email: googleUser.email,
      name: googleUser.name,
      image: googleUser.picture ?? null,
      points: 0,
    },
  });

  await createSession(c, user.id);
  return c.redirect(redirectTo);
});

auth.get("/session", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ user: null });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return c.json({ user: null });

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      points: user.points,
    },
  });
});

auth.post("/logout", (c) => {
  clearSession(c);
  return c.body(null, 204);
});

export default auth;
