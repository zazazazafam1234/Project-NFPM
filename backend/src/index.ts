import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import admin from "./routes/admin";
import auth from "./routes/auth";
import catalog from "./routes/catalog";
import orders from "./routes/orders";
import points from "./routes/points";
import profile from "./routes/profile";
import subscriptions from "./routes/subscriptions";

const app = new Hono();
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: webOrigin,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-admin-key"],
  })
);

const api = new Hono();
api.route("/admin", admin);
api.route("/auth", auth);
api.route("/catalog", catalog);
api.route("/orders", orders);
api.route("/points", points);
api.route("/profile", profile);
api.route("/subscriptions", subscriptions);

app.route("/api", api);

app.get("/", (c) => c.json({ ok: true, service: "Fast Movie API" }));

const port = parseInt(process.env.PORT ?? "4000");
console.log(`Server running at http://localhost:${port}`);

export default { port, fetch: app.fetch };
