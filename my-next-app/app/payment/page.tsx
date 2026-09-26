"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

const plans = {
  day: { name: "รายวัน", price: 10, duration: "24 ชั่วโมง" },
  week: { name: "รายสัปดาห์", price: 49, duration: "7 วัน" },
  month: { name: "รายเดือน", price: 129, duration: "30 วัน" },
};

const roomNames = {
  "room-1": "ROOM 01",
  "room-2": "ROOM 02",
  "room-3": "ROOM 03",
  "room-4": "ROOM 04",
  "room-5": "ROOM 05",
  "room-6": "ROOM 06",
};

export default function PaymentPage() {
  const [planId, setPlanId] = useState<keyof typeof plans>("week");
  const [roomId, setRoomId] = useState<keyof typeof roomNames>("room-1");
  const [method, setMethod] = useState<"points" | "promptpay" | "wallet">(
    "points",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const { user, refreshSession } = useSession();
  const plan = plans[planId];

  useEffect(() => {
    const requestedPlan = new URLSearchParams(window.location.search).get(
      "plan",
    );
    const requestedRoom = new URLSearchParams(window.location.search).get(
      "room",
    );
    if (requestedPlan && requestedPlan in plans)
      setPlanId(requestedPlan as keyof typeof plans);
    if (requestedRoom && requestedRoom in roomNames)
      setRoomId(requestedRoom as keyof typeof roomNames);
  }, []);

  async function createOrder() {
    if (method === "points" && !user) {
      window.location.assign("/register");
      return;
    }
    setIsSubmitting(true);
    setMessage("");
    try {
      await apiFetch("/orders", {
        method: "POST",
        body: JSON.stringify({ roomId, planId, paymentMethod: method }),
      });
      await refreshSession();
      setMessage(
        method === "points"
          ? "ใช้ Point สำเร็จ ระบบกำลังเตรียมข้อมูลห้องให้คุณ"
          : "สร้างรายการแล้ว กรุณาชำระเงินตามช่องทางที่เลือก",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "ไม่สามารถสร้างรายการได้",
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
          ← กลับไปเลือกห้อง
        </Link>
      </header>
      <section className={styles.content}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>CHECKOUT</p>
          <h1>ชำระเงิน</h1>
          <p>เลือกช่องทางที่สะดวก แล้วชำระตามยอดด้านล่าง</p>
          <div className={styles.summary}>
            <div>
              <span>{roomNames[roomId]}</span>
              <strong>{plan.name}</strong>
              <small>{plan.duration}</small>
            </div>
            <b>
              {plan.price} <small>บาท</small>
            </b>
          </div>
        </div>
        <div className={styles.paymentCard}>
          <p className={styles.label}>เลือกช่องทางชำระเงิน</p>
          <div className={styles.methods}>
            <button
              className={method === "points" ? styles.active : ""}
              type="button"
              onClick={() => setMethod("points")}
            >
              <span className={styles.pointIcon}>✦</span>
              <span>
                Fast Points
                <small>
                  {user
                    ? `${user.points.toLocaleString()} Point พร้อมใช้`
                    : "เข้าสู่ระบบเพื่อใช้งาน"}
                </small>
              </span>
              <i />
            </button>
            <button
              className={method === "promptpay" ? styles.active : ""}
              type="button"
              onClick={() => setMethod("promptpay")}
            >
              <span className={styles.promptpayIcon}>P</span>
              <span>
                PromptPay<small>สแกน QR Code</small>
              </span>
              <i />
            </button>
            <button
              className={method === "wallet" ? styles.active : ""}
              type="button"
              onClick={() => setMethod("wallet")}
            >
              <span className={styles.walletIcon}>T</span>
              <span>
                TrueMoney<small>โอนผ่าน Wallet</small>
              </span>
              <i />
            </button>
          </div>
          {method === "points" ? (
            <div className={styles.paymentDetail}>
              <div className={styles.pointBalance}>
                <span>✦</span>
                <b>{user?.points.toLocaleString() ?? "—"}</b>
                <small>POINTS</small>
              </div>
              <div>
                <h2>
                  ใช้ {plan.price} Point สำหรับ {plan.name}
                </h2>
                <p>
                  {user
                    ? user.points >= plan.price
                      ? "Point จะถูกตัดเมื่อยืนยันการเลือกโปร"
                      : "Point ของคุณไม่เพียงพอสำหรับโปรนี้"
                    : "เข้าสู่ระบบด้วย Google เพื่อใช้ Point ในการเลือกโปร"}
                </p>
                <Link
                  className={styles.profileLink}
                  href={user ? "/profile" : "/register"}
                >
                  {user ? "ดู Point Wallet" : "เข้าสู่ระบบ"} →
                </Link>
              </div>
            </div>
          ) : method === "promptpay" ? (
            <div className={styles.paymentDetail}>
              <div className={styles.qrPlaceholder}>
                <div className={styles.qrMark}>QR</div>
                <p>
                  วาง QR PromptPay
                  <br />
                  ของร้านตรงนี้
                </p>
              </div>
              <div>
                <h2>สแกนเพื่อชำระ {plan.price} บาท</h2>
                <p>เปิดแอปธนาคาร เลือกสแกน QR แล้วชำระตามยอดที่แสดง</p>
                <p className={styles.setupNote}>
                  ก่อนเปิดใช้งานจริง ให้แทนที่กล่องนี้ด้วย QR PromptPay ของร้าน
                </p>
              </div>
            </div>
          ) : (
            <div className={styles.paymentDetail}>
              <div className={styles.walletPlaceholder}>
                ทรู
                <br />
                มันนี่
              </div>
              <div>
                <h2>ชำระผ่าน TrueMoney Wallet</h2>
                <p>
                  โอนยอด <b>{plan.price} บาท</b> ไปยังเบอร์ Wallet ของร้าน
                </p>
                <p className={styles.setupNote}>
                  เพิ่มเบอร์ TrueMoney Wallet ของร้านก่อนเปิดใช้งานจริง
                </p>
              </div>
            </div>
          )}
          <div className={styles.divider} />
          <p className={styles.afterPay}>
            {method === "points"
              ? "ยืนยันแล้วระบบจะตัด Point และสร้างคำสั่งซื้อทันที"
              : "หลังชำระเงินแล้ว ส่งสลิปให้แอดมินเพื่อรับรายละเอียดเข้าใช้งาน"}
          </p>
          {message && <p className={styles.message}>{message}</p>}
          <button
            className={styles.paidButton}
            type="button"
            disabled={
              isSubmitting ||
              (method === "points" && Boolean(user && user.points < plan.price))
            }
            onClick={() => void createOrder()}
          >
            {isSubmitting
              ? "กำลังดำเนินการ…"
              : method === "points"
                ? "ยืนยันใช้ Point"
                : "สร้างรายการชำระเงิน"}{" "}
            <span>→</span>
          </button>
        </div>
      </section>
    </main>
  );
}
