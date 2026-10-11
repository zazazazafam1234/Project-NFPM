"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import { fetchStreamingRooms, type StreamingRoom } from "../lib/api";
import { useSession } from "../providers";
import { publicProfileLabel, unavailableSlotLabel } from "../lib/slots";
import styles from "./page.module.css";

const ROOM_TONES = [styles.tonePurple, styles.tonePink, styles.toneCyan, styles.toneLime];

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

export default function ShopPage() {
  const { user } = useSession();
  const [rooms, setRooms] = useState<StreamingRoom[]>([]);
  const [service, setService] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStreamingRooms()
      .then(setRooms)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const services = useMemo(
    () => Array.from(new Set(rooms.map((room) => room.service))),
    [rooms],
  );
  const visibleRooms = service
    ? rooms.filter((room) => room.service === service)
    : rooms;
  const totalSlots = visibleRooms.reduce(
    (total, room) => total + room.availableSlots,
    0,
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <BrandLogo />
        </Link>
        <nav className={styles.navLinks} aria-label="เมนูหลัก">
          <Link href="/#packages">ห้องว่าง</Link>
          <Link href="/#how-it-works">วิธีใช้</Link>
          <Link href="/#faq">ถาม-ตอบ</Link>
          <Link href="/shop" aria-current="page">
            ร้านค้า
          </Link>
          <Link href="/profile">บัญชีฉัน</Link>
        </nav>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <Link className={styles.mobileLogin} href="/register">
            เข้าสู่ระบบ
          </Link>
          <div className={styles.pointsBadge}>
            <span>✦</span>
            {user ? user.points.toLocaleString() : "—"}
            <small>PT</small>
          </div>
        </div>
      </header>

      <div className={styles.hero}>
        <div className={styles.heroAura} aria-hidden="true" />
        <p className={styles.eyebrow}>🛍️ ร้านค้า</p>
        <h1>เลือกห้องที่ใช่<br /><mark>แล้วจองโปรไฟล์เลย</mark></h1>
        <p>โปรไฟล์ที่มีจุดสีเขียวคือยังว่างอยู่ กดเลือกได้เลย แล้วค่อยไปเลือกโปรที่ชอบในขั้นต่อไป</p>
        <div className={styles.heroStats}>
          <span><i aria-hidden="true" />ว่าง {totalSlots} โปรไฟล์</span>
          <span>🎬 {visibleRooms.length} ห้อง</span>
        </div>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <p className={styles.sideLabel}>เลือกดูตามแอป</p>
          <ul className={styles.catList}>
            <li>
              <button
                className={!service ? styles.catActive : styles.catBtn}
                type="button"
                onClick={() => setService(null)}
              >
                <span aria-hidden="true">✨</span>
                <span>ทั้งหมด</span>
                <small>{rooms.length}</small>
              </button>
            </li>
            {services.map((item) => (
              <li key={item}>
                <button
                  className={service === item ? styles.catActive : styles.catBtn}
                  type="button"
                  onClick={() => setService(item)}
                >
                  <span aria-hidden="true">{item.slice(0, 1).toUpperCase()}</span>
                  <span>{item.toUpperCase()}</span>
                  <small>{rooms.filter((room) => room.service === item).length}</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className={styles.main}>
          <div className={styles.gridHeader}>
            <h2>{service ? `ห้อง ${service.toUpperCase()} 🎬` : "ห้องทั้งหมด 🎬"}</h2>
            <span className={styles.count}>ว่าง {totalSlots} ที่</span>
          </div>

          {loading ? (
            <div className={styles.skeleton}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={styles.skeletonCard} />
              ))}
            </div>
          ) : visibleRooms.length === 0 ? (
            <p className={styles.empty}>
              <span aria-hidden="true">😅</span>
              ยังไม่มีห้องว่างในบริการนี้ ลองดูบริการอื่นก่อนนะ
            </p>
          ) : (
            <div className={styles.roomGrid}>
              {visibleRooms.map((room, roomIndex) => (
                <article
                  key={room.id}
                  className={`${styles.roomCardLarge} ${ROOM_TONES[roomIndex % ROOM_TONES.length]}`}
                >
                  <div className={styles.roomHead}>
                    <div className={styles.roomIdentity}>
                      <span className={styles.serviceMark} aria-hidden="true">
                        {room.service.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <p className={styles.cardCat}>{room.service.toUpperCase()}</p>
                        <h3>{room.name}</h3>
                        <span>{room.label}</span>
                      </div>
                    </div>
                    <b className={room.availableSlots > 0 ? styles.stockOk : styles.stockOut}>
                      <i aria-hidden="true" />
                      {room.availableSlots > 0 ? `ว่าง ${room.availableSlots} ที่` : "เต็มแล้ว 😢"}
                    </b>
                  </div>

                  <div className={styles.roomOccupancy}>
                    <div className={styles.capacityDots} aria-label={`มีคนใช้ ${room.occupiedSlots} จาก ${room.capacity} โปรไฟล์`}>
                      <CapacityDots room={room} />
                    </div>
                    <span>มีคนใช้ <b>{room.occupiedSlots}/{room.capacity}</b></span>
                  </div>

                  <div className={styles.slotSectionHeader}>
                    <h4>จะเอาโปรไฟล์ไหนดี?</h4>
                    <span>ว่าง {room.availableSlots}</span>
                  </div>
                  <div className={styles.slotGrid}>
                    {room.slots.map((slot, slotIndex) => {
                      const href = `/checkout?room=${room.id}&profile=${slot.id}`;
                      const lowestPackage = slot.availablePackages[0];
                      const profileLabel = publicProfileLabel(slotIndex);
                      return slot.isAvailable ? (
                        <Link
                          className={styles.slotAvailable}
                          href={href}
                          key={slot.id}
                        >
                          <i className={styles.slotNumber} aria-hidden="true">{slotIndex + 1}</i>
                          <strong>{profileLabel}</strong>
                          <span>
                            ว่างอยู่ · เริ่ม {lowestPackage?.priceAmount.toLocaleString() ?? "—"} PT
                          </span>
                        </Link>
                      ) : (
                        <button className={styles.slotUnavailable} disabled key={slot.id}>
                          <i className={styles.slotNumber} aria-hidden="true">{slotIndex + 1}</i>
                          <strong>{profileLabel}</strong>
                          <span>{unavailableSlotLabel(slot.status)}</span>
                        </button>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
