"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandLogo } from "./components/BrandLogo";
import { ThemeToggle } from "./components/ThemeToggle";
import { fetchStreamingRooms, type StreamingRoom } from "./lib/api";
import { useSession } from "./providers";
import { publicProfileLabel, unavailableSlotLabel } from "./lib/slots";
import { SupportLink } from "./components/SupportLink";
import styles from "./page.module.css";

const HIGHLIGHTS = [
  ["⚡", "เสร็จใน 3 นาที"],
  ["💸", "เริ่มแค่ 12 บาท"],
  ["🤖", "ระบบ Auto"],
  ["🙋", "มีแอดมินช่วย"],
] as const;

const ROOM_TONES = [styles.tonePurple, styles.tonePink, styles.toneCyan, styles.toneLime];

const STEPS = [
  ["💰", "เติม Point", "จ่ายผ่าน PromptPay หรือ Wallet ได้เลย"],
  ["👀", "เลือกห้อง + โปรไฟล์", "เห็นชัดๆ ว่าโปรไฟล์ไหนยังว่างอยู่"],
  ["🍿", "เลือกโปร แล้วดูเลย", "ระบบล็อกโปรไฟล์ แล้วโชว์ข้อมูลเข้าดูให้ทันที"],
] as const;

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
  const { user } = useSession();
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
      <main ref={stageRef} className={`${styles.palette} ${styles.scrollStage}`}>
        <section className={styles.hero} id="home">
          <div className={styles.heroParallax} aria-hidden="true" />
          <nav className={styles.nav} aria-label="เมนูหลัก">
            <a className={styles.brand} href="#home">
              <BrandLogo />
            </a>
            <div className={styles.navLinks}>
              <a href="#packages">ห้องว่าง</a>
              <a href="#how-it-works">วิธีใช้</a>
              <a href="#faq">ถาม-ตอบ</a>
              <Link href="/shop">ร้านค้า</Link>
              {user?.resellerRole && <Link href="/resellers">ตัวแทนจำหน่าย</Link>}
              <Link href="/profile">บัญชีฉัน</Link>
            </div>
            <div className={styles.headerActions}>
              <ThemeToggle />
              <Link className={styles.mobileLogin} href="/register">
                เข้าสู่ระบบ
              </Link>
              <a className={styles.navCta} href="#packages">
                <i /> ว่าง {availableCount} ที่
              </a>
            </div>
          </nav>
          <div className={styles.heroContent}>
            <div>
              <p className={styles.heroTag}>🍿 Movie night mode: ON</p>
              <h1>
                คืนนี้
                <br />
                <mark>ดูอะไรดี?</mark>
              </h1>
              <div className={styles.heroActions}>
                <a className={styles.primaryButton} href="#packages">
                  เลือกห้องเลย <span aria-hidden="true">🎬</span>
                </a>
                <a className={styles.ghostButton} href="#how-it-works">
                  ใช้ยังไงนะ?
                </a>
              </div>
              <ul className={styles.trustRow}>
                {HIGHLIGHTS.map(([icon, text]) => (
                  <li key={text}>
                    <span aria-hidden="true">{icon}</span>
                    {text}
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.heroArt} aria-hidden="true">
              <div className={styles.heroPoster}>
                <div className={styles.posterSheen} />
                <p>
                  NOW
                  <br />
                  <b>PLAYING</b>
                </p>
                <div className={styles.posterLight} />
                <div className={styles.posterTicket}>
                  <span>ADMIT ONE</span>
                  <strong>FAST MOVIE</strong>
                </div>
              </div>
              <span className={`${styles.sticker} ${styles.stickerPrice}`}>
                เริ่ม
                <b>12฿</b>
              </span>
              <span className={`${styles.sticker} ${styles.stickerSeats}`}>
                ว่าง {availableCount} ที่!
              </span>
              <span className={`${styles.sticker} ${styles.stickerEmoji}`}>🍿</span>
            </div>
          </div>
        </section>

        <div className={styles.marquee} aria-hidden="true">
          <div className={styles.marqueeTrack}>
            {Array.from({ length: 2 }, (_, copy) => (
              <span key={copy}>
                {HIGHLIGHTS.map(([icon, text]) => (
                  <span key={text}>
                    {icon} {text} <b>✦</b>
                  </span>
                ))}
                <span>
                  🎬 คืนนี้ดูอะไรดี? <b>✦</b>
                </span>
              </span>
            ))}
          </div>
        </div>

        <RevealSection
          className={`${styles.section} ${styles.roomsSection}`}
          id="packages"
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>STEP 1 · เลือกห้อง</p>
            <h2>ห้องไหนยังว่าง? 👀</h2>
            <p>
              กดเข้าห้องแล้วเลือกโปรไฟล์ที่ว่าง ส่วนโปรรายวัน รายสัปดาห์ หรือรายเดือน
              ค่อยเลือกในขั้นต่อไป
            </p>
          </div>
          <div className={styles.roomGrid}>
            {roomsLoading ? (
              Array.from({ length: 3 }, (_, index) => (
                <div className={styles.roomSkeleton} key={index} />
              ))
            ) : rooms.length === 0 ? (
              <p className={styles.roomsEmpty}>
                <span aria-hidden="true">😅</span>
                ตอนนี้ยังไม่มีห้องว่างเลย ลองแวะมาใหม่อีกทีนะ
              </p>
            ) : (
              rooms.map((room, index) => {
                const isOpen = room.availableSlots > 0;

                return (
                  <button
                    aria-haspopup="dialog"
                    aria-label={`เลือกโปรไฟล์ใน ${room.name}`}
                    className={`${styles.roomCard} ${ROOM_TONES[index % ROOM_TONES.length]}`}
                    key={room.id}
                    onClick={() => setActiveRoom(room)}
                    type="button"
                  >
                    <span className={styles.roomBanner}>
                      <span className={styles.roomIndex}>
                        #{String(index + 1).padStart(2, "0")}
                      </span>
                      <span className={styles.roomMark}>
                        {room.service.slice(0, 1).toUpperCase()}
                      </span>
                      <span className={styles.roomService}>{room.service}</span>
                    </span>

                    <span className={styles.roomBody}>
                      <small className={isOpen ? styles.roomOpen : styles.roomFull}>
                        <i aria-hidden="true" />
                        {isOpen ? `ว่าง ${room.availableSlots} ที่` : "เต็มแล้ว 😢"}
                      </small>
                      <strong>{room.name}</strong>
                      <em>{room.label}</em>
                      <span className={styles.roomCapacity}>
                        <span className={styles.capacityDots} aria-hidden="true">
                          <CapacityDots room={room} />
                        </span>
                        มีคนใช้ {room.occupiedSlots}/{room.capacity}
                      </span>
                    </span>
                    <span className={styles.roomCta}>
                      {isOpen ? "เข้าห้องเลย" : "ดูในห้อง"} <b aria-hidden="true">→</b>
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
            <h2>ง่ายแค่ 3 สเต็ป ✌️</h2>
          </div>
          <ol className={styles.steps}>
            {STEPS.map(([icon, title, copy], index) => (
              <li key={title}>
                <span className={styles.stepIcon} aria-hidden="true">
                  {icon}
                </span>
                <span className={styles.stepNumber}>{index + 1}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </li>
            ))}
          </ol>
        </RevealSection>

        <RevealSection className={`${styles.section} ${styles.faq}`} id="faq">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>FAQ</p>
            <h2>สงสัยอะไร ถามได้เลย 💬</h2>
          </div>
          <div className={styles.faqList}>
            <details>
              <summary>ทำไมต้องเลือกห้องก่อนล่ะ?</summary>
              <p>
                จะได้เห็นว่าแต่ละบัญชีมีโปรไฟล์ไหนว่างจริงๆ แล้วเลือกโปรที่เหมาะกับโปรไฟล์นั้นได้เอง
              </p>
            </details>
            <details>
              <summary>เติม Point แล้ว ต้องทำอะไรต่อ?</summary>
              <p>
                เลือกห้อง เลือกโปรไฟล์ แล้วเลือกโปรที่อยากได้ ระบบจะหัก Point และล็อกโปรไฟล์ให้ทันที
              </p>
            </details>
          </div>
          <div className={styles.faqSupport}>
            <p>ยังไม่เจอคำตอบ หรือติดปัญหาตรงไหน? ทักแอดมินได้เลย 🙌</p>
            <SupportLink />
          </div>
        </RevealSection>

        <footer className={styles.footer}>
          <a className={styles.brand} href="#home">
            <BrandLogo />
          </a>
          <p>ทำให้คืนดูหนังของคุณง่ายขึ้น 🍿</p>
          <p>© 2026 Fast Movie</p>
        </footer>
      </main>
      {activeRoom && (
        <dialog
          aria-labelledby="slot-dialog-title"
          className={`${styles.palette} ${styles.slotDialog}`}
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
            <div className={styles.slotServiceMark} aria-hidden="true">
              {activeRoom.service.slice(0, 1).toUpperCase()}
            </div>
            <div className={styles.slotDialogTitle}>
              <p className={styles.eyebrow}>{activeRoom.service}</p>
              <h2 id="slot-dialog-title">{activeRoom.name}</h2>
              <p className={styles.slotDialogSubtitle}>{activeRoom.label}</p>
            </div>
            <button
              aria-label="ปิด"
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
              <span
                className={
                  activeRoom.availableSlots > 0
                    ? styles.slotSummaryOpen
                    : styles.slotSummaryFull
                }
              >
                <i aria-hidden="true" />
                {activeRoom.availableSlots > 0
                  ? "มีที่ว่างรอคุณอยู่ ✨"
                  : "ห้องนี้เต็มแล้ว 😢"}
              </span>
              <div className={styles.slotUsage}>
                <span className={styles.capacityDots} aria-hidden="true">
                  <CapacityDots room={activeRoom} />
                </span>
                <small>
                  มีคนใช้ <b>{activeRoom.occupiedSlots}/{activeRoom.capacity}</b>
                </small>
              </div>
            </div>
            <div className={styles.slotChoiceHeading}>
              <h3>จะเอาโปรไฟล์ไหนดี?</h3>
              <span>ว่าง {activeRoom.availableSlots}</span>
            </div>
            <div className={styles.slotChoices}>
              {activeRoom.slots.map((slot, index) => {
                const lowestPackage = slot.availablePackages[0];
                const canChoose = slot.isAvailable && Boolean(lowestPackage);
                const profileLabel = publicProfileLabel(index);
                const slotStatus = slot.isAvailable
                  ? "ยังไม่มีโปรให้เลือก"
                  : unavailableSlotLabel(slot.status);

                return canChoose ? (
                  <Link
                    className={styles.slotChoice}
                    href={`/checkout?room=${encodeURIComponent(activeRoom.id)}&profile=${encodeURIComponent(slot.id)}`}
                    key={slot.id}
                  >
                    <span className={styles.slotChoiceIcon} aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className={styles.slotChoiceInfo}>
                      <strong>{profileLabel}</strong>
                      <small>ว่างอยู่ · เริ่ม {lowestPackage.priceAmount.toLocaleString()} PT</small>
                    </span>
                    <span className={styles.slotChoiceArrow} aria-hidden="true">→</span>
                  </Link>
                ) : (
                  <div className={`${styles.slotChoice} ${styles.slotChoiceUnavailable}`} key={slot.id}>
                    <span className={styles.slotChoiceIcon} aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className={styles.slotChoiceInfo}>
                      <strong>{profileLabel}</strong>
                      <small>{slotStatus}</small>
                    </span>
                    <span className={styles.slotUnavailableLabel}>ไม่ว่าง</span>
                  </div>
                );
              })}
            </div>
            <p className={styles.slotDialogNote}>
              กดเลือกโปรไฟล์ แล้วไปเลือกโปรกับจ่าย Point ต่อได้เลย 👉
            </p>
          </div>
        </dialog>
      )}
    </>
  );
}
