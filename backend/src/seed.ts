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
  { id: "product-netflix-standard", name: "Netflix Standard",  description: "Full HD · 2 หน้าจอพร้อมกัน",     badge: "ขายดี",  categoryId: "cat-streaming", price: 99,  stock: 8  },
  { id: "product-netflix-premium",  name: "Netflix Premium",   description: "4K UHD · 4 หน้าจอพร้อมกัน",      badge: "แนะนำ",  categoryId: "cat-streaming", price: 149, stock: 3  },
  { id: "product-youtube-premium",  name: "YouTube Premium",   description: "ไม่มีโฆษณา · ดาวน์โหลดได้",      badge: null,     categoryId: "cat-streaming", price: 59,  stock: 12 },
  { id: "product-disney-plus",      name: "Disney+",           description: "Marvel · Star Wars · Pixar",       badge: "ใหม่",   categoryId: "cat-streaming", price: 79,  stock: 5  },
  { id: "product-hbo-max",          name: "HBO Max",           description: "Series & Movies จาก Warner",       badge: null,     categoryId: "cat-streaming", price: 89,  stock: 0  },
  { id: "product-prime-video",      name: "Prime Video",       description: "หนังและซีรีส์ยอดนิยม",            badge: "ใหม่",   categoryId: "cat-streaming", price: 69,  stock: 9  },
  { id: "product-spotify-premium",  name: "Spotify Premium",   description: "เพลงไม่มีโฆษณา · ดาวน์โหลด",     badge: "ขายดี",  categoryId: "cat-music",     price: 59,  stock: 10 },
  { id: "product-apple-music",      name: "Apple Music",       description: "เพลง 100 ล้านเพลง · ไม่มีโฆษณา", badge: null,     categoryId: "cat-music",     price: 59,  stock: 7  },
  { id: "product-youtube-music",    name: "YouTube Music",     description: "เพลง + MV · ไม่มีโฆษณา",          badge: null,     categoryId: "cat-music",     price: 49,  stock: 6  },
  { id: "product-xbox-game-pass",   name: "Xbox Game Pass",    description: "เกม 100+ เกม บน PC & Console",    badge: "ใหม่",   categoryId: "cat-gaming",    price: 129, stock: 4  },
  { id: "product-playstation-plus", name: "PlayStation Plus",  description: "PS4/PS5 Online + เกมฟรี",          badge: null,     categoryId: "cat-gaming",    price: 119, stock: 2  },
];
for (const p of products) {
  await sql`
    INSERT INTO "Product" (id, name, description, badge, "categoryId", price, stock, "isActive", "createdAt")
    VALUES (${p.id}, ${p.name}, ${p.description ?? null}, ${p.badge ?? null},
            ${p.categoryId}, ${p.price}, ${p.stock}, TRUE, NOW())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      badge = EXCLUDED.badge,
      "categoryId" = EXCLUDED."categoryId",
      price = EXCLUDED.price,
      stock = EXCLUDED.stock,
      "isActive" = TRUE
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
    slug: "netflix-14days",
    name: "Netflix 14 วัน",
    service: "netflix",
    description: "แพ็กกลางสำหรับดูต่อเนื่องสองสัปดาห์",
    durationDays: 14,
    priceAmount: 79,
    sortOrder: 25,
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
  {
    slug: "disney-week",
    name: "Disney+ รายสัปดาห์",
    service: "disney",
    description: "Marvel, Pixar, Star Wars แบบรายสัปดาห์",
    durationDays: 7,
    priceAmount: 39,
    sortOrder: 40,
  },
  {
    slug: "disney-month",
    name: "Disney+ รายเดือน",
    service: "disney",
    description: "ดูยาวทั้งเดือนพร้อมเลือก Slot เอง",
    durationDays: 30,
    priceAmount: 99,
    sortOrder: 50,
  },
  {
    slug: "youtube-week",
    name: "YouTube Premium รายสัปดาห์",
    service: "youtube",
    description: "ไม่มีโฆษณาและใช้งาน YouTube Music",
    durationDays: 7,
    priceAmount: 29,
    sortOrder: 60,
  },
  {
    slug: "youtube-month",
    name: "YouTube Premium รายเดือน",
    service: "youtube",
    description: "แพ็กเดือนสำหรับ YouTube Premium",
    durationDays: 30,
    priceAmount: 89,
    sortOrder: 70,
  },
  {
    slug: "spotify-month",
    name: "Spotify Premium รายเดือน",
    service: "spotify",
    description: "ฟังเพลงไม่มีโฆษณาแบบรายเดือน",
    durationDays: 30,
    priceAmount: 79,
    sortOrder: 80,
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

const demoRooms = [
  {
    service: "netflix",
    email: "demo-room-01@fastmovie.local",
    password: "DemoRoom01!",
    note: "Netflix Demo Room 01",
    profiles: ["Slot 1", "Slot 2", "Slot 3", "Slot 4"],
  },
  {
    service: "netflix",
    email: "demo-room-02@fastmovie.local",
    password: "DemoRoom02!",
    note: "Netflix Demo Room 02",
    profiles: ["Slot 1", "Slot 2", "Slot 3", "Slot 4"],
  },
  {
    service: "netflix",
    email: "demo-room-03@fastmovie.local",
    password: "DemoRoom03!",
    note: "Netflix Demo Room 03",
    profiles: ["Movie A", "Movie B", "Movie C", "Kids"],
  },
  {
    service: "disney",
    email: "disney-room-01@fastmovie.local",
    password: "DisneyRoom01!",
    note: "Disney Demo Room 01",
    profiles: ["Mickey", "Marvel", "Pixar", "Star"],
  },
  {
    service: "disney",
    email: "disney-room-02@fastmovie.local",
    password: "DisneyRoom02!",
    note: "Disney Demo Room 02",
    profiles: ["Slot 1", "Slot 2", "Slot 3", "Kids"],
  },
  {
    service: "youtube",
    email: "youtube-room-01@fastmovie.local",
    password: "YoutubeRoom01!",
    note: "YouTube Demo Room 01",
    profiles: ["Main", "Music", "Family", "Kids"],
  },
  {
    service: "spotify",
    email: "spotify-room-01@fastmovie.local",
    password: "SpotifyRoom01!",
    note: "Spotify Demo Room 01",
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
      AND service = ${room.service}
      AND deleted_at IS NULL
    LIMIT 1
  `;

  const [masterEmail] = existing
    ? await sql`
        UPDATE master_emails
        SET
          package_id = NULL,
          service = ${room.service},
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
          service, email, password_ciphertext, status,
          purchased_at, master_expired_at, note
        )
        VALUES (
          ${room.service},
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

const demoUsers = [
  {
    id: "seed-admin-user",
    googleId: "seed-google-admin-user",
    email: "admin@fastmovie.local",
    name: "Fast Movie Admin",
    image: null,
    points: 2500,
    role: "admin",
    status: "active",
  },
  {
    id: "seed-customer-user",
    googleId: "seed-google-customer-user",
    email: "customer@fastmovie.local",
    name: "Demo Customer",
    image: null,
    points: 850,
    role: "user",
    status: "active",
  },
  {
    id: "seed-suspended-user",
    googleId: "seed-google-suspended-user",
    email: "suspended@fastmovie.local",
    name: "Suspended Customer",
    image: null,
    points: 120,
    role: "user",
    status: "suspended",
  },
];

for (const user of demoUsers) {
  await sql`
    INSERT INTO "User" (
      id, "googleId", email, name, image, points, role, status, "createdAt", "updatedAt"
    )
    VALUES (
      ${user.id},
      ${user.googleId},
      ${user.email},
      ${user.name},
      ${user.image},
      ${user.points},
      ${user.role},
      ${user.status},
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      image = EXCLUDED.image,
      points = EXCLUDED.points,
      role = EXCLUDED.role,
      status = EXCLUDED.status,
      "updatedAt" = NOW()
  `;
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

console.log("Seed completed: catalog + streaming packages + 7 demo rooms + 28 slots + 3 demo users");
await sql.end();
