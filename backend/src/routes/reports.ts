import { Hono } from "hono";
import sql from "../db";

const reports = new Hono();

type Range = "day" | "week" | "month" | "year";

const RANGES: Record<Range, { unit: "hour" | "day" | "month"; step: string }> = {
  day: { unit: "hour", step: "1 hour" },
  week: { unit: "day", step: "1 day" },
  month: { unit: "day", step: "1 day" },
  year: { unit: "month", step: "1 month" },
};

// All report periods are calendar periods in Bangkok time, expressed as local
// "YYYY-MM-DD" bounds [from, to) and converted to timestamptz inside SQL.
function shiftDate(date: string, days = 0, months = 0) {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + months, d + days));
  return shifted.toISOString().slice(0, 10);
}

function bangkokToday() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function periodBounds(range: Range, date: string) {
  switch (range) {
    case "day":
      return { from: date, to: shiftDate(date, 1), prevFrom: shiftDate(date, -1) };
    case "week":
      return { from: shiftDate(date, -6), to: shiftDate(date, 1), prevFrom: shiftDate(date, -13) };
    case "month":
      return { from: shiftDate(date, -29), to: shiftDate(date, 1), prevFrom: shiftDate(date, -59) };
    case "year": {
      const monthStart = `${date.slice(0, 7)}-01`;
      return {
        from: shiftDate(monthStart, 0, -11),
        to: shiftDate(monthStart, 0, 1),
        prevFrom: shiftDate(monthStart, 0, -23),
      };
    }
  }
}

async function periodTotals(from: string, to: string) {
  const [row] = await sql`
    WITH b AS (
      SELECT
        (${from}::timestamp AT TIME ZONE 'Asia/Bangkok') AS f,
        (${to}::timestamp AT TIME ZONE 'Asia/Bangkok') AS t
    )
    SELECT
      (SELECT COUNT(DISTINCT visitor_id) FROM page_views, b
        WHERE created_at >= b.f AND created_at < b.t AND path NOT LIKE '/admin%')::int AS visitors,
      (SELECT COUNT(*) FROM page_views, b
        WHERE created_at >= b.f AND created_at < b.t AND path NOT LIKE '/admin%')::int AS "pageViews",
      (SELECT COUNT(*) FROM "User", b
        WHERE "createdAt" >= b.f AND "createdAt" < b.t)::int AS "newUsers",
      (SELECT COUNT(*) FROM subscriptions, b
        WHERE created_at >= b.f AND created_at < b.t)::int AS purchases,
      (SELECT COUNT(*) FROM subscriptions, b
        WHERE created_at >= b.f AND created_at < b.t AND parent_subscription_id IS NOT NULL)::int AS renewals,
      (SELECT COUNT(DISTINCT user_id) FROM subscriptions, b
        WHERE created_at >= b.f AND created_at < b.t)::int AS buyers,
      (SELECT COALESCE(SUM(price_paid), 0) FROM subscriptions, b
        WHERE created_at >= b.f AND created_at < b.t)::int AS "pointsSpent",
      (SELECT COUNT(*) FROM point_topups, b
        WHERE status = 'paid' AND paid_at >= b.f AND paid_at < b.t)::int AS topups,
      (SELECT COALESCE(SUM(COALESCE(matched_amount_cents, payable_amount_cents)), 0) FROM point_topups, b
        WHERE status = 'paid' AND paid_at >= b.f AND paid_at < b.t)::bigint AS "topupCents"
  `;
  return { ...row, topupCents: Number(row.topupCents) };
}

