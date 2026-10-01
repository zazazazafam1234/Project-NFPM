"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  fetchStreamingRooms,
  discountPointsFor,
  formatDiscount,
  purchaseProfileSubscription,
  type StreamingPackage,
  type StreamingRoom,
  type StreamingRoomSlot,
} from "../lib/api";
import { useSession } from "../providers";
import { formatDuration } from "../lib/duration";
import { publicProfileLabel } from "../lib/slots";
import { SupportLink } from "../components/SupportLink";
import styles from "../payment/page.module.css";

export default function CheckoutPage() {
  const router = useRouter();
  const { user, refreshSession } = useSession();
  const [rooms, setRooms] = useState<StreamingRoom[]>([]);
  const [roomId, setRoomId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [purchased, setPurchased] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedRoom = params.get("room") ?? "";
    const requestedProfile = params.get("profile") ?? "";
    fetchStreamingRooms()
      .then((items) => {
        setRooms(items);
        const room = items.find((item) => item.id === requestedRoom) ?? items[0];
        const slot =
          room?.slots.find((item) => item.id === requestedProfile) ??
          room?.slots.find((item) => item.isAvailable);
        if (room) setRoomId(requestedRoom || room.id);
        if (slot) setProfileId(requestedProfile || slot.id);
        if (slot?.availablePackages[0]) setPackageId(slot.availablePackages[0].id);
      })
      .catch(() => undefined);
  }, []);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === roomId) ?? null,
    [rooms, roomId],
  );
  const selectedSlot = useMemo<StreamingRoomSlot | null>(
    () => selectedRoom?.slots.find((slot) => slot.id === profileId) ?? null,
    [selectedRoom, profileId],
  );
  const selectedSlotLabel = useMemo(() => {
    if (!selectedRoom || !selectedSlot) return null;
    const index = selectedRoom.slots.findIndex((slot) => slot.id === selectedSlot.id);
    return index >= 0 ? publicProfileLabel(index) : "Profile";
  }, [selectedRoom, selectedSlot]);
  const availablePackages = useMemo(
    () => selectedSlot?.availablePackages ?? [],
    [selectedSlot],
  );
  const selectedPackage = useMemo<StreamingPackage | null>(
    () => availablePackages.find((pkg) => pkg.id === packageId) ?? availablePackages[0] ?? null,
    [availablePackages, packageId],
  );
  const discountPoints = selectedPackage ? discountPointsFor(user?.discountCents, selectedPackage.priceAmount) : 0;
  const finalPrice = selectedPackage ? selectedPackage.priceAmount - discountPoints : 0;
  const enoughPoints = Boolean(user && selectedPackage && user.points >= finalPrice);

  async function purchase() {
    if (!user) {
      router.push("/register");
      return;
    }
    if (!selectedSlot || !selectedPackage) {
      setMessage("กรุณาเลือก slot และโปรโมชันก่อน");
      return;
    }
    setIsSubmitting(true);
    setMessage("");
    try {
      await purchaseProfileSubscription(selectedSlot.id, selectedPackage.id);
      await refreshSession();
      setPurchased(true);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "ไม่สามารถใช้ Point ได้",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={`${styles.page} ${styles.checkout}`}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <BrandLogo />
        </Link>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <Link className={styles.back} href="/shop">
            ← เลือกห้อง
          </Link>
        </div>
      </header>
      <section className={styles.content}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>ROOM SLOT CHECKOUT</p>
          <h1>
            เลือกโปร
            <br />
            <em>ที่เหมาะกับคุณ</em>
          </h1>
          <p>
            {selectedRoom && selectedSlot
              ? `${selectedRoom.name} · ${selectedSlotLabel}`
              : "กรุณาเลือก slot จากหน้าร้านก่อน"}
          </p>
          <div className={styles.summary}>
            <div>
              <span>{selectedRoom?.service.toUpperCase() ?? "FAST MOVIE"}</span>
              <strong>{selectedSlotLabel ?? "ยังไม่ได้เลือก slot"}</strong>
              <small>{selectedRoom?.label ?? "เลือกห้องจากหน้าร้าน"}</small>
            </div>
            <b>✦</b>
          </div>
        </div>
        <div className={styles.paymentCard}>
          <p className={styles.label}>Point Wallet ของคุณ</p>
          <div className={`${styles.pointBalance} on-accent`}>
            <span>✦</span>
            <b>{user?.points.toLocaleString() ?? "—"}</b>
            <small>POINTS AVAILABLE</small>
          </div>

          {availablePackages.length > 0 ? (
            <div className={styles.topUpGrid}>
              {availablePackages.map((pkg) => (
                <button
                  className={packageId === pkg.id ? styles.activePackage : ""}
                  key={pkg.id}
                  onClick={() => setPackageId(pkg.id)}
                  type="button"
                >
                  <small>{pkg.service.toUpperCase()}</small>
                  <strong>{pkg.name}</strong>
                  <span>
                    {pkg.priceAmount} Point · {formatDuration(pkg.durationMinutes)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.message}>
              Slot นี้ยังไม่มีโปรโมชันที่ใช้ได้ หรือถูกจองไปแล้ว กรุณากลับไปเลือก slot ใหม่
            </p>
          )}

          <div className={styles.divider} />
          {user && selectedPackage && (user.discountCents ?? 0) > 0 && (
            <div className={styles.discountSummary}>
              <span>ราคาโปร</span>
              <b>{selectedPackage.priceAmount.toLocaleString()} Point</b>
              <span>ส่วนลดสะสม (มี {formatDiscount(user.discountCents)})</span>
              <b>{discountPoints > 0 ? `-${discountPoints.toLocaleString()} Point` : "ยังไม่ครบ ฿1"}</b>
              <span>จ่ายจริง</span>
              <strong>{finalPrice.toLocaleString()} Point</strong>
            </div>
          )}
          <p className={styles.afterPay}>
            {!selectedPackage
              ? "เลือก slot ที่พร้อมใช้งานก่อน"
              : user
                ? enoughPoints
                  ? `คุณจะเหลือ ${(user.points - finalPrice).toLocaleString()} Point หลังเลือกโปรนี้`
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
            disabled={
              isSubmitting ||
              purchased ||
              !selectedSlot ||
              !selectedPackage ||
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
          <div className={styles.supportRow}>
            <SupportLink />
          </div>
        </div>
      </section>
      {purchased && (
        <div className={styles.successBackdrop} role="presentation">
          <div
            className={styles.successModal}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="purchase-success-title"
          >
            <span className={styles.successIcon} aria-hidden="true">✓</span>
            <h2 id="purchase-success-title">ซื้อสำเร็จ</h2>
            <p>
              ระบบกำลังเพิ่มอีเมล
              {user?.email ? <b> {user.email}</b> : null} ในโปรไฟล์ เมื่อพร้อมใช้งานจะส่ง PIN ไปที่อีเมลนี้
            </p>
            <p className={styles.successHint}>
              หากไม่พบในกล่องจดหมาย กรุณาตรวจสอบในโฟลเดอร์สแปม (Spam / จดหมายขยะ)
            </p>
            <button
              className={styles.paidButton}
              type="button"
              autoFocus
              onClick={() => router.push("/profile")}
            >
              ไปหน้าโปรไฟล์ <span>→</span>
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
