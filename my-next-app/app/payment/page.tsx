"use client";

import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

const topUps = [
  { points: 50, price: 50, label: "เริ่มต้น" },
  { points: 150, price: 150, label: "คุ้มค่า" },
  { points: 350, price: 350, label: "ยอดนิยม" },
];

export default function TopUpPage() {
  const { user, refreshSession } = useSession();
  const [points, setPoints] = useState(150);
  const [method, setMethod] = useState<"promptpay" | "wallet">("promptpay");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const selected = topUps.find((item) => item.points === points) ?? topUps[1];

  async function createTopUp() {
    if (!user) {
      window.location.assign("/register");
      return;
    }
    setIsSubmitting(true);
    setMessage("");
    try {
      await apiFetch("/points/top-ups", {
        method: "POST",
        body: JSON.stringify({
          points: selected.points,
          amount: selected.price,
          paymentMethod: method,
        }),
      });
      await refreshSession();
      setMessage("สร้างรายการเติม Point แล้ว กรุณาชำระเงินตามช่องทางที่เลือก");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถสร้างรายการเติม Point ได้",
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
        <Link className={styles.back} href="/profile">
          ← Point Wallet
        </Link>
      </header>
      <section className={styles.content}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>FAST POINTS</p>
          <h1>
            เติม Point
            <br />
            <em>ก่อนเลือกโปร</em>
          </h1>
          <p>
            ใช้ Point เป็นเครดิตกลางสำหรับเลือกซื้อทุกโปร
            ไม่มีการชำระเงินตรงในหน้าห้อง
          </p>
          <div className={styles.summary}>
            <div>
              <span>Point ที่มี</span>
              <strong>{user ? user.points.toLocaleString() : "—"}</strong>
              <small>POINTS AVAILABLE</small>
            </div>
            <b>✦</b>
          </div>
        </div>
        <div className={styles.paymentCard}>
          <p className={styles.label}>เลือกจำนวน Point</p>
          <div className={styles.topUpGrid}>
            {topUps.map((item) => (
              <button
                className={points === item.points ? styles.activePackage : ""}
                key={item.points}
                onClick={() => setPoints(item.points)}
                type="button"
              >
                <small>{item.label}</small>
                <strong>{item.points}</strong>
                <span>Point · {item.price} บาท</span>
              </button>
            ))}
          </div>
          <p className={styles.label}>เลือกช่องทางชำระเงิน</p>
          <div className={styles.methods}>
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
          <div className={styles.paymentDetail}>
            {method === "promptpay" ? (
              <div className={styles.qrPlaceholder}>
                <div className={styles.qrMark}>QR</div>
                <p>
                  วาง QR PromptPay
                  <br />
                  ของร้านตรงนี้
                </p>
              </div>
            ) : (
              <div className={styles.walletPlaceholder}>
                ทรู
                <br />
                มันนี่
              </div>
            )}
            <div>
              <h2>เติม {selected.points} Point</h2>
              <p>
                ชำระยอด {selected.price} บาท แล้ว server จะยืนยันและเพิ่ม Point
                ให้บัญชีนี้
              </p>
            </div>
          </div>
          <div className={styles.divider} />
          {message && <p className={styles.message}>{message}</p>}
          <button
            className={styles.paidButton}
            type="button"
            disabled={isSubmitting}
            onClick={() => void createTopUp()}
          >
            {isSubmitting
              ? "กำลังสร้างรายการ…"
              : user
                ? "สร้างรายการเติม Point"
                : "เข้าสู่ระบบเพื่อเติม Point"}{" "}
            <span>→</span>
          </button>
        </div>
      </section>
    </main>
  );
}
