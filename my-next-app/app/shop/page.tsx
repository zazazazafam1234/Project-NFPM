"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { fetchPackages, type StreamingPackage } from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

export default function ShopPage() {
  const { user } = useSession();
  const [packages, setPackages] = useState<StreamingPackage[]>([]);
  const [service, setService] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPackages()
      .then(setPackages)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const services = Array.from(new Set(packages.map((pkg) => pkg.service)));
  const visiblePackages = service
    ? packages.filter((pkg) => pkg.service === service)
    : packages;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <BrandLogo />
        </Link>
        <nav className={styles.navLinks}>
          <Link href="/">หน้าแรก</Link>
          <Link href="/shop" aria-current="page">
            ร้านค้า
          </Link>
          <Link href="/profile">บัญชี</Link>
        </nav>
        <Link className={styles.mobileLogin} href="/register">
          เข้าสู่ระบบ
        </Link>
        <div className={styles.pointsBadge}>
          <span>✦</span>
          {user ? user.points.toLocaleString() : "—"}
          <small>PT</small>
        </div>
      </header>

      <div className={styles.hero}>
        <p className={styles.eyebrow}>FAST MOVIE STORE</p>
        <h1>เลือกแพ็กเกจสตรีมมิ่ง</h1>
        <p>Stock คำนวณจาก Profile ที่ว่างและ Email แม่ที่ยัง Active</p>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <p className={styles.sideLabel}>บริการ</p>
          <ul className={styles.catList}>
            <li>
              <button
                className={!service ? styles.catActive : styles.catBtn}
                type="button"
                onClick={() => setService(null)}
              >
                <span>▦</span>
                <span>ทั้งหมด</span>
                <small>{packages.length}</small>
              </button>
            </li>
            {services.map((item) => (
              <li key={item}>
                <button
                  className={service === item ? styles.catActive : styles.catBtn}
                  type="button"
                  onClick={() => setService(item)}
                >
                  <span>N</span>
                  <span>{item.toUpperCase()}</span>
                  <small>{packages.filter((pkg) => pkg.service === item).length}</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className={styles.main}>
          <div className={styles.gridHeader}>
            <h2>{service ? service.toUpperCase() : "แพ็กเกจทั้งหมด"}</h2>
            <span className={styles.count}>{visiblePackages.length} รายการ</span>
          </div>

          {loading ? (
            <div className={styles.skeleton}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={styles.skeletonCard} />
              ))}
            </div>
          ) : visiblePackages.length === 0 ? (
            <p className={styles.empty}>ยังไม่มีแพ็กเกจในบริการนี้</p>
          ) : (
            <div className={styles.grid}>
              {visiblePackages.map((pkg) => (
                <article key={pkg.id} className={styles.card}>
                  <span className={styles.badge}>
                    {pkg.availableStock > 0 ? "พร้อมเช่า" : "หมดสต็อก"}
                  </span>

                  <div className={styles.cardIcon}>N</div>

                  <div className={styles.cardBody}>
                    <p className={styles.cardCat}>{pkg.service.toUpperCase()}</p>
                    <h3>{pkg.name}</h3>
                    <p className={styles.cardDesc}>
                      ใช้งาน {pkg.durationDays} วัน · เหลือ {pkg.availableStock} profile
                    </p>
                  </div>

                  <div className={styles.cardFooter}>
                    <div className={styles.stockRow}>
                      <span
                        className={
                          pkg.availableStock === 0
                            ? styles.stockOut
                            : pkg.availableStock <= 3
                              ? styles.stockLow
                              : styles.stockOk
                        }
                      >
                        {pkg.availableStock === 0
                          ? "หมดสต็อก"
                          : `เหลือ ${pkg.availableStock} ที่`}
                      </span>
                    </div>

                    <div className={styles.priceRow}>
                      <strong>
                        <span className={styles.coin}>✦</span>
                        {pkg.priceAmount.toLocaleString()}
                      </strong>
                      <small>/ {pkg.durationDays} วัน</small>
                    </div>

                    {pkg.availableStock === 0 ? (
                      <button className={styles.btnSoldOut} disabled>
                        หมดสต็อก
                      </button>
                    ) : (
                      <Link
                        href={user ? `/checkout?package=${pkg.slug}` : "/register"}
                        className={styles.btnBuy}
                      >
                        {user ? "สั่งซื้อเลย" : "เข้าสู่ระบบเพื่อซื้อ"} →
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
