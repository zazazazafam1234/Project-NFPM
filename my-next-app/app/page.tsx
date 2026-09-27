"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchPackages, type StreamingPackage } from "./lib/api";
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
  const [packages, setPackages] = useState<StreamingPackage[]>([]);
  const availableCount = packages.reduce(
    (total, item) => total + item.availableStock,
    0,
  );

  useEffect(() => {
    void fetchPackages().then(setPackages).catch(() => undefined);
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
            <span>F</span> Fast Movie
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
          <p className={styles.eyebrow}>01 — PICK A PACKAGE</p>
          <h2>เลือกแพ็กเกจที่พร้อมใช้งาน</h2>
          <p>Stock มาจาก Profile ที่ว่างภายใต้ Email แม่ที่ยัง Active</p>
        </div>
        <div className={styles.roomGrid}>
          {packages.map((pkg, index) => (
            <Link
              className={`${styles.roomCard} ${pkg.availableStock <= 0 ? styles.roomUnavailable : ""}`}
              key={pkg.id}
              href={
                pkg.availableStock > 0
                  ? `/checkout?package=${pkg.slug}`
                  : "/payment"
              }
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
                  {pkg.availableStock > 0 ? "พร้อมเช่า" : "รอเติมสต็อก"}
                </small>
                <span className={styles.roomCapacity}>
                  <span className={styles.capacityDots} aria-hidden="true">
                    {Array.from({ length: 4 }, (_, member) => (
                      <i
                        className={
                          member >= Math.min(pkg.availableStock, 4)
                            ? styles.capacityUsed
                            : ""
                        }
                        key={member}
                      />
                    ))}
                  </span>
                  เหลือ {pkg.availableStock} โปรไฟล์
                </span>
                <strong>{pkg.name}</strong>
                <em>
                  {pkg.priceAmount} Point · {pkg.durationDays} วัน
                </em>
              </span>
              <span className={styles.selectedBadge}>
                {pkg.availableStock > 0 ? "เลือกโปรนี้ →" : "เติม Point / แจ้งแอดมิน"}
              </span>
            </Link>
          ))}
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
            ["02", "เลือกแพ็กเกจ", "ระบบนับ stock จาก Profile ที่ว่าง"],
            ["03", "รับข้อมูล", "ระบบล็อกโปรไฟล์และแสดงข้อมูลเข้าชม"],
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
            <p>ระบบใหม่ไม่ต้องเลือกห้องเองแล้ว ระบบจะเลือก Profile ที่ว่างและล็อกให้ใน Transaction เดียว</p>
          </details>
          <details>
            <summary>หลังเติม Pointต้องทำอะไรต่อ?</summary>
            <p>
              เลือกโปรที่ต้องการ แล้วระบบจะหัก Point อัตโนมัติ และล็อก Room ให้คุณทันที
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
