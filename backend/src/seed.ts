import sql from "./db";

// Rooms
const rooms = [
  { id: "room-1", name: "ROOM 01", label: "MIDNIGHT", capacity: 4 },
  { id: "room-2", name: "ROOM 02", label: "VIOLET",   capacity: 4 },
  { id: "room-3", name: "ROOM 03", label: "SUNSET",   capacity: 4 },
  { id: "room-4", name: "ROOM 04", label: "NIGHT OUT", capacity: 4 },
  { id: "room-5", name: "ROOM 05", label: "LATE SHOW", capacity: 4 },
  { id: "room-6", name: "ROOM 06", label: "CINEMA",   capacity: 4 },
];
for (const r of rooms) {
  await sql`
    INSERT INTO "Room" (id, name, label, capacity)
    VALUES (${r.id}, ${r.name}, ${r.label}, ${r.capacity})
    ON CONFLICT (id) DO NOTHING
  `;
}

// Plans
const plans = [
  { id: "day",   name: "รายวัน",      price: 10,  duration: "24 ชั่วโมง", durationDays: 1  },
  { id: "week",  name: "รายสัปดาห์", price: 49,  duration: "7 วัน",      durationDays: 7  },
  { id: "month", name: "รายเดือน",   price: 129, duration: "30 วัน",     durationDays: 30 },
];
for (const p of plans) {
  await sql`
    INSERT INTO "Plan" (id, name, price, duration, "durationDays")
    VALUES (${p.id}, ${p.name}, ${p.price}, ${p.duration}, ${p.durationDays})
    ON CONFLICT (id) DO UPDATE SET "durationDays" = EXCLUDED."durationDays"
  `;
}

// Categories
const categories = [
  { id: "cat-streaming", name: "Video Streaming", slug: "streaming", icon: "🎬", sortOrder: 1 },
  { id: "cat-music",     name: "Music",           slug: "music",     icon: "🎵", sortOrder: 2 },
  { id: "cat-gaming",    name: "Gaming",          slug: "gaming",    icon: "🎮", sortOrder: 3 },
  { id: "cat-other",     name: "อื่นๆ",            slug: "other",     icon: "📦", sortOrder: 4 },
];
for (const cat of categories) {
  await sql`
    INSERT INTO "Category" (id, name, slug, icon, "sortOrder")
    VALUES (${cat.id}, ${cat.name}, ${cat.slug}, ${cat.icon}, ${cat.sortOrder})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon
  `;
}

// Products
const products = [
  { name: "Netflix Standard",  description: "Full HD · 2 หน้าจอพร้อมกัน",     badge: "ขายดี",  categoryId: "cat-streaming", price: 99,  stock: 8  },
  { name: "Netflix Premium",   description: "4K UHD · 4 หน้าจอพร้อมกัน",      badge: "แนะนำ",  categoryId: "cat-streaming", price: 149, stock: 3  },
  { name: "YouTube Premium",   description: "ไม่มีโฆษณา · ดาวน์โหลดได้",      badge: null,     categoryId: "cat-streaming", price: 59,  stock: 12 },
  { name: "Disney+",           description: "Marvel · Star Wars · Pixar",       badge: "ใหม่",   categoryId: "cat-streaming", price: 79,  stock: 5  },
  { name: "HBO Max",           description: "Series & Movies จาก Warner",       badge: null,     categoryId: "cat-streaming", price: 89,  stock: 0  },
  { name: "Spotify Premium",   description: "เพลงไม่มีโฆษณา · ดาวน์โหลด",     badge: "ขายดี",  categoryId: "cat-music",     price: 59,  stock: 10 },
  { name: "Apple Music",       description: "เพลง 100 ล้านเพลง · ไม่มีโฆษณา", badge: null,     categoryId: "cat-music",     price: 59,  stock: 7  },
  { name: "YouTube Music",     description: "เพลง + MV · ไม่มีโฆษณา",          badge: null,     categoryId: "cat-music",     price: 49,  stock: 6  },
  { name: "Xbox Game Pass",    description: "เกม 100+ เกม บน PC & Console",    badge: "ใหม่",   categoryId: "cat-gaming",    price: 129, stock: 4  },
  { name: "PlayStation Plus",  description: "PS4/PS5 Online + เกมฟรี",          badge: null,     categoryId: "cat-gaming",    price: 119, stock: 2  },
];
for (const p of products) {
  await sql`
    INSERT INTO "Product" (id, name, description, badge, "categoryId", price, stock, "isActive", "createdAt")
    VALUES (${crypto.randomUUID()}, ${p.name}, ${p.description ?? null}, ${p.badge ?? null},
            ${p.categoryId}, ${p.price}, ${p.stock}, TRUE, NOW())
    ON CONFLICT DO NOTHING
  `;
}

console.log("Seed completed: 6 rooms · 3 plans · 4 categories · 10 products");
await sql.end();
