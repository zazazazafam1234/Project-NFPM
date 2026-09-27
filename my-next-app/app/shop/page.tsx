"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  fetchCategories,
  fetchProducts,
  type Category,
  type Product,
} from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

export default function ShopPage() {
  const { user } = useSession();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCategories()
      .then((cats) => {
        setCategories(cats);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchProducts(activeSlug ?? undefined)
      .then(setProducts)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [activeSlug]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <span>F</span> Fast Movie
        </Link>
        <nav className={styles.navLinks}>
          <Link href="/">หน้าแรก</Link>
          <Link href="/shop" aria-current="page">ร้านค้า</Link>
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
        <h1>เลือกสินค้าที่ใช่</h1>
        <p>Streaming · Music · Gaming — ชำระด้วย Point ได้ทันที</p>
      </div>

      <div className={styles.layout}>
        {/* ─── Sidebar categories ─── */}
        <aside className={styles.sidebar}>
          <p className={styles.sideLabel}>หมวดหมู่</p>
          <ul className={styles.catList}>
            <li>
              <button
                className={!activeSlug ? styles.catActive : styles.catBtn}
                type="button"
                onClick={() => setActiveSlug(null)}
              >
                <span>🛍️</span>
                <span>ทั้งหมด</span>
                <small>{categories.reduce((s, c) => s + c.productCount, 0)}</small>
              </button>
            </li>
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  className={activeSlug === cat.slug ? styles.catActive : styles.catBtn}
                  type="button"
                  onClick={() => setActiveSlug(cat.slug)}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.name}</span>
                  <small>{cat.productCount}</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* ─── Product grid ─── */}
        <section className={styles.main}>
          <div className={styles.gridHeader}>
            <h2>
              {activeSlug
                ? categories.find((c) => c.slug === activeSlug)?.name ?? "สินค้า"
                : "สินค้าทั้งหมด"}
            </h2>
            <span className={styles.count}>{products.length} รายการ</span>
          </div>

          {loading ? (
            <div className={styles.skeleton}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={styles.skeletonCard} />
              ))}
            </div>
          ) : products.length === 0 ? (
            <p className={styles.empty}>ไม่มีสินค้าในหมวดนี้</p>
          ) : (
            <div className={styles.grid}>
              {products.map((p) => (
                <article key={p.id} className={styles.card}>
                  {p.badge && <span className={styles.badge}>{p.badge}</span>}

                  <div className={styles.cardIcon}>
                    {p.category.icon}
                  </div>

                  <div className={styles.cardBody}>
                    <p className={styles.cardCat}>{p.category.name}</p>
                    <h3>{p.name}</h3>
                    {p.description && (
                      <p className={styles.cardDesc}>{p.description}</p>
                    )}
                  </div>

                  <div className={styles.cardFooter}>
                    <div className={styles.stockRow}>
                      <span
                        className={
                          p.stock === 0
                            ? styles.stockOut
                            : p.stock <= 3
                              ? styles.stockLow
                              : styles.stockOk
                        }
                      >
                        {p.stock === 0
                          ? "หมดสต็อก"
                          : p.stock <= 3
                            ? `เหลือ ${p.stock} ที่`
                            : `มี ${p.stock} ที่`}
                      </span>
                    </div>

                    <div className={styles.priceRow}>
                      <strong>
                        <span className={styles.coin}>✦</span>
                        {p.price.toLocaleString()}
                      </strong>
                      <small>/ เดือน</small>
                    </div>

                    {p.stock === 0 ? (
                      <button className={styles.btnSoldOut} disabled>
                        หมดสต็อก
                      </button>
                    ) : (
                      <Link
                        href={user ? `/checkout?product=${p.id}` : "/register"}
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
