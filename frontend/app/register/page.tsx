"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import { useSession } from "../providers";
import { googleLoginUrl } from "../lib/api";
import styles from "./page.module.css";

export default function RegisterPage() {
  const { user, isLoading } = useSession();
  // Where to land after login, e.g. ?next=/admin?section=resellers from a LINE alert.
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("next");
    queueMicrotask(() => setNext(value && value.startsWith("/") && !value.startsWith("//") ? value : null));
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.glow} />
      <section className={styles.card}>
        <ThemeToggle className={styles.themeToggle} />
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
            <Link className={styles.primary} href={next ?? "/profile"}>
              {next ? "ไปต่อ" : "ไปที่โปรไฟล์"} <b>→</b>
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
            <a className={styles.google} href={googleLoginUrl(next)}>
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
