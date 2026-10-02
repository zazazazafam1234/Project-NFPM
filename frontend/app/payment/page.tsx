"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  apiFetch,
  describeReward,
  fetchTopUpQuote,
  fetchTopupPromotions,
  fetchTopupSettings,
  formatDiscount,
  type TopUpQuote,
  type TopupPromotion,
} from "../lib/api";
import { useSession } from "../providers";
import { SupportLink } from "../components/SupportLink";
import styles from "./page.module.css";

const quickAmounts = [50, 150, 350];
const DEFAULT_MIN_TOPUP_POINTS = 10;
const PAID_BUTTON_DELAY_MS = 60 * 1000;
const CHECK_COOLDOWN_MS = 20 * 1000;

type TopUpResponse = {
  id: string;
  reference?: string;
  createdAt?: string;
  checkRequestedAt?: string | null;
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
  discountCents?: number;
  chargeAmount?: number;
  promotionName?: string | null;
  promotionRewardCents?: number;
  streamerName?: string | null;
  streamerRewardCents?: number;
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
  const discount = topUp.discountCents ? ` (ลดแล้ว ฿${formatBaht(topUp.discountCents / 100)})` : "";
  ctx.fillText(`เติม ${topUp.points.toLocaleString()} Point${discount} · หมดอายุ ${formatDateTime(topUp.expiresAt)}`, width / 2, 812);
  ctx.fillStyle = "#6a44e0";
  ctx.fillText(
    `เศษ .${String(topUp.refDecimal).padStart(2, "0")} บาท สะสมเป็นเงินส่วนลดใช้ครั้งถัดไป`,
    width / 2,
    856,
  );

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png_failed"))), "image/png"),
  );
}

// Circular countdown in the QR card's corner until the "I paid" button appears.
function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div
      className={styles.countdownRing}
      role="timer"
      aria-label={`กำลังรอยืนยันการโอนอัตโนมัติ ถ้าโอนแล้วยังไม่เข้า กดแจ้งได้ใน ${label}`}
      title="กำลังรอยืนยันการโอนอัตโนมัติ"
    >
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <circle className={styles.countdownTrack} cx="26" cy="26" r={radius} />
        <circle
          className={styles.countdownProgress}
          cx="26"
          cy="26"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - seconds / total)}
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}

