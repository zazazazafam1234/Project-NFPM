"use client";

import { useCallback, useEffect, useState } from "react";
import { cancelTopup, fetchPendingTopups, type PendingTopup } from "../lib/api";
import styles from "./page.module.css";

const baht = (cents: number) =>
  (cents / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const time = (value: string) =>
  new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" });

// Customers' unpaid QRs; cancelling one lets the customer start a new top-up
// (and reuse a streamer code) right away.
export function PendingTopupsPanel({ onDone }: { onDone: (message: string) => void }) {
  const [topups, setTopups] = useState<PendingTopup[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchPendingTopups()
      .then((data) => setTopups(data.topups))
      .catch((err) => window.alert(err instanceof Error ? err.message : "โหลดรายการเติมเงินไม่สำเร็จ"));
  }, []);
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function cancel(topup: PendingTopup) {
    const ok = window.confirm(
      `ยกเลิกรายการเติม ${topup.points.toLocaleString()} Point (฿${baht(topup.payableCents)}) ของ ${topup.userName}?\n` +
        "ถ้าลูกค้าโอนเงินตาม QR นี้หลังยกเลิก ระบบจะไม่เติม Point ให้อัตโนมัติ",
    );
    if (!ok) return;
    setBusyId(topup.id);
    try {
      await cancelTopup(topup.id);
      const message = `ยกเลิกรายการเติมเงินของ ${topup.userName} แล้ว`;
      onDone(message);
      window.alert(message);
      load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>PENDING TOP-UPS</p>
          <h2>รายการเติมเงินรอชำระ</h2>
          <p className={styles.muted}>QR ที่ลูกค้าสร้างแล้วยังไม่ได้โอน · ยกเลิกเพื่อให้ลูกค้าสร้างรายการใหม่ได้ทันที</p>
        </div>
        <div className={styles.panelTools}>
          <button className={styles.secondary} onClick={load} type="button">
            รีเฟรช
          </button>
        </div>
      </div>
      <div className={styles.table}>
        {topups.map((topup) => (
          <div key={topup.id}>
            <b>{topup.userName}</b>
            <span>
              {topup.userEmail} · เติม {topup.points.toLocaleString()} Point · โอน ฿{baht(topup.payableCents)}
              {topup.discountCents > 0 ? ` (ลด ฿${baht(topup.discountCents)})` : ""}
              {topup.streamerCode ? ` · โค้ด ${topup.streamerCode} (${topup.streamerName})` : ""} · สร้าง{" "}
              {time(topup.createdAt)} · หมดอายุ {time(topup.expiresAt)}
            </span>
            <button
              className={styles.danger}
              disabled={busyId === topup.id}
              onClick={() => void cancel(topup)}
              type="button"
            >
              {busyId === topup.id ? "กำลังยกเลิก…" : "ยกเลิก"}
            </button>
          </div>
        ))}
        {topups.length === 0 && <p className={styles.emptyInline}>ไม่มีรายการรอชำระ</p>}
      </div>
    </section>
  );
}
