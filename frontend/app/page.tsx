"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandLogo } from "./components/BrandLogo";
import { fetchStreamingRooms, type StreamingRoom } from "./lib/api";
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
  const [rooms, setRooms] = useState<StreamingRoom[]>([]);
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

  return (
    <main ref={stageRef} className={styles.scrollStage} data-scroll-stage>
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
            <Link href="/profile">บัญชี</Link>
          </div>
          <Link className={styles.mobileLogin} href="/register">
            เข้าสู่ระบบ
          </Link>
          <a className={styles.navCta} href="#packages">
            <i /> พร้อมเช่า {availableCount} โปรไฟล์
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
              เลือกแพ็กเกจที่มีสต็อกจากโปรไฟล์จริง
              <br className={styles.desktopOnly} /> ระบบล็อกโปรไฟล์ให้ตอนชำระ Point
            </p>
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
              const occupiedCount = Math.max(
                room.capacity - room.availableSlots,
                0,
              );

              return (
                <Link className={styles.roomCard} key={room.id} href="/shop">
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
                        {room.slots.slice(0, room.capacity).map((slot) => (
                          <i
                            className={slot.isAvailable ? styles.capacityOpen : styles.capacityUsed}
                            key={slot.id}
                          />
                        ))}
                      </span>
                      ผู้ใช้งาน {occupiedCount}/{room.capacity}
                    </span>
                    <strong>{room.name}</strong>
                    <em>{room.label}</em>
                  </span>
                  <span className={styles.selectedBadge}>
                    ดู Slot ในห้อง →
                  </span>
                </Link>
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
      </RevealSection>
      <footer className={styles.footer}>
        <a className={styles.brand} href="#home">
          <BrandLogo />
        </a>
        <p>บริการช่วยจัดการการเข้าถึงความบันเทิงออนไลน์</p>
        <p>© 2026 Fast Movie</p>
      </footer>
    </main>
  );
}
