"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useSession } from "../providers";
import styles from "../payment/page.module.css";

const plans = {
  day: { name: "รายวัน", points: 10, duration: "24 ชั่วโมง" },
  week: { name: "รายสัปดาห์", points: 49, duration: "7 วัน" },
  month: { name: "รายเดือน", points: 129, duration: "30 วัน" },
};

export default function CheckoutPage() {
  const { user, refreshSession } = useSession();
  const [planId, setPlanId] = useState<keyof typeof plans>("week");
  const [roomId, setRoomId] = useState("room-1");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const plan = plans[planId];
  const enoughPoints = Boolean(user && user.points >= plan.points);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedPlan = params.get("plan");
    const requestedRoom = params.get("room");
    if (requestedPlan && requestedPlan in plans)
      setPlanId(requestedPlan as keyof typeof plans);
    if (requestedRoom) setRoomId(requestedRoom);
  }, []);
  async function purchase() {
    if (!user) {
      window.location.assign("/register");
      return;
    }
    setIsSubmitting(true);
    setMessage("");
    try {
      await apiFetch("/orders", {
        method: "POST",
        body: JSON.stringify({ roomId, planId, paymentMethod: "points" }),
      });
      await refreshSession();
      setMessage("ใช้ Point สำเร็จ ระบบกำลังเตรียมข้อมูลห้องให้คุณ");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "ไม่สามารถใช้ Point ได้",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <span>F</span> Fast Movie
        </Link>
        <Link className={styles.back} href="/">
          ← เลือกห้อง
        </Link>
      </header>
      <section className={styles.content}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>USE FAST POINTS</p>
          <h1>
            ยืนยัน
            <br />
            <em>การเลือกโปร</em>
          </h1>
          <p>
            ROOM {roomId.replace("room-", "0")} · {plan.duration}
          </p>
          <div className={styles.summary}>
            <div>
              <span>{plan.name}</span>
              <strong>ใช้ {plan.points} Point</strong>
              <small>FAST POINTS PAYMENT</small>
            </div>
            <b>✦</b>
          </div>
        </div>
        <div className={styles.paymentCard}>
          <p className={styles.label}>Point Wallet ของคุณ</p>
          <div className={styles.pointBalance}>
            <span>✦</span>
            <b>{user?.points.toLocaleString() ?? "—"}</b>
            <small>POINTS AVAILABLE</small>
          </div>
          <div className={styles.divider} />
          <p className={styles.afterPay}>
            {user
              ? enoughPoints
                ? `คุณจะเหลือ ${(user.points - plan.points).toLocaleString()} Point หลังเลือกโปรนี้`
                : "Point ไม่เพียงพอ กรุณาเติม Point ก่อน"
              : "เข้าสู่ระบบด้วย Google เพื่อใช้ Point"}
          </p>
          {message && <p className={styles.message}>{message}</p>}
          <Link className={styles.profileLink} href="/payment">
            เติม Point →
          </Link>
          <button
            className={styles.paidButton}
            type="button"
            disabled={isSubmitting || Boolean(user && !enoughPoints)}
            onClick={() => void purchase()}
          >
            {isSubmitting
              ? "กำลังดำเนินการ…"
              : user
                ? "ยืนยันใช้ Point"
                : "เข้าสู่ระบบเพื่อดำเนินการ"}{" "}
            <span>→</span>
          </button>
        </div>
      </section>
    </main>
  );
}
