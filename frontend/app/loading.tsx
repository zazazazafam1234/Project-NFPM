import { BrandLogo } from "./components/BrandLogo";
import styles from "./loading.module.css";

export default function Loading() {
  return (
    <main className={styles.page} aria-busy="true" aria-live="polite">
      <div className={styles.orb} />
      <section className={styles.card}>
        <div className={styles.logo}>
          <BrandLogo showName={false} />
        </div>
        <div className={styles.spinner} />
        <p>แป๊บนึงนะ กำลังเตรียมป๊อปคอร์น 🍿</p>
        <span>LOADING…</span>
      </section>
    </main>
  );
}
