"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { apiFetch } from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

const topUps = [
  { points: 50, price: 50, label: "เริ่มต้น" },
  { points: 150, price: 150, label: "คุ้มค่า" },
  { points: 350, price: 350, label: "ยอดนิยม" },
];

type TopUpResponse = {
  id: string;
  status: "pending" | "paid" | "expired" | "cancelled" | "failed";
  points: number;
  baseAmount: number;
  payableAmount: number;
  refDecimal: number;
  expiresAt: string;
  paidAt: string | null;
  qrImage: string | null;
};

export default function TopUpPage() {
  const router = useRouter();
  const { user, refreshSession } = useSession();
  const [points, setPoints] = useState(150);
  const [method, setMethod] = useState<"promptpay">("promptpay");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingTopUp, setPendingTopUp] = useState<TopUpResponse | null>(null);
  const selected = topUps.find((item) => item.points === points) ?? topUps[1];

  useEffect(() => {
    if (!pendingTopUp || pendingTopUp.status !== "pending") return;
    const interval = window.setInterval(() => {
      apiFetch<TopUpResponse>(`/points/top-ups/${pendingTopUp.id}`)
        .then(async (topUp) => {
          setPendingTopUp({ ...topUp, qrImage: pendingTopUp.qrImage });
          if (topUp.status === "paid") {
            window.clearInterval(interval);
            await refreshSession();
            setMessage("ชำระเงินสำเร็จ เติม Point เข้าบัญชีแล้ว");
            window.alert("ชำระเงินสำเร็จ เติม Point เข้าบัญชีแล้ว");
          }
          if (topUp.status === "expired") {
            window.clearInterval(interval);
            setMessage("รายการ QR หมดอายุแล้ว กรุณาสร้างรายการใหม่");
          }
        })
        .catch(() => undefined);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [pendingTopUp, refreshSession]);

  async function createTopUp() {
    if (!user) {
      router.push("/register");
      return;
    }
    setIsSubmitting(true);
    setMessage("");
    setPendingTopUp(null);
    try {
      const topUp = await apiFetch<TopUpResponse>("/points/top-ups", {
        method: "POST",
        body: JSON.stringify({
          points: selected.points,
          amount: selected.price,
          paymentMethod: method,
        }),
      });
      setPendingTopUp(topUp);
      setMessage("สร้าง QR แล้ว กรุณาโอนยอดให้ตรงรวมทศนิยมเพื่อยืนยันอัตโนมัติ");
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
            <button className={styles.disabledMethod} type="button" disabled>
              <span className={styles.walletIcon}>T</span>
              <span>
                TrueMoney<small>เร็ว ๆ นี้</small>
              </span>
              <i />
            </button>
          </div>
          <div className={styles.paymentDetail}>
            {pendingTopUp?.qrImage ? (
              <div className={styles.qrImageBox}>
                <Image
                  alt="PromptPay QR"
                  height={150}
                  src={pendingTopUp.qrImage}
                  unoptimized
                  width={150}
                />
              </div>
            ) : (
              <div className={styles.qrPlaceholder}>
                <div className={styles.qrMark}>QR</div>
                <p>
                  กดสร้างรายการ
                  <br />
                  เพื่อรับ QR
                </p>
              </div>
            )}
            <div>
              <h2>เติม {selected.points} Point</h2>
              {pendingTopUp ? (
                <div className={styles.paymentRef}>
                  <span>ยอดที่ต้องโอน</span>
                  <strong>{pendingTopUp.payableAmount.toFixed(2)} บาท</strong>
                  <small>
                    โอน {pendingTopUp.baseAmount.toLocaleString()} บาท +
                    ref .{String(pendingTopUp.refDecimal).padStart(2, "0")}
                  </small>
                  <em>
                    สถานะ: {pendingTopUp.status} · หมดอายุ{" "}
                    {new Date(pendingTopUp.expiresAt).toLocaleTimeString("th-TH", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </em>
                </div>
              ) : (
                <p>
                  ระบบจะสร้างยอดทศนิยมเป็น ref ให้โอน เช่น 150.37 บาท
                  แล้ว LINE worker จะยืนยันอัตโนมัติเมื่อยอดเงินเข้าตรงกัน
                </p>
              )}
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
