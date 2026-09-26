"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fetchOrders,
  fetchTransactions,
  type Order,
  type Transaction,
} from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

type Tab = "orders" | "transactions";

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

export default function ProfilePage() {
  const router = useRouter();
  const { user, isLoading, signOut } = useSession();
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/register");
  }, [isLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    setActivityLoading(true);
    Promise.all([
      fetchOrders().then((r) => setOrders(r.orders)).catch(() => undefined),
      fetchTransactions().then((r) => setTransactions(r.transactions)).catch(() => undefined),
    ]).finally(() => setActivityLoading(false));
  }, [user]);

  if (isLoading || !user)
    return <main className={styles.loading}>กำลังโหลดโปรไฟล์…</main>;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <span>F</span> Fast Movie
        </Link>
        <Link href="/" className={styles.back}>
          ← เลือกห้อง
        </Link>
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
          <button onClick={() => void signOut().then(() => router.push("/"))}>
            ออกจากระบบ
          </button>
        </div>

        <div className={styles.wallet}>
          <p className={styles.eyebrow}>FAST POINTS</p>
          <span className={styles.coin}>✦</span>
          <strong>{user.points.toLocaleString()}</strong>
          <small>POINTS AVAILABLE</small>
          <div className={styles.walletRule} />
          <p>ใช้ Point เพื่อเลือกซื้อโปรได้ทันทีในหน้าชำระเงิน</p>
          <Link href="/#rooms">
            ไปเลือกห้อง <b>→</b>
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
                {orders.length > 0 && (
                  <span className={styles.badge}>{orders.length}</span>
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
            orders.length === 0 ? (
              <p className={styles.activityEmpty}>ยังไม่มีคำสั่งซื้อ</p>
            ) : (
              <div className={styles.listWrapper}>
              <ul className={styles.list}>
                {orders.map((o) => {
                  const expiry = formatExpiry(o.expiresAt);
                  return (
                    <li key={o.id} className={styles.item}>
                      <span className={styles.itemIcon} data-status={o.status}>
                        {o.status === "paid" ? "✓" : "⏳"}
                      </span>
                      <div className={styles.itemBody}>
                        <strong>{o.roomName}</strong>
                        <span className={styles.itemSub}>
                          {o.planName} · {o.planDuration}
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
                        <span className={styles.itemDate}>{formatDate(o.createdAt)}</span>
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
                  <span className={styles.itemIcon} data-type={t.type}>
                    {t.type === "topup" ? "↑" : "↓"}
                  </span>
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
