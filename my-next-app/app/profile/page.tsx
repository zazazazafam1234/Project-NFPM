"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "../providers";
import styles from "./page.module.css";

export default function ProfilePage() {
  const router = useRouter();
  const { user, isLoading, signOut } = useSession();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/register");
  }, [isLoading, router, user]);

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
          <div>
            <p className={styles.eyebrow}>RECENT ACTIVITY</p>
            <h2>รายการล่าสุด</h2>
          </div>
          <p className={styles.empty}>
            รายการและประวัติ Point จะโหลดจาก{" "}
            <code>GET /profile/transactions</code>
          </p>
        </section>
      </section>
    </main>
  );
}
