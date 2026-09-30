"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  cancelPointTopUp,
  fetchPointTopUps,
  fetchOrders,
  fetchSubscriptions,
  fetchTransactions,
  type Order,
  type PointTopUp,
  type Subscription,
  type Transaction,
  formatDiscount,
} from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

type Tab = "orders" | "topups" | "transactions";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

function formatExpiry(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const expired = d < now;
  const label = d.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" });
  return { label, expired };
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBaht(value: number) {
  return `฿${value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const topUpStatusLabel: Record<string, string> = {
  pending: "รอชำระ",
  paid: "สำเร็จ",
  expired: "หมดอายุ",
  cancelled: "ยกเลิกแล้ว",
  failed: "ไม่สำเร็จ",
};

export default function ProfilePage() {
  const router = useRouter();
  const { user, isLoading, signOut } = useSession();
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [topUps, setTopUps] = useState<PointTopUp[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [busyTopUpId, setBusyTopUpId] = useState<string | null>(null);
  const [activityError, setActivityError] = useState("");

  useEffect(() => {
    if (!isLoading && !user) router.replace("/register");
  }, [isLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    setActivityLoading(true);
    setActivityError("");
    Promise.all([
      fetchSubscriptions().then((r) => setSubscriptions(r.subscriptions)).catch(() => undefined),
      fetchOrders().then((r) => setOrders(r.orders)).catch(() => undefined),
      fetchTransactions().then((r) => setTransactions(r.transactions)).catch(() => undefined),
      fetchPointTopUps().then((r) => setTopUps(r.topUps)).catch(() => undefined),
    ]).finally(() => setActivityLoading(false));
  }, [user]);

  async function cancelTopUp(topup: PointTopUp) {
    setBusyTopUpId(topup.id);
    setActivityError("");
    try {
      const updated = await cancelPointTopUp(topup.id);
      setTopUps((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : "ยกเลิกรายการไม่สำเร็จ");
    } finally {
      setBusyTopUpId(null);
    }
  }

  if (isLoading || !user)
    return <main className={styles.loading}>กำลังโหลดโปรไฟล์…</main>;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <BrandLogo />
        </Link>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <Link href="/" className={styles.back}>
            เลือกห้อง
          </Link>
        </div>
      </header>
      <section className={styles.content}>
        <div className={styles.profile}>
          <div className={styles.avatar}>
            {user.image ? (
              <img src={user.image} alt="" />
            ) : (
              user.name.slice(0, 1)
            )}
          </div>
          <p className={styles.eyebrow}>YOUR PROFILE</p>
          <h1>{user.name}</h1>
          <p>{user.email}</p>
          {user.role === "admin" && (
            <Link href="/admin" className={styles.adminLink}>
              หลังบ้าน Admin
            </Link>
          )}
          <button onClick={() => void signOut().then(() => router.push("/"))}>
            ออกจากระบบ
          </button>
        </div>

        <div className={styles.wallet}>
          <p className={styles.eyebrow}>FAST POINTS</p>
          <span className={styles.coin}>PT</span>
          <strong>{user.points.toLocaleString()}</strong>
          <small>POINTS AVAILABLE</small>
          <p className={styles.discountBalance}>
            เงินส่วนลดสะสม <b>{formatDiscount(user.discountCents)}</b>
          </p>
          <div className={styles.walletRule} />
          <p>ใช้ Point เพื่อเลือกซื้อโปรได้ทันทีในหน้าชำระเงิน · เงินส่วนลดครบ ฿1 ใช้ลดราคาให้อัตโนมัติ</p>
          <Link href="/payment">
            เติม Point <b>ไปหน้าเติมเงิน</b>
          </Link>
        </div>

        <section className={styles.history}>
          <div className={styles.historyHead}>
            <div>
              <p className={styles.eyebrow}>RECENT ACTIVITY</p>
              <h2>รายการล่าสุด</h2>
            </div>
            <div className={styles.tabs}>
              <button
                className={tab === "orders" ? styles.tabActive : styles.tab}
                type="button"
                onClick={() => setTab("orders")}
              >
                คำสั่งซื้อ
                {orders.length + subscriptions.length > 0 && (
                  <span className={styles.badge}>
                    {orders.length + subscriptions.length}
                  </span>
                )}
              </button>
              <button
                className={tab === "topups" ? styles.tabActive : styles.tab}
                type="button"
                onClick={() => setTab("topups")}
              >
                เติมเงิน
                {topUps.length > 0 && (
                  <span className={styles.badge}>{topUps.length}</span>
                )}
              </button>
              <button
                className={tab === "transactions" ? styles.tabActive : styles.tab}
                type="button"
                onClick={() => setTab("transactions")}
              >
                Point
                {transactions.length > 0 && (
                  <span className={styles.badge}>{transactions.length}</span>
                )}
              </button>
            </div>
          </div>

          {activityLoading ? (
            <p className={styles.activityEmpty}>กำลังโหลด…</p>
          ) : tab === "orders" ? (
            orders.length === 0 && subscriptions.length === 0 ? (
              <p className={styles.activityEmpty}>ยังไม่มีคำสั่งซื้อ</p>
            ) : (
              <div className={styles.listWrapper}>
              <ul className={styles.list}>
                {subscriptions.map((s) => {
                  const expiry = formatExpiry(s.expiresAt);
                  return (
                    <li key={s.id} className={styles.item}>
                      <span className={styles.itemIcon} data-status={s.status} aria-hidden="true" />
                      <div className={styles.itemBody}>
                        <strong>คำสั่งซื้อ {s.packageName}</strong>
                        <span className={styles.itemSub}>
                          <b>Slot:</b> {s.profileName} · <b>บัญชี:</b> {s.masterEmail}
                          {expiry && (
                            <em className={expiry.expired ? styles.expired : styles.active}>
                              {expiry.expired ? " · หมดอายุ " : " · ถึง "}
                              {expiry.label}
                            </em>
                          )}
                        </span>
                      </div>
                      <div className={styles.itemRight}>
                        <strong className={styles.debit}>−{s.pricePaid} Point</strong>
                        <span className={styles.statusPill} data-status={s.status}>
                          {s.status === "active" ? "กำลังใช้งาน" : s.status}
                        </span>
                        <span className={styles.itemDate}>{formatDate(s.createdAt)}</span>
                      </div>
                    </li>
                  );
                })}
                {orders.map((o) => {
                  const expiry = formatExpiry(o.expiresAt);
                  return (
                    <li key={o.id} className={styles.item}>
                      <span className={styles.itemIcon} data-status={o.status} aria-hidden="true" />
                      <div className={styles.itemBody}>
                        <strong>คำสั่งซื้อ {o.roomName}</strong>
                        <span className={styles.itemSub}>
                          <b>แพ็กเกจ:</b> {o.planName} · {o.planDuration}
                          {expiry && (
                            <em className={expiry.expired ? styles.expired : styles.active}>
                              {expiry.expired ? " · หมดอายุ " : " · ถึง "}
                              {expiry.label}
                            </em>
                          )}
                        </span>
                      </div>
                      <div className={styles.itemRight}>
                        <strong className={styles.debit}>−{o.price} Point</strong>
                        <span className={styles.statusPill} data-status={o.status}>
                          {o.status === "paid" ? "ชำระแล้ว" : o.status}
                        </span>
                        <span className={styles.itemDate}>{formatDate(o.createdAt)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              </div>
            )
          ) : tab === "topups" ? (
            topUps.length === 0 ? (
              <p className={styles.activityEmpty}>ยังไม่มีประวัติเติมเงิน</p>
            ) : (
              <div className={styles.listWrapper}>
                {activityError && <p className={styles.activityError}>{activityError}</p>}
                <ul className={styles.list}>
                  {topUps.map((topUp) => {
                    const isPending = topUp.status === "pending";
                    return (
                      <li key={topUp.id} className={styles.item}>
                        <span className={styles.itemIcon} data-status={topUp.status} aria-hidden="true" />
                        <div className={styles.itemBody}>
                          <strong>เติม {topUp.points.toLocaleString()} Point</strong>
                          <span className={styles.itemSub}>
                            <b>ยอดโอน:</b> {formatBaht(topUp.payableAmount)}
                            {topUp.paymentAccountName ? ` · บัญชี ${topUp.paymentAccountName}` : ""}
                          </span>
                          <span className={styles.itemSub}>
                            <b>สร้าง:</b> {formatDateTime(topUp.createdAt)}
                            {isPending ? ` · หมดอายุ ${formatDateTime(topUp.expiresAt)}` : ""}
                            {topUp.paidAt ? ` · ชำระ ${formatDateTime(topUp.paidAt)}` : ""}
                          </span>
                        </div>
                        <div className={styles.itemRight}>
                          <strong className={topUp.status === "paid" ? styles.credit : styles.neutral}>
                            +{topUp.points.toLocaleString()} Point
                          </strong>
                          <span className={styles.statusPill} data-status={topUp.status}>
                            {topUpStatusLabel[topUp.status] ?? topUp.status}
                          </span>
                          {isPending && (
                            <button
                              className={styles.cancelButton}
                              disabled={busyTopUpId === topUp.id}
                              onClick={() => void cancelTopUp(topUp)}
                              type="button"
                            >
                              {busyTopUpId === topUp.id ? "กำลังยกเลิก" : "ยกเลิก QR"}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )
          ) : transactions.length === 0 ? (
            <p className={styles.activityEmpty}>ยังไม่มีรายการ Point</p>
          ) : (
            <div className={styles.listWrapper}>
            <ul className={styles.list}>
              {transactions.map((t) => (
                <li key={t.id} className={styles.item}>
                  <span className={styles.itemIcon} data-type={t.type} aria-hidden="true" />
                  <div className={styles.itemBody}>
                    <strong>{t.description}</strong>
                  </div>
                  <div className={styles.itemRight}>
                    <strong className={t.type === "topup" ? styles.credit : styles.debit}>
                      {t.type === "topup" ? "+" : "−"}{t.amount} Point
                    </strong>
                    <span className={styles.itemDate}>{formatDate(t.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