export default function TopUpPage() {
  const router = useRouter();
  const { user, refreshSession } = useSession();
  const [pointsInput, setPointsInput] = useState("150");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingTopUp, setPendingTopUp] = useState<TopUpResponse | null>(null);
  const [minTopupPoints, setMinTopupPoints] = useState(DEFAULT_MIN_TOPUP_POINTS);
  const [isSavingQr, setIsSavingQr] = useState(false);
  const [promotions, setPromotions] = useState<TopupPromotion[]>([]);
  const [codeInput, setCodeInput] = useState("");
  // Server quote for the amount and code: the same numbers the QR will charge.
  const [quote, setQuote] = useState<TopUpQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);

  useEffect(() => {
    fetchTopupPromotions()
      .then((data) => setPromotions(data.promotions))
      .catch(() => undefined);
    // Streamer links arrive as /payment?code=XXXX
    const fromLink = new URLSearchParams(window.location.search).get("code");
    if (fromLink) queueMicrotask(() => setCodeInput(fromLink.toUpperCase()));
  }, []);

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
  const typedCode = codeInput.trim();

  // Re-quote shortly after the amount or code changes; a valid code applies by itself.
  useEffect(() => {
    if (!isValidTopUp) {
      queueMicrotask(() => setQuote(null));
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsQuoting(true);
      fetchTopUpQuote(topUpPoints, typedCode)
        .then((data) => {
          if (!cancelled) setQuote(data);
        })
        .catch(() => {
          if (!cancelled) setQuote(null);
        })
        .finally(() => {
          if (!cancelled) setIsQuoting(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isValidTopUp, topUpPoints, typedCode, user?.id]);

  const quoteMatches = quote && quote.baseCents === topUpPoints * 100;
  const codeApplied = quoteMatches && typedCode ? quote.code : null;
  const codeError = quoteMatches && typedCode ? quote.codeError : null;
  const nextPromotion = promotions
    .filter((promotion) => promotion.minAmountCents > topUpPoints * 100)
    .sort((a, b) => a.minAmountCents - b.minAmountCents)[0];

  useEffect(() => {
    fetchTopupSettings()
      .then((settings) => setMinTopupPoints(settings.minTopupPoints))
      .catch(() => undefined);
  }, []);

  // Clock for the "I paid" countdown while a QR is waiting.
  const [now, setNow] = useState(0);
  const [checkNote, setCheckNote] = useState("");
  const [lastCheckAt, setLastCheckAt] = useState(0);
  const isWaiting = pendingTopUp?.status === "pending";
  useEffect(() => {
    if (!isWaiting) return;
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    queueMicrotask(tick);
    return () => window.clearInterval(timer);
  }, [isWaiting]);
  const qrCreatedAt = pendingTopUp?.createdAt ? new Date(pendingTopUp.createdAt).getTime() : now;
  const secondsUntilCheck = now ? Math.max(0, Math.ceil((qrCreatedAt + PAID_BUTTON_DELAY_MS - now) / 1000)) : 60;
  const checkCooldown = now ? Math.max(0, Math.ceil((lastCheckAt + CHECK_COOLDOWN_MS - now) / 1000)) : 0;

  async function reportPaid() {
    if (!pendingTopUp) return;
    setLastCheckAt(Date.now());
    try {
      await apiFetch(`/points/top-ups/${pendingTopUp.id}/check`, { method: "POST" });
      setCheckNote(
        "ได้รับแจ้งแล้ว ระบบกำลังตรวจสอบกับธนาคารถี่ขึ้น (ทุก 10 วินาที) · ช่วงดึก LINE/ธนาคารอาจแจ้งช้า 1–5 นาที ไม่ต้องโอนซ้ำ",
      );
    } catch (err) {
      setCheckNote(err instanceof Error ? err.message : "แจ้งไม่สำเร็จ กรุณาลองใหม่");
    }
  }

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
          paymentMethod: "promptpay",
          // Only a code the quote accepted; a bad one is ignored rather than blocking the QR.
          code: codeApplied?.code ?? null,
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
          <p className={styles.label}>เติมกี่บาท</p>
          <label className={styles.customAmount}>
            <div>
              <input
                aria-label="จำนวนเงินที่ต้องการเติม"
                inputMode="numeric"
                min={minTopupPoints}
                pattern="[0-9]*"
                value={pointsInput}
                onChange={(event) => {
                  setPointsInput(event.target.value.replace(/\D/g, ""));
                  setPendingTopUp(null);
                  setMessage("");
                }}
              />
              <b>บาท</b>
            </div>
            <small>ขั้นต่ำ {minTopupPoints} บาท · 1 บาท = 1 Point</small>
          </label>
          <div className={styles.quickAmounts} role="group" aria-label="จำนวนแนะนำ">
            {quickAmounts
              .filter((amount) => amount >= minTopupPoints)
              .map((amount) => (
                <button
                  aria-pressed={topUpPoints === amount}
                  className={topUpPoints === amount ? styles.quickActive : ""}
                  key={amount}
                  onClick={() => {
                    setPointsInput(String(amount));
                    setPendingTopUp(null);
                    setMessage("");
                  }}
                  type="button"
                >
                  {amount} บาท
                </button>
              ))}
          </div>

          <div className={styles.codeBox}>
            <span>โค้ดส่วนลด (ถ้ามี)</span>
            <input
              autoCapitalize="characters"
              placeholder="พิมพ์โค้ด ระบบจะใช้ให้อัตโนมัติ"
              value={codeInput}
              onChange={(event) => {
                setCodeInput(event.target.value.toUpperCase().replace(/\s/g, ""));
                setPendingTopUp(null);
              }}
            />
            {typedCode && isQuoting && <small className={styles.codeChecking}>กำลังตรวจโค้ด…</small>}
            {!isQuoting && codeApplied && (
              <small className={styles.codeOk}>✓ ใช้โค้ด {codeApplied.code} แล้ว · ลด {formatDiscount(codeApplied.cents)}</small>
            )}
            {!isQuoting && codeError && <small className={styles.codeError}>✕ {codeError}</small>}
          </div>

          {isValidTopUp && quoteMatches && (
            <div className={styles.discountSummary}>
              <span>เติม {topUpPoints.toLocaleString()} Point</span>
              <b>฿{formatBaht(quote.baseCents / 100)}</b>
              {quote.promotion && (
                <>
                  <span>ส่วนลดโปร “{quote.promotion.name}”</span>
                  <b>-{formatDiscount(quote.promotion.cents)}</b>
                </>
              )}
              {quote.code && (
                <>
                  <span>ส่วนลดโค้ด {quote.code.code}</span>
                  <b>-{formatDiscount(quote.code.cents)}</b>
                </>
              )}
              <span className={styles.totalLabel}>ยอดที่ต้องโอน</span>
              <strong>฿{formatBaht(quote.chargeCents / 100)}</strong>
              <small className={styles.summaryNote}>
                ตอนสร้าง QR จะมีเศษสตางค์ต่อท้าย (เช่น .37) เพื่อยืนยันการโอนอัตโนมัติ · เศษนี้คืนเป็นเงินส่วนลดให้คุณ
                {quote.discountCents > 0 && quote.chargeCents === quote.minPoints * 100
                  ? ` · ยอดโอนขั้นต่ำ ฿${quote.minPoints} ส่วนลดจึงลดได้ไม่เกินนี้`
                  : ""}
              </small>
            </div>
          )}
          {nextPromotion && isValidTopUp && (
            <p className={styles.promoHint}>
              💡 เติมครบ ฿{(nextPromotion.minAmountCents / 100).toLocaleString("th-TH")} ได้{describeReward(nextPromotion)}
            </p>
          )}

          <p className={styles.payVia}>
            <Image alt="" height={20} src="/icon-thaiqr.png" width={20} /> ชำระผ่าน PromptPay QR · Point เข้าอัตโนมัติหลังโอน
          </p>
          {pendingTopUp?.qrImage && (
          <div className={`${styles.paymentDetail} ${styles.paymentResult}`}>
            {isWaiting && secondsUntilCheck > 0 && <CountdownRing seconds={secondsUntilCheck} total={PAID_BUTTON_DELAY_MS / 1000} />}
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
                    {(pendingTopUp.discountCents ?? 0) > 0
                      ? `ราคา ${formatBaht(pendingTopUp.baseAmount)} − ส่วนลด ${formatBaht((pendingTopUp.discountCents ?? 0) / 100)} = ${formatBaht(pendingTopUp.chargeAmount ?? pendingTopUp.baseAmount)}`
                      : `ยอดหลัก ${formatBaht(pendingTopUp.baseAmount)}`}{" "}
                    + ref .{String(pendingTopUp.refDecimal).padStart(2, "0")}
                  </small>
                  {(pendingTopUp.discountCents ?? 0) > 0 && (
                    <p className={styles.discountNote}>
                      🎁 ลดแล้ว <b>{formatDiscount(pendingTopUp.discountCents)}</b> · ได้ครบ{" "}
                      <b>{pendingTopUp.points.toLocaleString()} Point</b>
                      {(pendingTopUp.promotionRewardCents ?? 0) > 0 && (
                        <>
                          <br />· โปร “{pendingTopUp.promotionName}” -{formatDiscount(pendingTopUp.promotionRewardCents)}
                        </>
                      )}
                      {(pendingTopUp.streamerRewardCents ?? 0) > 0 && (
                        <>
                          <br />· โค้ดส่วนลด -{formatDiscount(pendingTopUp.streamerRewardCents)}
                        </>
                      )}
                    </p>
                  )}
                  <p className={styles.discountNote}>
                    💡 เศษ <b>.{String(pendingTopUp.refDecimal).padStart(2, "0")} บาท</b> จะถูกสะสมเป็น
                    <b> เงินส่วนลด</b> ใช้ลดราคาตอนซื้อแพ็กเกจครั้งถัดไป
                    {user ? <span> · สะสมแล้ว {formatDiscount(user.discountCents)}</span> : null}
                  </p>
                  <em>
                    {pendingTopUp.reference ? <>รหัสรายการ <b>{pendingTopUp.reference}</b> · </> : null}
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
          {isWaiting && secondsUntilCheck === 0 && (
            <div className={styles.paidCheck}>
              <button disabled={checkCooldown > 0} onClick={() => void reportPaid()} type="button">
                {checkCooldown > 0 ? `กำลังตรวจสอบ… (${checkCooldown})` : "ฉันจ่ายเงินแล้ว ยังไม่เข้า"}
              </button>
              {checkNote && <small>{checkNote}</small>}
              <SupportLink label="ยังไม่เข้า? แจ้งทีมงานทาง Discord" />
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
              ? "กำลังสร้าง QR…"
              : !user
                ? "เข้าสู่ระบบเพื่อเติม Point"
                : quoteMatches
                  ? `สร้าง QR ชำระ ฿${formatBaht(quote.chargeCents / 100)}`
                  : "สร้าง QR ชำระเงิน"}{" "}
            <span>→</span>
          </button>
          <div className={styles.supportRow}>
            <SupportLink />
          </div>
        </div>
      </section>
    </main>
  );
}
