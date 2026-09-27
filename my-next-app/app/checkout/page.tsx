"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import {
  fetchPackages,
  purchaseSubscription,
  type PurchaseSubscriptionResponse,
  type StreamingPackage,
} from "../lib/api";
import { useSession } from "../providers";
import styles from "../payment/page.module.css";

export default function CheckoutPage() {
  const { user, refreshSession } = useSession();
  const [packages, setPackages] = useState<StreamingPackage[]>([]);
  const [packageSlug, setPackageSlug] = useState("netflix-week");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [purchaseResult, setPurchaseResult] =
    useState<PurchaseSubscriptionResponse | null>(null);
  const selectedPackage =
    packages.find((pkg) => pkg.slug === packageSlug) ?? packages[0];
  const enoughPoints = Boolean(
    user && selectedPackage && user.points >= selectedPackage.priceAmount,
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedPackage = params.get("package");
    if (requestedPackage) setPackageSlug(requestedPackage);
    fetchPackages()
      .then((items) => {
        setPackages(items);
        if (!requestedPackage && items[0]) setPackageSlug(items[0].slug);
      })
      .catch(() => undefined);
  }, []);

  async function purchase() {
    if (!user || !selectedPackage) {
      window.location.assign("/register");
      return;
    }
    setIsSubmitting(true);
    setMessage("");
    setPurchaseResult(null);
    try {
      const result = await purchaseSubscription(selectedPackage.slug);
      await refreshSession();
      setPurchaseResult(result);
      setMessage("เช่าสำเร็จ ระบบล็อกโปรไฟล์และถอดรหัสข้อมูลเข้าชมให้แล้ว");
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
          <BrandLogo />
        </Link>
        <Link className={styles.back} href="/">
          ← เลือกแพ็กเกจ
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
            {selectedPackage
              ? `${selectedPackage.service.toUpperCase()} · ${selectedPackage.durationDays} วัน`
              : "กำลังโหลดแพ็กเกจ"}
          </p>
          <div className={styles.summary}>
            <div>
              <span>{selectedPackage?.name ?? "เลือกแพ็กเกจ"}</span>
              <strong>
                ใช้ {selectedPackage?.priceAmount.toLocaleString() ?? "—"} Point
              </strong>
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
          {packages.length > 1 && (
            <div className={styles.topUpGrid}>
              {packages.map((pkg) => (
                <button
                  className={packageSlug === pkg.slug ? styles.activePackage : ""}
                  key={pkg.id}
                  onClick={() => setPackageSlug(pkg.slug)}
                  type="button"
                >
                  <small>{pkg.availableStock > 0 ? "พร้อมเช่า" : "หมดสต็อก"}</small>
                  <strong>{pkg.name}</strong>
                  <span>
                    {pkg.priceAmount} Point · {pkg.durationDays} วัน
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className={styles.divider} />
          <p className={styles.afterPay}>
            {!selectedPackage
              ? "กำลังโหลดแพ็กเกจ"
              : selectedPackage.availableStock <= 0
                ? "แพ็กเกจนี้ยังไม่มีโปรไฟล์ว่าง กรุณาเลือกแพ็กเกจอื่นหรือแจ้งแอดมิน"
                : user
              ? enoughPoints
                ? `คุณจะเหลือ ${(user.points - selectedPackage.priceAmount).toLocaleString()} Point หลังเลือกโปรนี้`
                : "Point ไม่เพียงพอ กรุณาเติม Point ก่อน"
              : "เข้าสู่ระบบด้วย Google เพื่อใช้ Point"}
          </p>
          {message && <p className={styles.message}>{message}</p>}
          {purchaseResult && (
            <div className={styles.paymentDetail}>
              <div className={styles.walletPlaceholder}>
                OK
              </div>
              <div>
                <h2>ข้อมูลเข้าชม</h2>
                <p>
                  Email: {purchaseResult.credentials.email}
                  <br />
                  Password: {purchaseResult.credentials.password ?? "-"}
                  <br />
                  Profile: {purchaseResult.credentials.profileName}
                  <br />
                  PIN: {purchaseResult.credentials.pin ?? "-"}
                </p>
              </div>
            </div>
          )}
          <Link className={styles.profileLink} href="/payment">
            เติม Point →
          </Link>
          <button
            className={styles.paidButton}
            type="button"
            disabled={
              isSubmitting ||
              !selectedPackage ||
              selectedPackage.availableStock <= 0 ||
              Boolean(user && !enoughPoints)
            }
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
