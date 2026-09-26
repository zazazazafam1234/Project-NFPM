import styles from "./loading.module.css";

export default function Loading() {
  return (
    <main className={styles.page} aria-busy="true" aria-live="polite">
      <div className={styles.orb} />
      <section className={styles.card}>
        <div className={styles.logo}>F</div>
        <div className={styles.spinner} />
        <p>กำลังเตรียม Fast Movie ให้คุณ</p>
        <span>PLEASE WAIT</span>
      </section>
    </main>
  );
}
