"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./page.module.css";

const rooms = [
  {
    id: "room-1",
    name: "ROOM 01",
    label: "MIDNIGHT",
    available: true,
    members: 1,
    capacity: 4,
  },
  {
    id: "room-2",
    name: "ROOM 02",
    label: "VIOLET",
    available: true,
    members: 2,
    capacity: 4,
  },
  {
    id: "room-3",
    name: "ROOM 03",
    label: "SUNSET",
    available: true,
    members: 0,
    capacity: 4,
  },
  {
    id: "room-4",
    name: "ROOM 04",
    label: "NIGHT OUT",
    available: false,
    members: 4,
    capacity: 4,
  },
  {
    id: "room-5",
    name: "ROOM 05",
    label: "LATE SHOW",
    available: true,
    members: 3,
    capacity: 4,
  },
  {
    id: "room-6",
    name: "ROOM 06",
    label: "CINEMA",
    available: true,
    members: 2,
    capacity: 4,
  },
];

const plans = [
  {
    id: "day",
    name: "รายวัน",
    price: 10,
    duration: "24 ชั่วโมง",
    tag: "เริ่มต้นง่าย",
  },
  {
    id: "week",
    name: "รายสัปดาห์",
    price: 49,
    duration: "7 วัน",
    tag: "คุ้มค่า",
  },
  {
    id: "month",
    name: "รายเดือน",
    price: 129,
    duration: "30 วัน",
    tag: "ขายดี",
  },
];

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

    const scrollRoot = section.closest<HTMLElement>("[data-scroll-stage]");
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting || entry.intersectionRatio > 0);
      },
      {
        root: scrollRoot,
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

export default function Home() {
  const stageRef = useRef<HTMLElement>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let frameId = 0;
    const updateParallax = () => {
      frameId = 0;
      const heroScroll = Math.min(stage.scrollTop, stage.clientHeight);
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
    stage.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      stage.removeEventListener("scroll", onScroll);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, []);

  function selectRoom(roomId: string) {
    setSelectedRoomId(roomId);
    window.setTimeout(() => {
      document
        .getElementById("plans")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  return (
    <main ref={stageRef} className={styles.scrollStage} data-scroll-stage>
      <section className={styles.hero} id="home">
        <div className={styles.heroParallax} aria-hidden="true" />
        <nav className={styles.nav} aria-label="เมนูหลัก">
          <a className={styles.brand} href="#home">
            <span>F</span> Fast Movie
          </a>
          <div className={styles.navLinks}>
            <a href="#rooms">เลือกห้อง</a>
            <a href="#how-it-works">ขั้นตอน</a>
            <a href="#faq">ช่วยเหลือ</a>
            <Link href="/profile">บัญชี</Link>
          </div>
          <a className={styles.navCta} href="#rooms">
            <i /> ห้องว่าง 5 ห้อง
          </a>
        </nav>
        <div className={styles.heroContent}>
          <div>
            <p className={styles.eyebrow}>YOUR MOVIE NIGHT STARTS HERE</p>
            <h1>
              คืนนี้มีเรื่องให้ดู
              <br />
              <em>แล้วหรือยัง?</em>
            </h1>
            <p className={styles.lead}>
              เลือกห้องที่ว่างก่อน แล้วค่อยเลือกโปรที่เหมาะกับคุณ
              <br className={styles.desktopOnly} /> จบในไม่กี่ขั้นตอน
            </p>
            <a className={styles.primaryButton} href="#rooms">
              เลือกห้องของคุณ <span>→</span>
            </a>
            <div className={styles.trustRow}>
              <span>ตอบกลับเร็ว</span>
              <span>ราคาเริ่ม 10 บาท</span>
              <span>มีแอดมินดูแล</span>
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
            <span>
              FAST
              <br />
              MOVIE
            </span>
          </div>
        </div>
      </section>

      <RevealSection
        className={`${styles.section} ${styles.roomsSection}`}
        id="rooms"
      >
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>01 — PICK A ROOM</p>
          <h2>เลือกห้องที่ว่าง</h2>
          <p>เลือก Room ก่อน แล้วค่อยเลือกโปรในขั้นตอนถัดไป</p>
        </div>
        <div className={styles.roomGrid}>
          {rooms.map((room, index) => (
            <button
              className={`${styles.roomCard} ${selectedRoomId === room.id ? styles.roomSelected : ""} ${!room.available ? styles.roomUnavailable : ""}`}
              key={room.id}
              type="button"
              disabled={!room.available}
              onClick={() => selectRoom(room.id)}
              aria-pressed={selectedRoomId === room.id}
            >
              <span className={styles.roomIndex}>0{index + 1}</span>
              <span className={styles.netflixMark}>N</span>
              <span className={styles.nowPlaying}>
                FAST
                <br />
                <b>Movie</b>
              </span>

              <span className={styles.roomFooter}>
                <small>
                  {room.available ? "พร้อมใช้งาน" : "ไม่พร้อมใช้งาน"}
                </small>
                <span className={styles.roomCapacity}>
                  <span className={styles.capacityDots} aria-hidden="true">
                    {Array.from({ length: room.capacity }, (_, member) => (
                      <i
                        className={
                          member < room.members ? styles.capacityUsed : ""
                        }
                        key={member}
                      />
                    ))}
                  </span>
                  ใช้งาน {room.members} / {room.capacity} คน
                </span>
                <strong>{room.name}</strong>
                {/* <em>{room.label}</em> */}
              </span>
              {selectedRoomId === room.id && (
                <span className={styles.selectedBadge}>เลือกแล้ว ✓</span>
              )}
            </button>
          ))}
        </div>
      </RevealSection>

      {selectedRoom && (
        <RevealSection className={styles.planSection} id="plans">
          <div className={styles.planHeader}>
            <div>
              <p className={styles.eyebrow}>02 — PICK A PLAN</p>
              <h2>เลือกโปรสำหรับ {selectedRoom.name}</h2>
            </div>
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById("rooms")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              เปลี่ยนห้อง
            </button>
          </div>
          <div className={styles.planGrid}>
            {plans.map((plan) => (
              <article className={styles.planCard} key={plan.id}>
                <p>{plan.tag}</p>
                <h3>{plan.name}</h3>
                <strong>
                  {plan.price}
                  <small> บาท</small>
                </strong>
                <span>{plan.duration}</span>
                <Link href={`/payment?plan=${plan.id}&room=${selectedRoom.id}`}>
                  เลือกโปรนี้ <b>→</b>
                </Link>
              </article>
            ))}
          </div>
        </RevealSection>
      )}

      <RevealSection className={styles.section} id="how-it-works">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>HOW IT WORKS</p>
          <h2>เลือกห้อง เลือกโปร ชำระเงิน</h2>
        </div>
        <div className={styles.steps}>
          {[
            ["01", "เลือกห้อง", "เลือกจาก Room ที่ยังว่าง"],
            ["02", "เลือกโปร", "เลือกระยะเวลาที่เหมาะกับคุณ"],
            ["03", "ชำระเงิน", "เลือก PromptPay หรือ Wallet"],
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
            <p>เพื่อให้ระบบล็อก Room ที่ว่างให้คุณก่อนเลือกโปรและไปชำระเงิน</p>
          </details>
          <details>
            <summary>หลังชำระเงินต้องทำอะไรต่อ?</summary>
            <p>
              เก็บหลักฐานการชำระเงินไว้
              แล้วส่งให้แอดมินตามช่องทางที่ระบุในหน้าชำระเงิน
            </p>
          </details>
        </div>
      </RevealSection>
      <footer className={styles.footer}>
        <a className={styles.brand} href="#home">
          <span>F</span> Fast Movie
        </a>
        <p>บริการช่วยจัดการการเข้าถึงความบันเทิงออนไลน์</p>
        <p>© 2026 Fast Movie</p>
      </footer>
    </main>
  );
}
