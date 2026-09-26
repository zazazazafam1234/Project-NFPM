"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./page.module.css";

const rooms = [
  { id: "ROOM 01", members: "1 / 4", status: "ว่าง", color: "green" },
  { id: "ROOM 02", members: "2 / 4", status: "ว่าง", color: "green" },
  { id: "ROOM 03", members: "0 / 4", status: "ว่าง", color: "green" },
  { id: "ROOM 04", members: "4 / 4", status: "เต็ม", color: "red" },
  { id: "ROOM 05", members: "3 / 4", status: "ใกล้เต็ม", color: "yellow" },
  { id: "ROOM 06", members: "2 / 4", status: "ว่าง", color: "green" },
];

const menu = [
  ["overview", "ภาพรวม", "◫"],
  ["rooms", "จัดการห้อง", "▦"],
  ["points", "Point & โปร", "✦"],
  ["users", "ผู้ใช้งาน", "◉"],
  ["settings", "ตั้งค่าระบบ", "⚙"],
] as const;

type Section = (typeof menu)[number][0];

export default function AdminPage() {
  const [section, setSection] = useState<Section>("overview");
  const [notice, setNotice] = useState("");
  const currentTitle = menu.find(([key]) => key === section)?.[1] ?? "ภาพรวม";

  function saveConfig(label: string) {
    setNotice(
      `${label} ถูกบันทึกในหน้าจอแล้ว — เชื่อม POST /admin/config เพื่อบันทึกจริง`,
    );
  }

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/">
          <span>F</span>
          <b>Fast Movie</b>
          <small>ADMIN</small>
        </Link>
        <nav>
          {menu.map(([key, label, icon]) => (
            <button
              className={section === key ? styles.activeNav : ""}
              key={key}
              onClick={() => {
                setSection(key);
                setNotice("");
              }}
            >
              <i>{icon}</i>
              {label}
            </button>
          ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <Link href="/" className={styles.viewSite}>
            ↗ ดูหน้าเว็บไซต์
          </Link>
          <p>
            Fast Movie Admin
            <br />
            v0.1.0
          </p>
        </div>
      </aside>
      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>ADMIN CONSOLE</p>
            <h1>{currentTitle}</h1>
          </div>
          <div className={styles.adminIdentity}>
            <span>AM</span>
            <div>
              <b>Admin</b>
              <small>ผู้ดูแลระบบ</small>
            </div>
          </div>
        </header>
        {notice && (
          <div className={styles.notice}>
            <span>✓</span>
            {notice}
          </div>
        )}
        {section === "overview" && <Overview setSection={setSection} />}
        {section === "rooms" && <Rooms onSave={saveConfig} />}
        {section === "points" && <Points onSave={saveConfig} />}
        {section === "users" && <Users />}
        {section === "settings" && <Settings onSave={saveConfig} />}
      </section>
    </main>
  );
}

function Overview({ setSection }: { setSection: (section: Section) => void }) {
  return (
    <>
      <div className={styles.metrics}>
        <Metric
          label="Point ในระบบ"
          value="12,840"
          detail="+8.2% ใน 7 วัน"
          icon="✦"
        />
        <Metric
          label="ผู้ใช้ทั้งหมด"
          value="248"
          detail="+16 คน เดือนนี้"
          icon="◉"
        />
        <Metric
          label="ห้องที่ว่าง"
          value="5 / 6"
          detail="ROOM 04 เต็มแล้ว"
          icon="▦"
        />
        <Metric
          label="รอตรวจสอบ"
          value="3"
          detail="รายการเติม Point"
          icon="◷"
        />
      </div>
      <div className={styles.dashboardGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>ROOM STATUS</p>
              <h2>สถานะห้อง</h2>
            </div>
            <button onClick={() => setSection("rooms")}>จัดการห้อง →</button>
          </div>
          <div className={styles.roomList}>
            {rooms.map((room) => (
              <div key={room.id}>
                <span className={`${styles.statusDot} ${styles[room.color]}`} />
                <b>{room.id}</b>
                <span>{room.members} คน</span>
                <em className={styles[room.color]}>{room.status}</em>
              </div>
            ))}
          </div>
        </section>
        <section className={`${styles.panel} ${styles.activity}`}>
          <p className={styles.eyebrow}>LIVE ACTIVITY</p>
          <h2>กิจกรรมล่าสุด</h2>
          <Activity
            title="มีรายการเติม 150 Point"
            time="เมื่อ 2 นาที"
            accent="purple"
          />
          <Activity
            title="ROOM 05 เหลือ 1 ที่"
            time="เมื่อ 18 นาที"
            accent="yellow"
          />
          <Activity
            title="สมาชิกใหม่ลงทะเบียน"
            time="เมื่อ 42 นาที"
            accent="red"
          />
        </section>
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: string;
}) {
  return (
    <article className={styles.metric}>
      <span>{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function Activity({
  title,
  time,
  accent,
}: {
  title: string;
  time: string;
  accent: string;
}) {
  return (
    <div className={styles.activityRow}>
      <i className={styles[accent]} />
      <div>
        <b>{title}</b>
        <span>{time}</span>
      </div>
    </div>
  );
}

function Rooms({ onSave }: { onSave: (label: string) => void }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>ROOM INVENTORY</p>
          <h2>จัดการ Room</h2>
        </div>
        <button className={styles.primary} onClick={() => onSave("Room ใหม่")}>
          + เพิ่ม Room
        </button>
      </div>
      <div className={styles.table}>
        {rooms.map((room) => (
          <div key={room.id}>
            <b>{room.id}</b>
            <span>ผู้ใช้งาน {room.members}</span>
            <em className={styles[room.color]}>{room.status}</em>
            <button onClick={() => onSave(room.id)}>แก้ไข</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Points({ onSave }: { onSave: (label: string) => void }) {
  return (
    <div className={styles.dashboardGrid}>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>TOP-UP PACKAGES</p>
        <h2>แพ็กเติม Point</h2>
        <div className={styles.packageAdmin}>
          {[
            [50, 50],
            [150, 150],
            [350, 350],
          ].map(([point, price]) => (
            <div key={point}>
              <span>✦ {point} POINT</span>
              <b>{price} บาท</b>
              <button onClick={() => onSave(`แพ็ก ${point} Point`)}>
                แก้ไข
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>PROMOTION COST</p>
        <h2>ราคาโปรด้วย Point</h2>
        <div className={styles.formRows}>
          <label>
            รายวัน <input defaultValue="10" inputMode="numeric" /> Point
          </label>
          <label>
            รายสัปดาห์ <input defaultValue="49" inputMode="numeric" /> Point
          </label>
          <label>
            รายเดือน <input defaultValue="129" inputMode="numeric" /> Point
          </label>
          <button className={styles.primary} onClick={() => onSave("ราคาโปร")}>
            บันทึกราคา
          </button>
        </div>
      </section>
    </div>
  );
}

function Users() {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>MEMBERS</p>
          <h2>ผู้ใช้งาน</h2>
        </div>
        <input className={styles.search} placeholder="ค้นหาชื่อหรืออีเมล" />
      </div>
      <div className={styles.emptyState}>
        <span>◉</span>
        <h3>เชื่อมรายการผู้ใช้จาก server</h3>
        <p>
          เรียก <code>GET /admin/users</code> เพื่อแสดงผู้ใช้, Point
          และสถานะการใช้งาน
        </p>
      </div>
    </section>
  );
}

function Settings({ onSave }: { onSave: (label: string) => void }) {
  return (
    <section className={styles.panel}>
      <p className={styles.eyebrow}>SYSTEM CONFIGURATION</p>
      <h2>ตั้งค่าระบบ</h2>
      <div className={styles.formRows}>
        <label>
          PromptPay ID <input placeholder="เลขบัตรประชาชน หรือเบอร์มือถือ" />
        </label>
        <label>
          TrueMoney Wallet <input placeholder="เบอร์ TrueMoney Wallet" />
        </label>
        <label>
          ช่องทางติดต่อแอดมิน <input placeholder="Line ID" />
        </label>
        <button
          className={styles.primary}
          onClick={() => onSave("การตั้งค่าระบบ")}
        >
          บันทึกการตั้งค่า
        </button>
      </div>
      <p className={styles.hint}>
        ข้อมูลเหล่านี้ต้องเข้ารหัสและจัดเก็บที่ server เท่านั้น
        อย่าใส่ข้อมูลรับเงินลงใน frontend
      </p>
    </section>
  );
}
