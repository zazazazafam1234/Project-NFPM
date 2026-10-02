"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  bahtFromCents,
  fetchMyReseller,
  fetchResellerTop,
  type MyResellerView,
  type ResellerStat,
  type ResellerTopEntry,
} from "../lib/api";
import { useSession } from "../providers";
import profileStyles from "../profile/page.module.css";
import styles from "./page.module.css";

const MEDALS = ["🥇", "🥈", "🥉"];

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-";
}

function Stats({ stat }: { stat: ResellerStat }) {
  return (
    <dl className={styles.stats}>
      <div>
        <dt>ลูกค้าที่ใช้โค้ด</dt>
        <dd>
          {stat.customers}
          {stat.maxUses ? ` / ${stat.maxUses}` : ""} คน
        </dd>
      </div>
      <div>
        <dt>ยอดขาย (ยอดเติม)</dt>
        <dd>฿{bahtFromCents(stat.salesCents)}</dd>
      </div>
      <div>
        <dt>ค่าคอมทั้งหมด</dt>
        <dd>฿{bahtFromCents(stat.commissionEarnedCents)}</dd>
      </div>
      <div>
        <dt>ค่าคอมค้างจ่าย</dt>
        <dd>฿{bahtFromCents(stat.commissionUnpaidCents)}</dd>
      </div>
    </dl>
  );
}

export default function ResellersPage() {
  const { user, isLoading } = useSession();
  const [top, setTop] = useState<ResellerTopEntry[]>([]);
  const [mine, setMine] = useState<MyResellerView | null>(null);

  useEffect(() => {
    fetchResellerTop()
      .then((data) => setTop(data.top))
      .catch(() => setTop([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchMyReseller()
      .then(setMine)
      .catch(() => setMine(null));
  }, [user]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      window.alert("คัดลอกแล้ว");
    } catch {
      window.prompt("คัดลอก", text);
    }
  }

  const reseller = mine?.reseller ?? null;

  return (
    <main className={profileStyles.page}>
      <header className={profileStyles.header}>
        <Link className={profileStyles.brand} href="/">
          <BrandLogo />
        </Link>
        <div className={profileStyles.headerActions}>
          <ThemeToggle />
          <Link href="/profile" className={profileStyles.back}>
            บัญชี
          </Link>
        </div>
      </header>

      <section className={styles.content}>
        <div className={styles.card}>
          <p className={profileStyles.eyebrow}>TOP RESELLERS</p>
          <h1>ตัวแทนจำหน่ายยอดเยี่ยม</h1>
          <ol className={styles.top}>
            {top.map((entry) => (
              <li key={entry.rank}>
                <span className={styles.medal}>{MEDALS[entry.rank - 1]}</span>
                <b>อันดับ {entry.rank}</b>
                <span>
                  {entry.customers.toLocaleString()} ลูกค้า · ยอดขาย ฿{bahtFromCents(entry.salesCents)}
                </span>
              </li>
            ))}
            {top.length === 0 && <li className={styles.empty}>ยังไม่มียอดขาย</li>}
          </ol>
        </div>

        {!isLoading && !user && (
          <div className={styles.card}>
            <p>เข้าสู่ระบบเพื่อดูยอดขายของคุณ หากคุณเป็นตัวแทนจำหน่าย</p>
            <Link href="/register" className={styles.cta}>
              เข้าสู่ระบบ
            </Link>
          </div>
        )}

        {reseller && (
          <div className={styles.card}>
            <p className={profileStyles.eyebrow}>MY SALES</p>
            <h2>ยอดขายของฉัน</h2>
            <div className={styles.codeRow}>
              <code>{reseller.code}</code>
              <button onClick={() => void copy(reseller.code)} type="button">
                คัดลอกโค้ด
              </button>
              {reseller.referralLink && (
                <button onClick={() => void copy(String(reseller.referralLink))} type="button">
                  คัดลอกลิงก์
                </button>
              )}
            </div>
            <p className={styles.note}>
              ลูกค้าได้ส่วนลด {mine?.discountPercent}% · คุณได้ค่าคอม ฿{bahtFromCents(reseller.commissionCents)} ต่อลูกค้า 1 คน
              {reseller.status !== "active" && " · โค้ดถูกปิดอยู่"}
            </p>
            <Stats stat={reseller} />
            <h3>รายการล่าสุด</h3>
            <ul className={styles.uses}>
              {reseller.uses.map((use) => (
                <li key={use.id}>
                  <b>{use.customer}</b>
                  <span>
                    เติม ฿{bahtFromCents(use.baseAmountCents)} · ค่าคอม ฿{bahtFromCents(use.commissionCents)} ·{" "}
                    {formatDate(use.createdAt)}
                  </span>
                  <em data-status={use.status}>
                    {use.status === "pending" ? "รอชำระ" : use.paidOutAt ? "จ่ายแล้ว" : "ค้างจ่าย"}
                  </em>
                </li>
              ))}
              {reseller.uses.length === 0 && <li className={styles.empty}>ยังไม่มีลูกค้าใช้โค้ด</li>}
            </ul>
          </div>
        )}

        {mine?.all && (
          <div className={styles.card}>
            <p className={profileStyles.eyebrow}>ALL RESELLERS</p>
            <h2>ยอดขายตัวแทนทุกคน</h2>
            <ul className={styles.uses}>
              {mine.all.map((stat) => (
                <li key={stat.id}>
                  <b>
                    {stat.userName} · {stat.code}
                  </b>
                  <span>
                    {stat.customers} ลูกค้า · ยอดขาย ฿{bahtFromCents(stat.salesCents)} · ค่าคอม ฿
                    {bahtFromCents(stat.commissionEarnedCents)} (ค้าง ฿{bahtFromCents(stat.commissionUnpaidCents)})
                  </span>
                  <em data-status={stat.status === "active" ? "redeemed" : "pending"}>
                    {stat.status === "active" ? "เปิด" : "ปิด"}
                  </em>
                </li>
              ))}
              {mine.all.length === 0 && <li className={styles.empty}>ยังไม่มีตัวแทนจำหน่าย</li>}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
