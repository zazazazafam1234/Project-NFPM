import { Hono } from "hono";
import prisma from "../db";

const catalog = new Hono();

const PLAN_TAGS: Record<string, string> = {
  day: "เริ่มต้นง่าย",
  week: "คุ้มค่า",
  month: "ขายดี",
};

const ADMIN_KEY = process.env.ADMIN_KEY ?? "admin-secret";

function isAdmin(c: { req: { header: (h: string) => string | undefined } }) {
  return c.req.header("x-admin-key") === ADMIN_KEY;
}

// ─── Public routes ───────────────────────────────────────────────

catalog.get("/rooms", async (c) => {
  const now = new Date();

  const [rooms, activeOrderCounts] = await Promise.all([
    prisma.room.findMany({ orderBy: { id: "asc" } }),
    prisma.order.groupBy({
      by: ["roomId"],
      where: {
        status: "paid",
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      _count: { id: true },
    }),
  ]);

  const membersByRoom = Object.fromEntries(
    activeOrderCounts.map((r) => [r.roomId, r._count.id])
  );

  return c.json(
    rooms.map((room) => {
      const members = membersByRoom[room.id] ?? 0;
      return {
        id: room.id,
        name: room.name,
        label: room.label,
        capacity: room.capacity,
        members,
        available: members < room.capacity,
      };
    })
  );
});

catalog.get("/plans", async (c) => {
  const plans = await prisma.plan.findMany({ orderBy: { price: "asc" } });
  return c.json(
    plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      duration: plan.duration,
      durationDays: plan.durationDays,
      tag: PLAN_TAGS[plan.id] ?? "",
    }))
  );
});

// ─── Admin routes (require x-admin-key header) ────────────────────

catalog.post("/rooms", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);

  const body = await c.req.json<{
    id: string;
    name: string;
    label: string;
    capacity?: number;
  }>();

  if (!body.id || !body.name || !body.label) {
    return c.json({ message: "id, name, label required" }, 400);
  }

  const room = await prisma.room.create({
    data: {
      id: body.id,
      name: body.name,
      label: body.label,
      capacity: body.capacity ?? 4,
    },
  });

  return c.json(room, 201);
});

catalog.put("/rooms/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    label?: string;
    capacity?: number;
  }>();

  const room = await prisma.room.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.label !== undefined && { label: body.label }),
      ...(body.capacity !== undefined && { capacity: body.capacity }),
    },
  });

  return c.json(room);
});

catalog.delete("/rooms/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);

  const id = c.req.param("id");
  await prisma.room.delete({ where: { id } });
  return c.body(null, 204);
});

catalog.post("/plans", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);

  const body = await c.req.json<{
    id: string;
    name: string;
    price: number;
    duration: string;
    durationDays: number;
  }>();

  if (!body.id || !body.name || !body.price || !body.duration || !body.durationDays) {
    return c.json({ message: "id, name, price, duration, durationDays required" }, 400);
  }

  const plan = await prisma.plan.create({ data: body });
  return c.json(plan, 201);
});

catalog.put("/plans/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    price?: number;
    duration?: string;
    durationDays?: number;
  }>();

  const plan = await prisma.plan.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.price !== undefined && { price: body.price }),
      ...(body.duration !== undefined && { duration: body.duration }),
      ...(body.durationDays !== undefined && { durationDays: body.durationDays }),
    },
  });

  return c.json(plan);
});

catalog.delete("/plans/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);

  const id = c.req.param("id");
  await prisma.plan.delete({ where: { id } });
  return c.body(null, 204);
});

catalog.get("/categories", async (c) => {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { products: { where: { isActive: true } } } } },
  });
  return c.json(
    categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      icon: cat.icon,
      productCount: cat._count.products,
    }))
  );
});

catalog.get("/products", async (c) => {
  const slug = c.req.query("category");

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(slug ? { category: { slug } } : {}),
    },
    orderBy: [{ categoryId: "asc" }, { name: "asc" }],
    include: { category: { select: { name: true, slug: true, icon: true } } },
  });

  return c.json(
    products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      badge: p.badge,
      price: p.price,
      stock: p.stock,
      category: p.category,
    }))
  );
});

catalog.put("/products/:id/stock", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Unauthorized" }, 401);
  const id = c.req.param("id");
  const { stock } = await c.req.json<{ stock: number }>();
  const product = await prisma.product.update({ where: { id }, data: { stock } });
  return c.json({ id: product.id, stock: product.stock });
});

export default catalog;