reports.get("/", async (c) => {
  const rangeParam = c.req.query("range") ?? "day";
  const range: Range = rangeParam in RANGES ? (rangeParam as Range) : "day";
  const dateParam = c.req.query("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : bangkokToday();
  const { unit, step } = RANGES[range];
  const { from, to, prevFrom } = periodBounds(range, date);

  const [totals, previous] = await Promise.all([periodTotals(from, to), periodTotals(prevFrom, from)]);

  const series = await sql`
    WITH buckets AS (
      SELECT
        bucket,
        (bucket AT TIME ZONE 'Asia/Bangkok') AS f,
        ((bucket + ${step}::interval) AT TIME ZONE 'Asia/Bangkok') AS t
      FROM generate_series(
        ${from}::timestamp,
        ${to}::timestamp - ${step}::interval,
        ${step}::interval
      ) AS bucket
    )
    SELECT
      to_char(bucket, 'YYYY-MM-DD"T"HH24:MI') AS bucket,
      (SELECT COUNT(DISTINCT visitor_id) FROM page_views
        WHERE created_at >= buckets.f AND created_at < buckets.t AND path NOT LIKE '/admin%')::int AS visitors,
      (SELECT COUNT(*) FROM subscriptions
        WHERE created_at >= buckets.f AND created_at < buckets.t)::int AS purchases,
      (SELECT COALESCE(SUM(price_paid), 0) FROM subscriptions
        WHERE created_at >= buckets.f AND created_at < buckets.t)::int AS "pointsSpent",
      (SELECT COALESCE(SUM(COALESCE(matched_amount_cents, payable_amount_cents)), 0) FROM point_topups
        WHERE status = 'paid' AND paid_at >= buckets.f AND paid_at < buckets.t)::int AS "topupCents"
    FROM buckets
    ORDER BY buckets.bucket
  `;

  const inPeriod = (column: string) => sql`
    ${sql(column)} >= (${from}::timestamp AT TIME ZONE 'Asia/Bangkok')
    AND ${sql(column)} < (${to}::timestamp AT TIME ZONE 'Asia/Bangkok')
  `;

  const [topPackages, topPages, recentPurchases, recentTopups, [snapshot]] = await Promise.all([
    sql`
      SELECT pkg.name, pkg.service, COUNT(*)::int AS count, COALESCE(SUM(s.price_paid), 0)::int AS points
      FROM subscriptions s
      JOIN packages pkg ON pkg.id = s.package_id
      WHERE ${inPeriod("s.created_at")}
      GROUP BY pkg.id, pkg.name, pkg.service
      ORDER BY count DESC, points DESC
      LIMIT 8
    `,
    sql`
      SELECT path, COUNT(*)::int AS views, COUNT(DISTINCT visitor_id)::int AS visitors
      FROM page_views
      WHERE ${inPeriod("created_at")} AND path NOT LIKE '/admin%'
      GROUP BY path
      ORDER BY views DESC
      LIMIT 8
    `,
    sql`
      SELECT
        s.id, s.created_at AS "createdAt", s.price_paid AS points,
        (s.parent_subscription_id IS NOT NULL) AS "isRenewal",
        u.name AS "userName", u.email AS "userEmail",
        pkg.name AS "packageName", pkg.service, p.profile_name AS "profileName"
      FROM subscriptions s
      JOIN "User" u ON u.id = s.user_id
      JOIN packages pkg ON pkg.id = s.package_id
      JOIN profiles p ON p.id = s.profile_id
      WHERE ${inPeriod("s.created_at")}
      ORDER BY s.created_at DESC
      LIMIT 20
    `,
    sql`
      SELECT
        t.id, t.paid_at AS "paidAt", t.points,
        COALESCE(t.matched_amount_cents, t.payable_amount_cents)::int AS "amountCents",
        u.name AS "userName", u.email AS "userEmail"
      FROM point_topups t
      JOIN "User" u ON u.id = t.user_id
      WHERE t.status = 'paid'
        AND ${inPeriod("t.paid_at")}
      ORDER BY t.paid_at DESC
      LIMIT 10
    `,
    sql`
      SELECT
        (SELECT COUNT(*) FROM subscriptions
          WHERE status = 'active' AND expires_at > NOW())::int AS "activeSubscriptions",
        (SELECT COUNT(*) FROM subscriptions
          WHERE status = 'active' AND expires_at > NOW() AND expires_at <= NOW() + INTERVAL '24 hours')::int AS "expiringIn24h",
        (SELECT COUNT(*) FROM profiles p
          JOIN master_emails me ON me.id = p.master_email_id
          WHERE p.deleted_at IS NULL AND me.deleted_at IS NULL
            AND me.status = 'active' AND me.master_expired_at > NOW()
            AND (p.status = 'available' OR (p.status = 'rented' AND p.profile_expires_at <= NOW()))
            AND NOT EXISTS (
              SELECT 1 FROM subscriptions s
              WHERE s.profile_id = p.id AND s.status IN ('pending', 'active') AND s.expires_at > NOW()
            ))::int AS "availableSlots",
        (SELECT COUNT(*) FROM master_emails
          WHERE deleted_at IS NULL AND status = 'active'
            AND master_expired_at > NOW() AND master_expired_at <= NOW() + INTERVAL '7 days')::int AS "mastersExpiringIn7d",
        (SELECT COUNT(*) FROM point_topups
          WHERE status = 'pending' AND expires_at > NOW())::int AS "pendingTopups",
        (SELECT COUNT(*) FROM "User")::int AS "totalUsers",
        (SELECT COALESCE(SUM(points), 0) FROM "User")::int AS "outstandingPoints"
    `,
  ]);

  return c.json({
    range,
    date,
    from,
    to,
    unit,
    totals,
    previous,
    series,
    topPackages,
    topPages,
    recentPurchases,
    recentTopups,
    snapshot,
  });
});

export default reports;
