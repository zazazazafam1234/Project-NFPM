import sql from "./db";
import { encryptSecret } from "./crypto";

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

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

const streamingPackages = [
  {
    slug: "netflix-day",
    name: "Netflix รายวัน",
    service: "netflix",
    description: "เลือก Slot ก่อน แล้วใช้ได้ 24 ชั่วโมง",
    durationDays: 1,
    priceAmount: 10,
    sortOrder: 10,
  },
  {
    slug: "netflix-week",
    name: "Netflix รายสัปดาห์",
    service: "netflix",
    description: "เหมาะสำหรับดูซีรีส์สั้น ๆ หนึ่งสัปดาห์",
    durationDays: 7,
    priceAmount: 49,
    sortOrder: 20,
  },
  {
    slug: "netflix-month",
    name: "Netflix รายเดือน",
    service: "netflix",
    description: "ใช้งานยาวครบเดือน",
    durationDays: 30,
    priceAmount: 129,
    sortOrder: 30,
  },
];

for (const pkg of streamingPackages) {
  await sql`
    INSERT INTO packages (
      slug, name, service, description, duration_days, price_amount, sort_order, status, updated_at
    )
    VALUES (
      ${pkg.slug},
      ${pkg.name},
      ${pkg.service},
      ${pkg.description},
      ${pkg.durationDays},
      ${pkg.priceAmount},
      ${pkg.sortOrder},
      'active',
      NOW()
    )
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      service = EXCLUDED.service,
      description = EXCLUDED.description,
      duration_days = EXCLUDED.duration_days,
      price_amount = EXCLUDED.price_amount,
      sort_order = EXCLUDED.sort_order,
      status = EXCLUDED.status,
      updated_at = NOW(),
      deleted_at = NULL
  `;
}

const [defaultPackage] = await sql`
  SELECT id, service
  FROM packages
  WHERE slug = 'netflix-week'
  LIMIT 1
`;

const demoRooms = [
  {
    email: "demo-room-01@fastmovie.local",
    password: "DemoRoom01!",
    note: "Demo Room 01",
    profiles: ["Slot 1", "Slot 2", "Slot 3", "Slot 4"],
  },
  {
    email: "demo-room-02@fastmovie.local",
    password: "DemoRoom02!",
    note: "Demo Room 02",
    profiles: ["Slot 1", "Slot 2", "Slot 3", "Slot 4"],
  },
];

const purchasedAt = new Date();
const masterExpiredAt = addDays(purchasedAt, 90);

for (const room of demoRooms) {
  const [existing] = await sql`
    SELECT id
    FROM master_emails
    WHERE LOWER(email) = LOWER(${room.email})
      AND service = ${defaultPackage.service}
      AND deleted_at IS NULL
    LIMIT 1
  `;

  const [masterEmail] = existing
    ? await sql`
        UPDATE master_emails
        SET
          package_id = ${defaultPackage.id},
          password_ciphertext = ${encryptSecret(room.password)},
          status = 'active',
          master_expired_at = ${masterExpiredAt.toISOString()},
          note = ${room.note},
          updated_at = NOW()
        WHERE id = ${existing.id}
        RETURNING id
      `
    : await sql`
        INSERT INTO master_emails (
          package_id, service, email, password_ciphertext, status,
          purchased_at, master_expired_at, note
        )
        VALUES (
          ${defaultPackage.id},
          ${defaultPackage.service},
          ${room.email},
          ${encryptSecret(room.password)},
          'active',
          ${purchasedAt.toISOString()},
          ${masterExpiredAt.toISOString()},
          ${room.note}
        )
        RETURNING id
      `;

  for (const profileName of room.profiles) {
    await sql`
      INSERT INTO profiles (
        master_email_id, profile_name, profile_pin_ciphertext, status, profile_expires_at, note
      )
      VALUES (
        ${masterEmail.id},
        ${profileName},
        ${encryptSecret("1234")},
        'available',
        NULL,
        'Demo seed slot'
      )
      ON CONFLICT (master_email_id, LOWER(profile_name)) WHERE deleted_at IS NULL
      DO UPDATE SET
        profile_pin_ciphertext = EXCLUDED.profile_pin_ciphertext,
        status = CASE
          WHEN profiles.status IN ('rented', 'reserved') THEN profiles.status
          ELSE 'available'::profile_status
        END,
        profile_expires_at = NULL,
        note = EXCLUDED.note,
        updated_at = NOW()
    `;
  }
}

if (process.env.SEED_USER_EMAIL && process.env.SEED_USER_POINTS) {
  const points = Number(process.env.SEED_USER_POINTS);
  if (Number.isFinite(points) && points >= 0) {
    await sql`
      UPDATE "User"
      SET points = ${points}, "updatedAt" = NOW()
      WHERE LOWER(email) = LOWER(${process.env.SEED_USER_EMAIL})
    `;
  }
}

console.log("Seed completed: legacy catalog + streaming packages + 2 demo rooms + 8 slots");
await sql.end();
