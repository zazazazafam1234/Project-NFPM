import { randomInt } from "node:crypto";
import { Hono } from "hono";
import sql from "../db";

/**
 * Decoy rooms (ห้องหลอก): full-looking rooms shown on the storefront only.
 * Stored in decoy_rooms/decoy_slots, never in master_emails/profiles, so they
 * cannot be bought and do not affect stock, reports or real accounts.
 */
const decoys = new Hono();

const NAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// Same shape as profiles created by NetflixProfileCreator, e.g. "n4v7wi".
function decoyProfileName() {
  return `n${Array.from({ length: 5 }, () => NAME_ALPHABET[randomInt(NAME_ALPHABET.length)]).join("")}`;
}

decoys.get("/decoys", async (c) => {
  const rooms = await sql`
    SELECT r.id, r.service, r.expires_at AS "expiresAt", r.created_at AS "createdAt",
      COALESCE(json_agg(s.name ORDER BY s.position) FILTER (WHERE s.id IS NOT NULL), '[]') AS slots
    FROM decoy_rooms r
    LEFT JOIN decoy_slots s ON s.room_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC, r.expires_at
  `;
  return c.json({ rooms });
});

decoys.post("/decoys/generate", async (c) => {
  const body = await c.req.json<{ rooms?: number; slotsPerRoom?: number; service?: string; replace?: boolean }>();
  const roomCount = Number(body.rooms);
  const slotsPerRoom = Number(body.slotsPerRoom ?? 5);
  const service = (body.service ?? "netflix").trim().toLowerCase();
  if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 50) {
    return c.json({ message: "จำนวนบัญชีแม่ต้องเป็น 1-50" }, 400);
  }
  if (!Number.isInteger(slotsPerRoom) || slotsPerRoom < 1 || slotsPerRoom > 10) {
    return c.json({ message: "จำนวน Slot ต่อห้องต้องเป็น 1-10" }, 400);
  }
  if (!service) return c.json({ message: "กรุณาระบุ service" }, 400);

  await sql.begin(async (db) => {
    if (body.replace) await db`DELETE FROM decoy_rooms`;
    for (let i = 0; i < roomCount; i += 1) {
      // Expiry 15-120 days ahead, end of a Bangkok day, like real master accounts.
      const days = randomInt(15, 121);
      const [room] = await db`
        INSERT INTO decoy_rooms (service, expires_at)
        VALUES (
          ${service},
          (date_trunc('day', (NOW() AT TIME ZONE 'Asia/Bangkok') + make_interval(days => ${days}))
            + INTERVAL '1 day' - INTERVAL '1 millisecond') AT TIME ZONE 'Asia/Bangkok'
        )
        RETURNING id
      `;
      const names = new Set<string>();
      while (names.size < slotsPerRoom) names.add(decoyProfileName());
      await db`
        INSERT INTO decoy_slots ${db([...names].map((name, position) => ({ room_id: room.id, name, position })))}
      `;
    }
  });
  return c.json({ ok: true, rooms: roomCount, slots: roomCount * slotsPerRoom }, 201);
});

decoys.delete("/decoys/:id", async (c) => {
  const [room] = await sql`DELETE FROM decoy_rooms WHERE id = ${c.req.param("id")}::uuid RETURNING id`;
  if (!room) return c.json({ message: "ไม่พบห้องหลอกนี้" }, 404);
  return c.json({ ok: true });
});

decoys.delete("/decoys", async (c) => {
  const removed = await sql`DELETE FROM decoy_rooms RETURNING id`;
  return c.json({ ok: true, removed: removed.length });
});

export default decoys;
