"use client";

import { useEffect, useState } from "react";
import {
  fetchAdminReport,
  type AdminReport,
  type ReportRange,
  type ReportTotals,
} from "../lib/api";
import styles from "./dashboard.module.css";

const RANGES: Array<[ReportRange, string]> = [
  ["day", "รายวัน"],
  ["week", "7 วัน"],
  ["month", "30 วัน"],
  ["year", "รายปี"],
];

const PREVIOUS_LABEL: Record<ReportRange, string> = {
  day: "เทียบเมื่อวาน",
  week: "เทียบ 7 วันก่อนหน้า",
  month: "เทียบ 30 วันก่อนหน้า",
  year: "เทียบปีก่อนหน้า",
};

function bangkokToday() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function localDate(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatNumber(value: number) {
  return value.toLocaleString("th-TH");
}

function formatBaht(cents: number) {
  return `฿${(cents / 100).toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
}

function bucketLabel(bucket: string, unit: AdminReport["unit"]) {
  if (unit === "hour") return bucket.slice(11, 16);
  const date = localDate(bucket);
  if (unit === "day") return date.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  return date.toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
}

function periodLabel(report: AdminReport) {
  const last = localDate(report.to);
  last.setDate(last.getDate() - 1);
  const format = (date: Date) =>
    date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
  if (report.range === "day") return format(localDate(report.from));
  return `${format(localDate(report.from))} – ${format(last)}`;
}

function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <span className={styles.deltaFlat}>— ไม่มีข้อมูลเทียบ</span>;
  if (previous === 0) return <span className={styles.deltaUp}>▲ ใหม่</span>;
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return <span className={styles.deltaFlat}>● เท่าเดิม</span>;
  const text = `${Math.abs(change).toLocaleString("th-TH", { maximumFractionDigits: 0 })}%`;
  return change > 0
    ? <span className={styles.deltaUp}>▲ {text}</span>
    : <span className={styles.deltaDown}>▼ {text}</span>;
}

function Kpi({
  label,
  value,
  current,
  previous,
  note,
}: {
  label: string;
  value: string;
  current: number;
  previous: number;
  note?: string;
}) {
  return (
    <article className={styles.kpi}>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>
        <Delta current={current} previous={previous} />
        {note ? <em>{note}</em> : null}
      </small>
    </article>
  );
}

// Rounds the axis top up to an even step × 10ⁿ so the midline label is a whole number.
function niceMax(value: number) {
  if (value <= 0) return 0;
  if (value <= 2) return 2;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [2, 4, 6, 8, 10].find((m) => m * magnitude >= value) ?? 10;
  return step * magnitude;
}

function BarChart({
  title,
  series,
  unit,
  format,
}: {
  title: string;
  series: Array<{ bucket: string; value: number }>;
  unit: AdminReport["unit"];
  format: (value: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...series.map((point) => point.value), 0));
  const labelEvery = series.length > 20 ? Math.ceil(series.length / 8) : series.length > 7 ? 3 : 1;
  const total = series.reduce((sum, point) => sum + point.value, 0);
  const hovered = active === null ? null : series[active];

  return (
    <section className={styles.chartCard}>
      <div className={styles.chartHead}>
        <h3>{title}</h3>
        <span>{hovered ? `${bucketLabel(hovered.bucket, unit)} · ${format(hovered.value)}` : `รวม ${format(total)}`}</span>
      </div>
      <div className={styles.chart} onMouseLeave={() => setActive(null)}>
        <div className={styles.gridLines} aria-hidden="true">
          <span style={{ bottom: "100%" }}>{max > 0 ? format(max) : ""}</span>
          <span style={{ bottom: "50%" }}>{max > 0 ? format(max / 2) : ""}</span>
          <span style={{ bottom: 0 }}>0</span>
        </div>
        <div className={styles.bars} role="list" aria-label={title}>
          {series.map((point, index) => (
            <button
              className={`${styles.barSlot} ${active === index ? styles.barActive : ""}`}
              key={point.bucket}
              type="button"
              role="listitem"
              aria-label={`${bucketLabel(point.bucket, unit)}: ${format(point.value)}`}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              <i style={{ height: max > 0 ? `${(point.value / max) * 100}%` : 0 }} />
            </button>
          ))}
        </div>
      </div>
      <div className={styles.axis} aria-hidden="true">
        {series.map((point, index) => (
          <span key={point.bucket}>{index % labelEvery === 0 ? bucketLabel(point.bucket, unit) : ""}</span>
        ))}
      </div>
    </section>
  );
}

function SnapshotItem({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "bad" | "info";
  hint: string;
}) {
  const icon = { ok: "✓", warn: "!", bad: "✕", info: "i" }[tone];
  return (
    <div className={`${styles.snapshotItem} ${styles[tone]}`}>
      <span aria-hidden="true">{icon}</span>
      <div>
        <b>{formatNumber(value)}</b>
        <p>{label}</p>
        <small>{hint}</small>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [range, setRange] = useState<ReportRange>("day");
  const [date, setDate] = useState(bangkokToday);
  const [report, setReport] = useState<AdminReport | null>(null);
  const [error, setError] = useState("");
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAdminReport(range, date)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setError("");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "โหลดรายงานไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [range, date]);

  const isStale = report !== null && (report.range !== range || report.date !== date);
  const t = report?.totals;
  const p = report?.previous;
  const conversion = (totals: ReportTotals) => (totals.visitors > 0 ? (totals.buyers / totals.visitors) * 100 : 0);
  const maxPackageCount = Math.max(...(report?.topPackages.map((pkg) => pkg.count) ?? [0]), 1);

  return (
    <div className={styles.dashboard}>
      <div className={styles.filters}>
        <div className={styles.rangeTabs} role="tablist" aria-label="ช่วงเวลา">
          {RANGES.map(([key, label]) => (
            <button
              aria-selected={range === key}
              className={range === key ? styles.activeRange : ""}
              key={key}
              role="tab"
              type="button"
              onClick={() => setRange(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className={styles.dateField}>
          {range === "day" ? "วันที่" : "ถึงวันที่"}
          <input
            type="date"
            value={date}
            max={bangkokToday()}
            onChange={(event) => event.target.value && setDate(event.target.value)}
          />
        </label>
        <span className={styles.period}>
          {report ? periodLabel(report) : "กำลังโหลด…"}
          {isStale ? " · กำลังอัปเดต…" : ""}
        </span>
      </div>

      {error && <p className={styles.error}>! {error}</p>}

      {t && p && report && (
        <>
          <div className={styles.kpis}>
            <Kpi label="ผู้เข้าชม (คน)" value={formatNumber(t.visitors)} current={t.visitors} previous={p.visitors} />
            <Kpi label="การเปิดหน้าเว็บ" value={formatNumber(t.pageViews)} current={t.pageViews} previous={p.pageViews} />
            <Kpi label="สมัครสมาชิกใหม่" value={formatNumber(t.newUsers)} current={t.newUsers} previous={p.newUsers} />
            <Kpi
              label="คำสั่งซื้อ"
              value={formatNumber(t.purchases)}
              current={t.purchases}
              previous={p.purchases}
              note={t.renewals > 0 ? `ต่ออายุ ${formatNumber(t.renewals)}` : undefined}
            />
            <Kpi label="Point ที่ใช้ซื้อ" value={formatNumber(t.pointsSpent)} current={t.pointsSpent} previous={p.pointsSpent} />
            <Kpi
              label="ยอดเติมเงิน"
              value={formatBaht(t.topupCents)}
              current={t.topupCents}
              previous={p.topupCents}
              note={`${formatNumber(t.topups)} รายการ`}
            />
            <Kpi label="ลูกค้าที่ซื้อ" value={formatNumber(t.buyers)} current={t.buyers} previous={p.buyers} />
            <Kpi
              label="อัตราผู้เข้าชมที่ซื้อ"
              value={`${conversion(t).toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`}
              current={conversion(t)}
              previous={conversion(p)}
            />
          </div>
          <p className={styles.compareNote}>{PREVIOUS_LABEL[report.range]}</p>

          <div className={styles.charts}>
            <BarChart
              title="ผู้เข้าชม"
              unit={report.unit}
              format={(value) => formatNumber(Math.round(value))}
              series={report.series.map((row) => ({ bucket: row.bucket, value: row.visitors }))}
            />
            <BarChart
              title="คำสั่งซื้อ"
              unit={report.unit}
              format={(value) => formatNumber(Math.round(value))}
              series={report.series.map((row) => ({ bucket: row.bucket, value: row.purchases }))}
            />
            <BarChart
              title="ยอดเติมเงิน (บาท)"
              unit={report.unit}
              format={formatBaht}
              series={report.series.map((row) => ({ bucket: row.bucket, value: row.topupCents }))}
            />
          </div>
          <button className={styles.tableToggle} type="button" onClick={() => setShowTable((value) => !value)}>
            {showTable ? "ซ่อนตารางข้อมูล" : "ดูข้อมูลกราฟเป็นตาราง"}
          </button>
          {showTable && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>ช่วงเวลา</th>
                    <th>ผู้เข้าชม</th>
                    <th>คำสั่งซื้อ</th>
                    <th>Point ที่ใช้</th>
                    <th>ยอดเติมเงิน</th>
                  </tr>
                </thead>
                <tbody>
                  {report.series.map((row) => (
                    <tr key={row.bucket}>
                      <td>{bucketLabel(row.bucket, report.unit)}</td>
                      <td>{formatNumber(row.visitors)}</td>
                      <td>{formatNumber(row.purchases)}</td>
                      <td>{formatNumber(row.pointsSpent)}</td>
                      <td>{formatBaht(row.topupCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className={styles.split}>
            <section className={styles.card}>
              <h3>แพ็กเกจขายดี</h3>
              {report.topPackages.length === 0 ? (
                <p className={styles.empty}>ยังไม่มีการซื้อในช่วงนี้</p>
              ) : (
                <ul className={styles.rankList}>
                  {report.topPackages.map((pkg) => (
                    <li key={`${pkg.service}-${pkg.name}`}>
                      <div>
                        <b>{pkg.name}</b>
                        <span>
                          {formatNumber(pkg.count)} ครั้ง · {formatNumber(pkg.points)} Point
                        </span>
                      </div>
                      <i style={{ width: `${(pkg.count / maxPackageCount) * 100}%` }} aria-hidden="true" />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className={styles.card}>
              <h3>หน้าที่คนเข้าบ่อย</h3>
              {report.topPages.length === 0 ? (
                <p className={styles.empty}>ยังไม่มีข้อมูลผู้เข้าชมในช่วงนี้</p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>หน้า</th>
                      <th>เปิดดู</th>
                      <th>คน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topPages.map((page) => (
                      <tr key={page.path}>
                        <td className={styles.path}>{page.path}</td>
                        <td>{formatNumber(page.views)}</td>
                        <td>{formatNumber(page.visitors)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <section className={styles.card}>
            <h3>รายการซื้อ ({formatNumber(t.purchases)})</h3>
            {report.recentPurchases.length === 0 ? (
              <p className={styles.empty}>ยังไม่มีการซื้อในช่วงนี้</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>เวลา</th>
                      <th>ลูกค้า</th>
                      <th>แพ็กเกจ</th>
                      <th>โปรไฟล์</th>
                      <th>Point</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.recentPurchases.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.createdAt)}</td>
                        <td>
                          <b>{row.userName}</b>
                          <small>{row.userEmail}</small>
                        </td>
                        <td>
                          {row.packageName}
                          {row.isRenewal && <em className={styles.badge}>ต่ออายุ</em>}
                        </td>
                        <td>{row.profileName}</td>
                        <td>{formatNumber(row.points)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {t.purchases > report.recentPurchases.length && (
              <p className={styles.more}>แสดง {report.recentPurchases.length} รายการล่าสุด</p>
            )}
          </section>

          <div className={styles.split}>
            <section className={styles.card}>
              <h3>การเติม Point ({formatNumber(t.topups)})</h3>
              {report.recentTopups.length === 0 ? (
                <p className={styles.empty}>ยังไม่มีการเติม Point ในช่วงนี้</p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>เวลา</th>
                      <th>ลูกค้า</th>
                      <th>ยอด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.recentTopups.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.paidAt)}</td>
                        <td>
                          <b>{row.userName}</b>
                          <small>{row.userEmail}</small>
                        </td>
                        <td>
                          {formatBaht(row.amountCents)}
                          <small>{formatNumber(row.points)} Point</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className={styles.card}>
              <h3>สถานะตอนนี้</h3>
              <div className={styles.snapshot}>
                <SnapshotItem
                  label="กำลังเช่าอยู่"
                  value={report.snapshot.activeSubscriptions}
                  tone="info"
                  hint="subscription ที่ยังไม่หมดอายุ"
                />
                <SnapshotItem
                  label="Slot ว่างพร้อมขาย"
                  value={report.snapshot.availableSlots}
                  tone={report.snapshot.availableSlots === 0 ? "bad" : report.snapshot.availableSlots < 5 ? "warn" : "ok"}
                  hint={report.snapshot.availableSlots === 0 ? "สต็อกหมด ควรเพิ่ม Slot" : "stock หน้าร้าน"}
                />
                <SnapshotItem
                  label="ลูกค้าหมดอายุใน 24 ชม."
                  value={report.snapshot.expiringIn24h}
                  tone={report.snapshot.expiringIn24h > 0 ? "warn" : "ok"}
                  hint="โอกาสชวนต่ออายุ"
                />
                <SnapshotItem
                  label="Email แม่หมดอายุใน 7 วัน"
                  value={report.snapshot.mastersExpiringIn7d}
                  tone={report.snapshot.mastersExpiringIn7d > 0 ? "warn" : "ok"}
                  hint="ต้องต่ออายุบัญชีแม่"
                />
                {report.snapshot.pinRotationFailed > 0 && (
                  <SnapshotItem
                    label="เปลี่ยน PIN อัตโนมัติไม่สำเร็จ"
                    value={report.snapshot.pinRotationFailed}
                    tone="bad"
                    hint="Slot ถูกพักไว้ (reserved) รอแอดมินเปลี่ยน PIN เอง"
                  />
                )}
                <SnapshotItem
                  label="รอชำระเงิน"
                  value={report.snapshot.pendingTopups}
                  tone="info"
                  hint="รายการเติม Point ที่ยังไม่จ่าย"
                />
                <SnapshotItem
                  label="Point คงเหลือในระบบ"
                  value={report.snapshot.outstandingPoints}
                  tone="info"
                  hint={`จากผู้ใช้ทั้งหมด ${formatNumber(report.snapshot.totalUsers)} คน`}
                />
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
