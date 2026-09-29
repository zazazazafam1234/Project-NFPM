import sql from "./db";

export const DEFAULT_MIN_TOPUP_POINTS = 10;
export const MAX_TOPUP_POINTS = 100000;

// Smallest top-up a customer may create (1 Point = 1 baht); set by admins.
export async function getMinTopupPoints() {
  const [row] = await sql`SELECT value FROM app_settings WHERE key = 'min_topup_points'`;
  const value = Number(row?.value);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MIN_TOPUP_POINTS;
}

export async function setMinTopupPoints(value: number) {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('min_topup_points', ${sql.json(value)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}
