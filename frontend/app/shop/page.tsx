"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { fetchStreamingRooms, type StreamingRoom } from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

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
        <nav className={styles.navLinks}>
          <Link href="/">หน้าแรก</Link>
          <Link href="/shop" aria-current="page">
            ร้านค้า
          </Link>
          <Link href="/profile">บัญชี</Link>
        </nav>
        <Link className={styles.mobileLogin} href="/register">
          เข้าสู่ระบบ
        </Link>
        <div className={styles.pointsBadge}>
          <span>✦</span>
          {user ? user.points.toLocaleString() : "—"}
          <small>PT</small>
        </div>
      </header>

      <div className={styles.hero}>
        <p className={styles.eyebrow}>FAST MOVIE ROOMS</p>
        <h1>เลือกห้องและ Slot ที่พร้อมใช้งาน</h1>
        <p>กด slot ว่างในห้องที่ต้องการ แล้วเลือกโปรรายวัน/รายสัปดาห์/รายเดือนในขั้นตอนถัดไป</p>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <p className={styles.sideLabel}>บริการ</p>
          <ul className={styles.catList}>
            <li>
              <button
                className={!service ? styles.catActive : styles.catBtn}
                type="button"
                onClick={() => setService(null)}
              >
                <span>▦</span>
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
                  <span>N</span>
                  <span>{item.toUpperCase()}</span>
                  <small>{rooms.filter((room) => room.service === item).length}</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className={styles.main}>
          <div className={styles.gridHeader}>
            <h2>{service ? `${service.toUpperCase()} Rooms` : "ห้องทั้งหมด"}</h2>
            <span className={styles.count}>{totalSlots} slot พร้อมเช่า</span>
          </div>

          {loading ? (
            <div className={styles.skeleton}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={styles.skeletonCard} />
              ))}
            </div>
          ) : visibleRooms.length === 0 ? (
            <p className={styles.empty}>ยังไม่มีห้องที่พร้อมใช้งานในบริการนี้</p>
          ) : (
            <div className={styles.roomGrid}>
              {visibleRooms.map((room) => (
                <article key={room.id} className={styles.roomCardLarge}>
                  <div className={styles.roomHead}>
                    <div>
                      <p className={styles.cardCat}>{room.service.toUpperCase()}</p>
                      <h3>{room.name}</h3>
                      <span>{room.label}</span>
                    </div>
                    <b className={room.availableSlots > 0 ? styles.stockOk : styles.stockOut}>
                      {room.availableSlots}/{room.capacity} slot
                    </b>
                  </div>

                  <div className={styles.slotGrid}>
                    {room.slots.map((slot) => {
                      const href = `/checkout?room=${room.id}&profile=${slot.id}`;
                      const lowestPackage = slot.availablePackages[0];
                      return slot.isAvailable ? (
                        <Link
                          className={styles.slotAvailable}
                          href={href}
                          key={slot.id}
                        >
                          <strong>{slot.name}</strong>
                          <span>
                            ว่าง · เริ่ม {lowestPackage?.priceAmount.toLocaleString() ?? "—"} PT
                          </span>
                        </Link>
                      ) : (
                        <button className={styles.slotUnavailable} disabled key={slot.id}>
                          <strong>{slot.name}</strong>
                          <span>{slot.status === "available" ? "ติดจองอยู่" : slot.status}</span>
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
