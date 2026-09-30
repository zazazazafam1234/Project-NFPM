"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  confirmTopupAsAdmin,
  fetchPaymentSupport,
  resyncTopupWithLine,
  type SupportTopup,
  type UnmatchedTransfer,
} from "../lib/api";
import styles from "./page.module.css";
import support from "./support.module.css";

const baht = (cents: number) =>
  `฿${(cents / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const time = (value: string | null) =>
  value ? new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }) : "-";

const STATUS: Record<SupportTopup["status"], string> = {
  pending: "รอชำระ",
  paid: "เติมแล้ว",
  expired: "QR หมดอายุ",
  cancelled: "ยกเลิกแล้ว",
  failed: "ไม่สำเร็จ",
};

// Transfers from the same receiving account around the QR's lifetime, exact amount first.
function candidatesFor(topup: SupportTopup, transfers: UnmatchedTransfer[]) {
  const from = new Date(topup.createdAt).getTime() - 10 * 60 * 1000;
  const until = new Date(topup.expiresAt).getTime() + 48 * 60 * 60 * 1000;
  return transfers
    .filter((transfer) => !topup.paymentAccountId || transfer.paymentAccountId === topup.paymentAccountId)
    .filter((transfer) => {
      const at = new Date(transfer.receivedAt).getTime();
      return at >= from && at <= until;
    })
    .map((transfer) => ({ transfer, exact: transfer.amountCents === topup.payableCents }))
    .sort((a, b) => Number(b.exact) - Number(a.exact));
}

// Admin support for customer payment reports: see the LINE transfers that came in,
// re-sync with LINE, and credit a top-up by hand. The backend locks the top-up and
// the transfer, so a manual confirm and the LINE worker can never both credit it.
export function PaymentSupportPanel({ onDone }: { onDone: (message: string) => void }) {
  const [topups, setTopups] = useState<SupportTopup[]>([]);
  const [transfers, setTransfers] = useState<UnmatchedTransfer[]>([]);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchPaymentSupport(7)
      .then((data) => {
        setTopups(data.topups);
        setTransfers(data.unmatchedTransfers);
      })
      .catch((err) => window.alert(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ"));
  }, []);
  useEffect(() => {
    queueMicrotask(load);
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase().replace(/^#/, "");
    if (!query) return topups;
    return topups.filter((topup) =>
      [topup.reference.replace("#", ""), topup.id, topup.userName, topup.userEmail, (topup.payableCents / 100).toFixed(2)]
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [search, topups]);

  async function act(id: string, action: () => Promise<unknown>, success: string) {
    setBusyId(id);
    try {
      await action();
      onDone(success);
      window.alert(success);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusyId(null);
      load();
    }
  }

  function confirm(topup: SupportTopup, transfer: UnmatchedTransfer | null) {
    const lines = [
      `ยืนยันเติม ${topup.points.toLocaleString()} Point ให้ ${topup.userName} (${topup.reference})?`,
      transfer
        ? `ใช้ยอดโอน ${baht(transfer.amountCents)} จาก ${transfer.senderName ?? "-"} (${time(transfer.receivedAt)})`
        : `ยืนยันโดยไม่มียอดโอนจาก LINE — ตรวจยอด ${baht(topup.payableCents)} ในแอปธนาคารแล้วเท่านั้น`,
      transfer && transfer.amountCents !== topup.payableCents
        ? `⚠ ยอดโอนไม่ตรงกับ QR (${baht(topup.payableCents)})`
        : "",
      "ถ้า LINE ส่งยอดนี้มาทีหลัง ระบบจะผูกกับรายการนี้และไม่เติมซ้ำ",
    ].filter(Boolean);
    if (!window.confirm(lines.join("\n"))) return;
    void act(
      topup.id,
      () => confirmTopupAsAdmin(topup.id, transfer?.id ?? null),
      `เติม ${topup.points.toLocaleString()} Point ให้ ${topup.userName} แล้ว (${topup.reference})`,
    );
  }

  return (
    <>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>PAYMENT SUPPORT</p>
            <h2>ตรวจสอบการชำระ</h2>
            <p className={styles.muted}>
              รายการที่ลูกค้าแจ้งว่าโอนแล้วยังไม่เข้า และ QR ที่รอชำระ · 7 วันล่าสุด · อัปเดตทุก 15 วินาที
            </p>
          </div>
          <div className={styles.panelTools}>
            <input
              className={styles.search}
              placeholder="ค้นหา #รหัส / อีเมล / ยอด"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className={styles.secondary} onClick={load} type="button">
              รีเฟรช
            </button>
          </div>
        </div>

        <div className={support.list}>
          {visible.map((topup) => {
            const candidates = topup.status === "paid" ? [] : candidatesFor(topup, transfers);
            const busy = busyId === topup.id;
            return (
              <article className={support.card} data-status={topup.status} key={topup.id}>
                <header>
                  <div>
                    <code>{topup.reference}</code>
                    <b>{topup.userName}</b>
                    <small>{topup.userEmail}</small>
                  </div>
                  <em className={topup.status === "paid" ? styles.green : topup.status === "pending" ? styles.yellow : ""}>
                    {STATUS[topup.status]}
                    {topup.status === "paid" &&
                      ` · ${topup.confirmedVia === "admin" ? `แอดมิน${topup.confirmedByName ? ` ${topup.confirmedByName}` : ""}` : "LINE อัตโนมัติ"}`}
                  </em>
                </header>
                <dl>
                  <div>
                    <dt>ยอดโอน</dt>
                    <dd>{baht(topup.payableCents)}</dd>
                  </div>
                  <div>
                    <dt>เติม</dt>
                    <dd>{topup.points.toLocaleString()} Point</dd>
                  </div>
                  <div>
                    <dt>บัญชีรับเงิน</dt>
                    <dd>{topup.accountName ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>สร้าง QR / หมดอายุ</dt>
                    <dd>
                      {time(topup.createdAt)} · {time(topup.expiresAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>ลูกค้าแจ้ง</dt>
                    <dd>{topup.checkRequestedAt ? `${topup.checkRequestCount} ครั้ง · ล่าสุด ${time(topup.checkRequestedAt)}` : "-"}</dd>
                  </div>
                  {topup.paidAt && (
                    <div>
                      <dt>เติมเมื่อ</dt>
                      <dd>{time(topup.paidAt)}</dd>
                    </div>
                  )}
                </dl>

                {topup.status !== "paid" && (
                  <>
                    <p className={support.sub}>ยอดโอนจาก LINE ที่ยังไม่ถูกจับคู่ (บัญชีเดียวกัน ช่วงเวลาเดียวกัน)</p>
                    {candidates.length === 0 ? (
                      <p className={styles.emptyInline}>ยังไม่มียอดโอนที่เข้ามาจาก LINE</p>
                    ) : (
                      <ul className={support.transfers}>
                        {candidates.map(({ transfer, exact }) => (
                          <li key={transfer.id} data-exact={exact}>
                            <span>
                              <b>{baht(transfer.amountCents)}</b> {exact ? "✓ ตรงกับ QR" : "ยอดไม่ตรง"} ·{" "}
                              {transfer.senderName ?? "ไม่ทราบผู้โอน"} · {transfer.occurredRaw ?? time(transfer.receivedAt)}
                            </span>
                            <button disabled={busy} onClick={() => confirm(topup, transfer)} type="button">
                              ยืนยันกับยอดนี้
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <footer>
                      {topup.status === "pending" && (
                        <button
                          className={styles.secondary}
                          disabled={busy}
                          onClick={() =>
                            void act(topup.id, () => resyncTopupWithLine(topup.id), "สั่งเช็คกับ LINE แล้ว (ทุก 10 วินาที 5 นาที)")
                          }
                          type="button"
                        >
                          เช็คกับ LINE ตอนนี้
                        </button>
                      )}
                      <button className={styles.dangerButton} disabled={busy} onClick={() => confirm(topup, null)} type="button">
                        เติม Point เอง (ตรวจในแอปธนาคารแล้ว)
                      </button>
                    </footer>
                  </>
                )}
              </article>
            );
          })}
          {visible.length === 0 && <p className={styles.emptyInline}>ไม่มีรายการที่ต้องตรวจสอบ</p>}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>UNMATCHED TRANSFERS</p>
            <h2>ยอดโอนจาก LINE ที่ยังไม่ได้จับคู่</h2>
            <p className={styles.muted}>เงินเข้าแต่หา QR ที่ยอดตรงไม่เจอ (เช่นโอนหลัง QR หมดอายุ หรือโอนยอดผิด)</p>
          </div>
        </div>
        <div className={styles.table}>
          {transfers.map((transfer) => (
            <div key={transfer.id}>
              <b>{baht(transfer.amountCents)}</b>
              <span>
                {transfer.senderName ?? "ไม่ทราบผู้โอน"} · {transfer.fromAccount ?? "-"} · เข้า {transfer.accountName ?? "-"} ·{" "}
                {transfer.occurredRaw ?? time(transfer.receivedAt)}
              </span>
            </div>
          ))}
          {transfers.length === 0 && <p className={styles.emptyInline}>ไม่มียอดค้างจับคู่</p>}
        </div>
      </section>
    </>
  );
}
