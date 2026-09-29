"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import { apiFetch, fetchTopupSettings } from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

const topUps = [
  { points: 50, price: 50, label: "เริ่มต้น" },
  { points: 150, price: 150, label: "คุ้มค่า" },
  { points: 350, price: 350, label: "ยอดนิยม" },
];
const DEFAULT_MIN_TOPUP_POINTS = 10;

type TopUpResponse = {
  id: string;
  status: "pending" | "paid" | "expired" | "cancelled" | "failed";
  points: number;
  paymentAccountId?: string | null;
  paymentAccountName?: string | null;
  baseAmount: number;
  payableAmount: number;
  refDecimal: number;
  expiresAt: string;
  paidAt: string | null;
  qrImage: string | null;
};

function formatBaht(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

// PNG of the QR on white with the amount and expiry, so it can be saved to the
// photo gallery and scanned from a banking app.
async function renderQrPng(topUp: TopUpResponse): Promise<Blob> {
  const qr = new window.Image();
  qr.src = topUp.qrImage ?? "";
  await qr.decode();

  const width = 720;
  const qrSize = 560;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1c1826";
  ctx.textAlign = "center";
  ctx.font = `700 34px ${font}`;
  ctx.fillText("PromptPay · Fast Movie", width / 2, 64);
  ctx.drawImage(qr, (width - qrSize) / 2, 96, qrSize, qrSize);
  ctx.font = `800 44px ${font}`;
  ctx.fillText(`${formatBaht(topUp.payableAmount)} บาท`, width / 2, 720);
  ctx.font = `500 26px ${font}`;
  ctx.fillStyle = "#4d4659";
  ctx.fillText("กรุณาโอนยอดนี้ให้ตรงทุกสตางค์", width / 2, 768);
  ctx.fillText(`เติม ${topUp.points.toLocaleString()} Point · หมดอายุ ${formatDateTime(topUp.expiresAt)}`, width / 2, 812);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png_failed"))), "image/png"),
  );
}

