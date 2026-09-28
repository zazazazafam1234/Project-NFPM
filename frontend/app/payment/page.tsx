"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { apiFetch } from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

const topUps = [
  { points: 50, price: 50, label: "เริ่มต้น" },
  { points: 150, price: 150, label: "คุ้มค่า" },
  { points: 350, price: 350, label: "ยอดนิยม" },
];

export default function TopUpPage() {
  const router = useRouter();
  const { user, refreshSession } = useSession();
  const [points, setPoints] = useState(150);
  const [method, setMethod] = useState<"promptpay" | "wallet">("promptpay");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const selected = topUps.find((item) => item.points === points) ?? topUps[1];

  async function createTopUp() {
    if (!user) {
      router.push("/register");
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
          <BrandLogo />
        </Link>
        <Link className={styles.back} href="/profile">
          ← กลับบัญชี
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
          <p className={styles.label}>01 · เลือกจำนวน Point</p>
          <div className={styles.topUpGrid} role="group" aria-label="จำนวน Point">
            {topUps.map((item) => (
              <button
                className={points === item.points ? styles.activePackage : ""}
                key={item.points}
                onClick={() => setPoints(item.points)}
                aria-pressed={points === item.points}
                type="button"
              >
                <small>{item.label}</small>
                <strong>{item.points}</strong>
                <span>Point · {item.price} บาท</span>
              </button>
            ))}
          </div>
          <p className={styles.label}>02 · เลือกช่องทางชำระเงิน</p>
          <div className={styles.methods} role="group" aria-label="ช่องทางชำระเงิน">
            <button
              className={method === "promptpay" ? styles.active : ""}
              aria-pressed={method === "promptpay"}
              type="button"
              onClick={() => {
                setMethod("promptpay");
                setMessage("");
              }}
            >
              <span className={styles.promptpayIcon}>P</span>
              <span>
                PromptPay<small>สแกน QR Code</small>
              </span>
              <i />
            </button>
            <button
              className={method === "wallet" ? styles.active : ""}
              aria-pressed={method === "wallet"}
              type="button"
              onClick={() => {
                setMethod("wallet");
                setMessage("");
              }}
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
                  QR PromptPay
                  <br />
                  จะแสดงตรงนี้
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
              <h2>เติม {selected.points.toLocaleString()} Point</h2>
              <p>
                ยอดชำระ {selected.price.toLocaleString()} บาท
                <br />
                บัญชีจะได้รับ Point หลังยืนยันรายการ
              </p>
            </div>
          </div>
          <div className={styles.divider} />
          {message && (
            <p className={styles.message} role="status" aria-live="polite">
              {message}
            </p>
          )}
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
