"use client";

import Link from "next/link";
import { BrandLogo } from "../components/BrandLogo";
import { useSession } from "../providers";
import { googleLoginUrl } from "../lib/api";
import styles from "./page.module.css";

export default function RegisterPage() {
  const { user, isLoading } = useSession();

  return (
    <main className={styles.page}>
      <div className={styles.glow} />
      <section className={styles.card}>
        <Link className={styles.brand} href="/">
          <BrandLogo />
        </Link>
        {isLoading ? (
          <div className={styles.loader} />
        ) : user ? (
          <>
            <p className={styles.eyebrow}>SIGNED IN</p>
            <h1>
              ยินดีต้อนรับกลับมา
              <br />
              {user.name}
            </h1>
            <Link className={styles.primary} href="/profile">
              ไปที่โปรไฟล์ <b>→</b>
            </Link>
          </>
        ) : (
          <>
            <p className={styles.eyebrow}>FAST MOVIE ACCOUNT</p>
            <h1>
              เริ่มต้นด้วยบัญชี
              <br />
              <em>Google ของคุณ</em>
            </h1>
            <p className={styles.copy}>
              สะสม Point ใช้แลกโปร และติดตามทุกห้องที่คุณเลือกไว้ได้ในที่เดียว
            </p>
            <a className={styles.google} href={googleLoginUrl()}>
              <span>G</span> ดำเนินการต่อด้วย Google
            </a>
            <p className={styles.note}>
              เมื่อดำเนินการต่อ
              คุณยอมรับเงื่อนไขการใช้งานและนโยบายความเป็นส่วนตัว
            </p>
          </>
        )}
      </section>
    </main>
  );
}