export default function TopUpPage() {
  const router = useRouter();
  const { user, refreshSession } = useSession();
  const [pointsInput, setPointsInput] = useState("150");
  const [method, setMethod] = useState<"promptpay">("promptpay");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingTopUp, setPendingTopUp] = useState<TopUpResponse | null>(null);
  const [minTopupPoints, setMinTopupPoints] = useState(DEFAULT_MIN_TOPUP_POINTS);
  const [isSavingQr, setIsSavingQr] = useState(false);

  async function saveQrCode(topUp: TopUpResponse) {
    if (!topUp.qrImage) return;
    setIsSavingQr(true);
    try {
      const blob = await renderQrPng(topUp);
      const fileName = `fastmovie-promptpay-${formatBaht(topUp.payableAmount).replace(/,/g, "")}.png`;
      const file = new File([blob], fileName, { type: "image/png" });
      // Phones: the share sheet offers "Save Image" to the photo gallery.
      if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "PromptPay QR" });
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setMessage("บันทึก QR ไม่สำเร็จ กรุณาแคปหน้าจอแทน");
    } finally {
      setIsSavingQr(false);
    }
  }
  const topUpPoints = Number(pointsInput);
  const isValidTopUp = Number.isInteger(topUpPoints) && topUpPoints >= minTopupPoints;
  const selectedSuggestion = topUps.find((item) => item.points === topUpPoints);

  useEffect(() => {
    fetchTopupSettings()
      .then((settings) => setMinTopupPoints(settings.minTopupPoints))
      .catch(() => undefined);
  }, []);

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
            router.push("/profile");
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
    if (!isValidTopUp) {
      setMessage(`ยอดเติมขั้นต่ำ ${minTopupPoints} บาท และต้องเป็นเลขจำนวนเต็ม`);
      return;
    }
    setIsSubmitting(true);
    setMessage("");
    setPendingTopUp(null);
    try {
      const topUp = await apiFetch<TopUpResponse>("/points/top-ups", {
        method: "POST",
        body: JSON.stringify({
          points: topUpPoints,
          amount: topUpPoints,
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
        <div className={styles.headerActions}>
          <ThemeToggle />
          <Link className={styles.back} href="/profile">
            ← กลับบัญชี
          </Link>
        </div>
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
          <p className={styles.label}>01 · กรอกจำนวน Point</p>
          <label className={styles.customAmount}>
            <span>จำนวนที่ต้องการเติม</span>
            <div>
              <input
                inputMode="numeric"
                min={minTopupPoints}
                pattern="[0-9]*"
                value={pointsInput}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, "");
                  setPointsInput(value);
                  setPendingTopUp(null);
                  setMessage("");
                }}
              />
              <b>บาท</b>
            </div>
            <small>ขั้นต่ำ {minTopupPoints} บาท · 1 บาท = 1 Point</small>
          </label>
          <p className={styles.label}>ราคาแนะนำ</p>
          <div className={styles.topUpGrid} role="group" aria-label="จำนวน Point">
            {topUps.filter((item) => item.points >= minTopupPoints).map((item) => (
              <button
                className={selectedSuggestion?.points === item.points ? styles.activePackage : ""}
                key={item.points}
                onClick={() => {
                  setPointsInput(String(item.points));
                  setPendingTopUp(null);
                  setMessage("");
                }}
                aria-pressed={selectedSuggestion?.points === item.points}
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
              <span className={styles.promptpayIcon} aria-hidden="true">
                <Image alt="" height={28} src="/promptpay-mark.svg" width={28} />
              </span>
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
          {pendingTopUp?.qrImage && (
          <div className={`${styles.paymentDetail} ${styles.paymentResult}`}>
            {pendingTopUp?.qrImage ? (
              <div className={styles.qrColumn}>
                <div className={styles.qrImageBox}>
                  <Image
                    alt="PromptPay QR"
                    height={150}
                    src={pendingTopUp.qrImage}
                    unoptimized
                    width={150}
                  />
                </div>
                <button
                  className={styles.saveQrButton}
                  disabled={isSavingQr}
                  onClick={() => void saveQrCode(pendingTopUp)}
                  type="button"
                >
                  {isSavingQr ? "กำลังบันทึก…" : "⬇ บันทึก QR Code"}
                </button>
              </div>
            ) : (
              <div className={styles.qrPlaceholder}>
                <div className={styles.qrMark}>QR</div>
                <p>
                  QR PromptPay
                  <br />
                  จะแสดงตรงนี้
                </p>
              </div>
            )}
            <div>
              <h2>
                เติม {(pendingTopUp?.points ?? (isValidTopUp ? topUpPoints : 0)).toLocaleString()} Point
              </h2>
              {pendingTopUp ? (
                <div className={styles.paymentRef}>
                  <span>ยอดที่ต้องโอนให้ตรง</span>
                  <strong>{formatBaht(pendingTopUp.payableAmount)} บาท</strong>
                  <small>
                    ยอดหลัก {formatBaht(pendingTopUp.baseAmount)} + ref .
                    {String(pendingTopUp.refDecimal).padStart(2, "0")}
                  </small>
                  <em>
                    บัญชีรับเงิน {pendingTopUp.paymentAccountName ?? "PromptPay"} · หมดอายุ{" "}
                    {formatDateTime(pendingTopUp.expiresAt)}
                  </em>
                </div>
              ) : (
                <p>
                  ยอดชำระ {isValidTopUp ? topUpPoints.toLocaleString() : "-"} บาท
                  <br />
                  บัญชีจะได้รับ Point หลังยืนยันรายการ
                </p>
              )}
            </div>
          </div>
          )}
          {pendingTopUp?.qrImage && <div className={styles.divider} />}
          {message && (
            <p className={styles.message} role="status" aria-live="polite">
              {message}
            </p>
          )}
          <button
            className={styles.paidButton}
            type="button"
            disabled={isSubmitting || (Boolean(user) && !isValidTopUp)}
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
