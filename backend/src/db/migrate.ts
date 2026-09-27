import sql from "../db";

await sql`
  CREATE TABLE IF NOT EXISTS "User" (
    id          TEXT PRIMARY KEY,
    "googleId"  TEXT UNIQUE NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    image       TEXT,
    points      INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Room" (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    label    TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 4
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Plan" (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    price          INTEGER NOT NULL,
    duration       TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Order" (
    id              TEXT PRIMARY KEY,
    "userId"        TEXT REFERENCES "User"(id) ON DELETE SET NULL,
    "roomId"        TEXT NOT NULL REFERENCES "Room"(id),
    "planId"        TEXT NOT NULL REFERENCES "Plan"(id),
    "paymentMethod" TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    "expiresAt"     TIMESTAMPTZ,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Transaction" (
    id          TEXT PRIMARY KEY,
    "userId"    TEXT NOT NULL REFERENCES "User"(id),
    "orderId"   TEXT REFERENCES "Order"(id) ON DELETE SET NULL,
    type        TEXT NOT NULL,
    amount      INTEGER NOT NULL,
    description TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Category" (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    icon        TEXT NOT NULL DEFAULT '📦',
    "sortOrder" INTEGER NOT NULL DEFAULT 0
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Product" (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    badge        TEXT,
    "categoryId" TEXT NOT NULL REFERENCES "Category"(id),
    price        INTEGER NOT NULL,
    stock        INTEGER NOT NULL DEFAULT 0,
    "isActive"   BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

console.log("Migration completed");
await sql.end();
