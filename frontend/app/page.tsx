"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandLogo } from "./components/BrandLogo";
import { ThemeToggle } from "./components/ThemeToggle";
import { fetchStreamingRooms, type StreamingRoom } from "./lib/api";
import { publicProfileLabel, unavailableSlotLabel } from "./lib/slots";
import { SupportLink } from "./components/SupportLink";
import styles from "./page.module.css";

type RevealSectionProps = {
  children: ReactNode;
  className: string;
  id: string;
};

function RevealSection({ children, className, id }: RevealSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting || entry.intersectionRatio > 0);
      },
      {
        rootMargin: "0px 0px -1px 0px",
        threshold: 0,
      },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className={`${className} ${styles.scrollReveal} ${isVisible ? styles.revealed : ""}`}
      id={id}
    >
      {children}
    </section>
  );
}

function CapacityDots({ room }: { room: StreamingRoom }) {
  return (
    <>
      {Array.from({ length: room.capacity }, (_, index) => {
        const slot = room.slots[index];
        const className = slot
          ? slot.isAvailable
            ? styles.capacityOpen
            : styles.capacityUsed
          : styles.capacityEmpty;

        return <i className={className} key={slot?.id ?? `empty-${index}`} />;
      })}
    </>
  );
}

export default function Home() {
  const stageRef = useRef<HTMLElement>(null);
  const slotDialogRef = useRef<HTMLDialogElement>(null);
  const [rooms, setRooms] = useState<StreamingRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<StreamingRoom | null>(null);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const availableCount = rooms.reduce(
    (total, room) => total + room.availableSlots,
    0,
  );

  useEffect(() => {
    fetchStreamingRooms()
      .then(setRooms)
      .catch(() => undefined)
      .finally(() => setRoomsLoading(false));
  }, []);

  useEffect(() => {
    const dialog = slotDialogRef.current;
    if (activeRoom && dialog && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => dialog.scrollTo(0, 0));
    }
  }, [activeRoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let frameId = 0;
    const updateParallax = () => {
      frameId = 0;
      const heroScroll = Math.min(window.scrollY, window.innerHeight);
      stage.style.setProperty("--hero-parallax-y", `${heroScroll * -0.18}px`);
      stage.style.setProperty(
        "--hero-parallax-rotate",
        `${heroScroll * 0.012}deg`,
      );
    };

    const onScroll = () => {
      if (!frameId) frameId = window.requestAnimationFrame(updateParallax);
    };

    updateParallax();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <>
      <main ref={stageRef} className={styles.scrollStage}>
      <section className={styles.hero} id="home">
        <div className={styles.heroParallax} aria-hidden="true" />
        <nav className={styles.nav} aria-label="เมนูหลัก">
          <a className={styles.brand} href="#home">
            <BrandLogo />
          </a>
          <div className={styles.navLinks}>
            <a href="#packages">แพ็กเกจ</a>
            <a href="#how-it-works">ขั้นตอน</a>
            <a href="#faq">ช่วยเหลือ</a>
            <Link href="/shop">ร้านค้า</Link>
            <Link href="/resellers">ตัวแทนจำหน่าย</Link>
            <Link href="/profile">บัญชี</Link>
          </div>
          <div className={styles.headerActions}>
            <ThemeToggle />
            <Link className={styles.mobileLogin} href="/register">
              เข้าสู่ระบบ
            </Link>
            <a className={styles.navCta} href="#packages">
              <i /> พร้อมเช่า {availableCount} โปรไฟล์
            </a>
          </div>
        </nav>
        <div className={styles.heroContent}>
          <div>
            <p className={styles.eyebrow}>YOUR MOVIE NIGHT STARTS HERE</p>
            <h1>
              คืนนี้มีเรื่องให้ดู
              <br />
              <em>แล้วหรือยัง?</em>
            </h1>
            <a className={styles.primaryButton} href="#packages">
              เลือกแพ็กเกจ <span>→</span>
            </a>
            <div className={styles.trustRow}>
              <span>จบใน 3 นาที</span>
              <span>ราคาเริ่ม 12 บาท</span>
              <span>มีแอดมินดูแล</span>
              <span>ระบบ Auto</span>
            </div>
          </div>
          <div className={styles.heroPoster} aria-hidden="true">
            <div className={styles.posterSheen} />
            <div className={styles.posterLight} />
            <p>
              NOW
              <br />
              <b>PLAYING</b>
            </p>
            <span className="on-accent">
              FAST
              <br />
              MOVIE
            </span>
          </div>
        </div>
      </section>

      <RevealSection
        className={`${styles.section} ${styles.roomsSection}`}
        id="packages"
      >
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>01 — PICK A ROOM</p>
          <h2>เลือกห้อง แล้วเลือก Slot ที่ว่าง</h2>
          <p>หลังเลือก Slot แล้วค่อยเลือกโปรรายวัน รายสัปดาห์ หรือรายเดือนในขั้นตอนถัดไป</p>
        </div>
        <div className={styles.roomGrid}>
          {roomsLoading ? (
            Array.from({ length: 3 }, (_, index) => (
              <div className={styles.roomSkeleton} key={index} />
            ))
          ) : rooms.length === 0 ? (
            <p className={styles.roomsEmpty}>ยังไม่มีห้องที่พร้อมใช้งาน</p>
          ) : (
            rooms.map((room, index) => {
              const occupiedCount = room.occupiedSlots;

              return (
                <button
                  aria-haspopup="dialog"
                  aria-label={`เลือก Slot ใน ${room.name}`}
                  className={styles.roomCard}
                  key={room.id}
                  onClick={() => setActiveRoom(room)}
                  type="button"
                >
                  <span className={styles.roomIndex}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className={styles.netflixMark}>
                    {room.service.slice(0, 1).toUpperCase()}
                  </span>
                  <span className={styles.nowPlaying}>
                    ROOM
                    <br />
                    <b>{room.service}</b>
                  </span>

                  <span className={styles.roomFooter}>
                    <small
                      className={
                        room.availableSlots > 0 ? styles.roomOpen : styles.roomFull
                      }
                    >
                      <i aria-hidden="true" />
                      {room.availableSlots > 0 ? "มี Slot ว่าง" : "เต็มแล้ว"}
                    </small>
                    <span className={styles.roomCapacity}>
                      <span className={styles.capacityDots} aria-hidden="true">
                        <CapacityDots room={room} />
                      </span>
                      ผู้ใช้งาน {occupiedCount}/{room.capacity}
                    </span>
                    <strong>{room.name}</strong>
                    <em>{room.label}</em>
                  </span>
                  <span className={styles.selectedBadge}>
                    เลือก Slot ในห้อง →
                  </span>
                </button>
              );
            })
          )}
        </div>
      </RevealSection>

      <RevealSection className={styles.section} id="how-it-works">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>HOW IT WORKS</p>
          <h2>เติม Point เลือกห้อง เลือกโปร</h2>
        </div>
        <div className={styles.steps}>
          {[
            ["01", "เติม Point", "เลือก PromptPay หรือ Wallet"],
            ["02", "เลือกห้องและ Slot", "เห็นชัดว่า Profile ไหนยังว่าง"],
            ["03", "เลือกโปรและรับข้อมูล", "ระบบล็อกโปรไฟล์และแสดงข้อมูลเข้าชม"],
          ].map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </RevealSection>
      <RevealSection className={`${styles.section} ${styles.faq}`} id="faq">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>FAQ</p>
          <h2>คำถามที่พบบ่อย</h2>
        </div>
        <div className={styles.faqList}>
          <details>
            <summary>ทำไมต้องเลือกห้องก่อน?</summary>
            <p>เพื่อให้เห็น slot ที่ว่างจริงในแต่ละบัญชี แล้วเลือกโปรที่เหมาะกับ slot นั้นได้เอง</p>
          </details>
          <details>
            <summary>หลังเติม Pointต้องทำอะไรต่อ?</summary>
            <p>
              เลือกห้อง เลือก slot แล้วเลือกโปรที่ต้องการ ระบบจะหัก Point และล็อก profile ให้ทันที
            </p>
          </details>
        </div>
        <div className={styles.faqSupport}>
          <p>ยังหาคำตอบไม่เจอ หรือมีปัญหาการใช้งาน?</p>
          <SupportLink />
        </div>
      </RevealSection>
      <footer className={styles.footer}>
        <a className={styles.brand} href="#home">
          <BrandLogo />
        </a>
        <p>บริการช่วยจัดการการเข้าถึงความบันเทิงออนไลน์</p>
        <p>© 2026 Fast Movie</p>
      </footer>
      </main>
      {activeRoom && (
        <dialog
          aria-labelledby="slot-dialog-title"
          className={styles.slotDialog}
          onCancel={(event) => {
            event.preventDefault();
            setActiveRoom(null);
          }}
          onClose={() => setActiveRoom(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setActiveRoom(null);
          }}
          ref={slotDialogRef}
        >
          <div className={styles.slotDialogHeader}>
            <div className={styles.slotDialogTitle}>
              <p className={styles.eyebrow}>01 — SELECT A SLOT</p>
              <h2 id="slot-dialog-title">{activeRoom.name}</h2>
              <p className={styles.slotDialogSubtitle}>{activeRoom.label}</p>
            </div>
            <button
              aria-label="ปิดหน้าต่าง"
              autoFocus
              className={styles.slotDialogClose}
              onClick={() => setActiveRoom(null)}
              type="button"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className={styles.slotDialogBody}>
            <div className={styles.slotRoomPanel}>
              <div className={styles.slotServiceMark} aria-hidden="true">
                {activeRoom.service.slice(0, 1).toUpperCase()}
              </div>
              <div className={`${styles.slotRoomStatus} on-accent`}>
                <span className={activeRoom.availableSlots > 0 ? styles.slotSummaryOpen : styles.slotSummaryFull}>
                  <i aria-hidden="true" />
                  {activeRoom.availableSlots > 0 ? "พร้อมเลือก Slot" : "ห้องเต็มแล้ว"}
                </span>
                <strong>{activeRoom.service}</strong>
                <small>{activeRoom.label}</small>
              </div>
              <div className={styles.slotUsage}>
                <span className={styles.capacityDots} aria-hidden="true">
                  <CapacityDots room={activeRoom} />
                </span>
                <b>{activeRoom.occupiedSlots}/{activeRoom.capacity}</b>
                <small>ผู้ใช้งาน</small>
              </div>
            </div>
            <div className={styles.slotChoiceHeading}>
              <div>
                <p>AVAILABLE PROFILES</p>
                <h3>เลือก Slot ที่ว่าง</h3>
              </div>
              <span>{activeRoom.availableSlots} ว่าง</span>
            </div>
            <div className={styles.slotChoices}>
              {activeRoom.slots.map((slot, index) => {
                const lowestPackage = slot.availablePackages[0];
                const canChoose = slot.isAvailable && Boolean(lowestPackage);
                const profileLabel = publicProfileLabel(index);
                const slotStatus = slot.isAvailable
                  ? "ไม่มีโปรโมชัน"
                  : unavailableSlotLabel(slot.status);

                return canChoose ? (
                  <Link
                    className={styles.slotChoice}
                    href={`/checkout?room=${encodeURIComponent(activeRoom.id)}&profile=${encodeURIComponent(slot.id)}`}
                    key={slot.id}
                  >
                    <span className={styles.slotChoiceIcon} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.slotChoiceInfo}>
                      <strong>{profileLabel}</strong>
                      <small>ว่าง · เริ่ม {lowestPackage.priceAmount.toLocaleString()} PT</small>
                    </span>
                    <span className={styles.slotChoiceArrow} aria-hidden="true">→</span>
                  </Link>
                ) : (
                  <div className={`${styles.slotChoice} ${styles.slotChoiceUnavailable}`} key={slot.id}>
                    <span className={styles.slotChoiceIcon} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.slotChoiceInfo}>
                      <strong>{profileLabel}</strong>
                      <small>{slotStatus}</small>
                    </span>
                    <span className={styles.slotUnavailableLabel}>ไม่พร้อมใช้งาน</span>
                  </div>
                );
              })}
            </div>
            <p className={styles.slotDialogNote}>
              เลือก Slot เพื่อไปยังหน้าตรวจสอบโปรและชำระด้วย Point
            </p>
          </div>
        </dialog>
      )}
    </>
  );
}
