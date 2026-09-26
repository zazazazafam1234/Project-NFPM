"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  const [method, setMethod] = useState<"promptpay" | "wallet">("promptpay");
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
          {method === "promptpay" ? (
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
            หลังชำระเงินแล้ว ส่งสลิปให้แอดมินเพื่อรับรายละเอียดเข้าใช้งาน
          </p>
          <button className={styles.paidButton} type="button">
            ฉันชำระเงินแล้ว <span>→</span>
          </button>
        </div>
      </section>
    </main>
  );
}
