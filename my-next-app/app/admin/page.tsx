"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import {
  fetchAdminInventory,
  saveAdminPackage,
  saveMasterEmail,
  saveProfile,
  updateProfileStatus,
  type AdminInventory,
} from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

const menu = [
  ["overview", "ภาพรวม", "◫"],
  ["packages", "แพ็กเกจ", "▦"],
  ["accounts", "Email แม่", "◎"],
  ["profiles", "โปรไฟล์", "◉"],
  ["settings", "ตั้งค่าระบบ", "⚙"],
] as const;

type Section = (typeof menu)[number][0];

const tomorrow = new Date(Date.now() + 1000 * 60 * 60 * 24)
  .toISOString()
  .slice(0, 10);

export default function AdminPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const [section, setSection] = useState<Section>("overview");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [inventory, setInventory] = useState<AdminInventory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const currentTitle = menu.find(([key]) => key === section)?.[1] ?? "ภาพรวม";

  async function loadInventory() {
    setIsLoading(true);
    setError("");
    try {
      const data = await fetchAdminInventory();
      setInventory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูล Admin ไม่สำเร็จ");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (user?.role === "admin") void loadInventory();
  }, [user]);

  function handleDone(message: string) {
    setNotice(message);
    void loadInventory();
  }

  if (sessionLoading) {
    return <main className={styles.guard}><p>กำลังตรวจสอบสิทธิ์…</p></main>;
  }

  if (!user) {
    return (
      <main className={styles.guard}>
        <div className={styles.guardCard}>
          <span>🔒</span>
          <h2>กรุณาเข้าสู่ระบบ</h2>
          <p>ต้องเข้าสู่ระบบด้วยบัญชี Admin ก่อน</p>
          <Link href="/register" className={styles.guardBtn}>เข้าสู่ระบบ →</Link>
        </div>
      </main>
    );
  }

  if (user.role !== "admin") {
    return (
      <main className={styles.guard}>
        <div className={styles.guardCard}>
          <span>⛔</span>
          <h2>ไม่มีสิทธิ์เข้าถึง</h2>
          <p>บัญชีนี้ไม่ได้รับสิทธิ์ Admin</p>
          <Link href="/" className={styles.guardBtn}>← กลับหน้าแรก</Link>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/">
          <BrandLogo admin />
        </Link>
        <nav>
          {menu.map(([key, label, icon]) => (
            <button
              className={section === key ? styles.activeNav : ""}
              key={key}
              onClick={() => {
                setSection(key);
                setNotice("");
                setError("");
              }}
            >
              <i>{icon}</i>
              {label}
            </button>
          ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <Link href="/" className={styles.viewSite}>↗ ดูหน้าเว็บไซต์</Link>
          <div className={styles.sidebarUser}>
            {user.image
              ? <Image src={user.image} alt="" width={28} height={28} className={styles.sidebarAvatar} />
              : <span className={styles.sidebarAvatarFallback}>{user.name.slice(0, 1)}</span>
            }
            <div>
              <b>{user.name}</b>
              <small>Administrator</small>
            </div>
          </div>
        </div>
      </aside>
      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>ADMIN CONSOLE</p>
            <h1>{currentTitle}</h1>
          </div>
          <div className={styles.adminIdentity}>
            {user.image
              ? <Image src={user.image} alt="" width={34} height={34} className={styles.identityAvatar} />
              : <span>{user.name.slice(0, 2).toUpperCase()}</span>
            }
            <div>
              <b>{user.name}</b>
              <small>{inventory ? "เชื่อมต่อแล้ว ✓" : isLoading ? "กำลังโหลด…" : "Admin"}</small>
            </div>
          </div>
        </header>

        {notice && <div className={styles.notice}><span>✓</span>{notice}</div>}
        {error && <div className={styles.notice}><span>!</span>{error}</div>}

        {section === "overview" && <Overview inventory={inventory} />}
        {section === "packages" && (
          <PackagesPanel inventory={inventory} onDone={handleDone} />
        )}
        {section === "accounts" && (
          <AccountsPanel inventory={inventory} onDone={handleDone} />
        )}
        {section === "profiles" && (
          <ProfilesPanel inventory={inventory} onDone={handleDone} />
        )}
        {section === "settings" && <Settings />}
      </section>
    </main>
  );
}

function Overview({ inventory }: { inventory: AdminInventory | null }) {
  const metrics = inventory?.metrics;
  return (
    <>
      <div className={styles.metrics}>
        <Metric
          label="แพ็กเกจเปิดขาย"
          value={String(metrics?.activePackages ?? "—")}
          detail="packages.status = active"
          icon="▦"
        />
        <Metric
          label="Email แม่ Active"
          value={String(metrics?.activeMasterEmails ?? "—")}
          detail="พร้อมนับ stock"
          icon="◎"
        />
        <Metric
          label="Profile ว่าง"
          value={String(metrics?.availableProfiles ?? "—")}
          detail="available profiles"
          icon="◉"
        />
        <Metric
          label="กำลังเช่า"
          value={String(metrics?.activeSubscriptions ?? "—")}
          detail="active subscriptions"
          icon="◷"
        />
      </div>
      <div className={styles.dashboardGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>LIVE STOCK</p>
              <h2>Stock หน้าร้าน</h2>
            </div>
          </div>
          <div className={styles.roomList}>
            {(inventory?.packages ?? []).map((pkg) => (
              <div key={pkg.id}>
                <span className={`${styles.statusDot} ${styles.green}`} />
                <b>{pkg.name}</b>
                <span>{pkg.availableStock} profile</span>
                <em className={pkg.availableStock > 0 ? styles.green : styles.red}>
                  {pkg.availableStock > 0 ? "พร้อมขาย" : "หมด"}
                </em>
              </div>
            ))}
          </div>
        </section>
        <section className={`${styles.panel} ${styles.activity}`}>
          <p className={styles.eyebrow}>SECURITY</p>
          <h2>แนวทางข้อมูลลับ</h2>
          <Activity
            title="Password ถูก encrypt ก่อนลง DB"
            time="AES-256-GCM ที่ backend"
            accent="purple"
          />
          <Activity
            title="Stock lock ด้วย Transaction"
            time="FOR UPDATE SKIP LOCKED"
            accent="yellow"
          />
          <Activity
            title="ไม่แสดง secret ในหน้า admin list"
            time="ลดโอกาสข้อมูลรั่ว"
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

function PackagesPanel({
  inventory,
  onDone,
}: {
  inventory: AdminInventory | null;
  onDone: (message: string) => void;
}) {
  const [form, setForm] = useState({
    slug: "netflix-week",
    name: "Netflix รายสัปดาห์",
    service: "netflix",
    durationDays: 7,
    priceAmount: 49,
  });
  const canSave = form.slug && form.name && form.durationDays > 0;

  async function submit() {
    await saveAdminPackage(form);
    onDone(`บันทึกแพ็กเกจ ${form.name} แล้ว`);
  }

  return (
    <div className={styles.dashboardGrid}>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>STOREFRONT PACKAGES</p>
        <h2>แพ็กเกจหน้าร้าน</h2>
        <div className={styles.packageAdmin}>
          {(inventory?.packages ?? []).map((pkg) => (
            <div key={pkg.id}>
              <span>{pkg.slug}</span>
              <b>{pkg.price_amount} Point</b>
              <em className={pkg.status === "active" ? styles.green : styles.yellow}>
                {pkg.availableStock} stock
              </em>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>UPSERT PACKAGE</p>
        <h2>เพิ่ม/แก้แพ็กเกจ</h2>
        <div className={styles.formRows}>
          <label>
            Slug
            <input
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
            />
          </label>
          <label>
            ชื่อ
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            Service
            <input
              value={form.service}
              onChange={(event) => setForm({ ...form, service: event.target.value })}
            />
          </label>
          <label>
            ระยะเวลา
            <input
              inputMode="numeric"
              value={form.durationDays}
              onChange={(event) =>
                setForm({ ...form, durationDays: Number(event.target.value) })
              }
            />
          </label>
          <label>
            ราคา Point
            <input
              inputMode="numeric"
              value={form.priceAmount}
              onChange={(event) =>
                setForm({ ...form, priceAmount: Number(event.target.value) })
              }
            />
          </label>
          <button
            className={styles.primary}
            disabled={!canSave}
            onClick={() => void submit()}
            type="button"
          >
            บันทึกแพ็กเกจ
          </button>
        </div>
      </section>
    </div>
  );
}

function AccountsPanel({
  inventory,
  onDone,
}: {
  inventory: AdminInventory | null;
  onDone: (message: string) => void;
}) {
  const [form, setForm] = useState({
    service: "netflix",
    email: "",
    password: "",
    masterExpiredAt: tomorrow,
    note: "",
  });

  async function submit() {
    await saveMasterEmail({
      ...form,
      masterExpiredAt: new Date(form.masterExpiredAt).toISOString(),
    });
    setForm({ ...form, email: "", password: "", note: "" });
    onDone("เพิ่ม Email แม่และเข้ารหัส password แล้ว");
  }

  return (
    <div className={styles.dashboardGrid}>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>MASTER EMAILS</p>
        <h2>Email แม่</h2>
        <div className={styles.table}>
          {(inventory?.masterEmails ?? []).map((account) => (
            <div key={account.id}>
              <b>{account.email}</b>
              <span>{account.availableProfiles} / {account.profileCount} profile</span>
              <em className={account.status === "active" ? styles.green : styles.yellow}>
                {account.status}
              </em>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>ADD SECURE ACCOUNT</p>
        <h2>เพิ่ม Email แม่</h2>
        <div className={styles.formRows}>
          <label>
            Service
            <input
              value={form.service}
              onChange={(event) => setForm({ ...form, service: event.target.value })}
            />
          </label>
          <label>
            Email
            <input
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </label>
          <label>
            หมดอายุจริง
            <input
              type="date"
              value={form.masterExpiredAt}
              onChange={(event) =>
                setForm({ ...form, masterExpiredAt: event.target.value })
              }
            />
          </label>
          <label>
            Note
            <input
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
          </label>
          <button
            className={styles.primary}
            disabled={!form.email || !form.password}
            onClick={() => void submit()}
            type="button"
          >
            เพิ่มและ Encrypt
          </button>
        </div>
      </section>
    </div>
  );
}

function ProfilesPanel({
  inventory,
  onDone,
}: {
  inventory: AdminInventory | null;
  onDone: (message: string) => void;
}) {
  const firstAccount = inventory?.masterEmails[0]?.id ?? "";
  const [form, setForm] = useState({
    masterEmailId: firstAccount,
    profileName: "",
    pin: "",
    profileExpiresAt: "",
    note: "",
  });

  useEffect(() => {
    if (!form.masterEmailId && firstAccount) {
      setForm((current) => ({ ...current, masterEmailId: firstAccount }));
    }
  }, [firstAccount, form.masterEmailId]);

  async function submit() {
    await saveProfile({
      ...form,
      profileExpiresAt: form.profileExpiresAt
        ? new Date(form.profileExpiresAt).toISOString()
        : undefined,
    });
    setForm({ ...form, profileName: "", pin: "", note: "" });
    onDone("เพิ่ม Profile และเข้ารหัส PIN แล้ว");
  }

  async function changeStatus(profileId: string, status: string) {
    await updateProfileStatus(profileId, status);
    onDone(`เปลี่ยนสถานะ profile เป็น ${status} แล้ว`);
  }

  return (
    <div className={styles.dashboardGrid}>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>PROFILES</p>
        <h2>โปรไฟล์ที่ดูได้</h2>
        <div className={styles.table}>
          {(inventory?.profiles ?? []).map((profile) => (
            <div key={profile.id}>
              <b>{profile.profile_name}</b>
              <span>{profile.masterEmail}</span>
              <em className={profile.status === "available" ? styles.green : styles.yellow}>
                {profile.status}
              </em>
              <button
                onClick={() =>
                  void changeStatus(
                    profile.id,
                    profile.status === "available" ? "inactive" : "available",
                  )
                }
                type="button"
              >
                {profile.status === "available" ? "ปิด" : "เปิด"}
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>ADD PROFILE</p>
        <h2>เพิ่ม Profile</h2>
        <div className={styles.formRows}>
          <label>
            Email แม่
            <select
              value={form.masterEmailId}
              onChange={(event) =>
                setForm({ ...form, masterEmailId: event.target.value })
              }
            >
              <option value="">เลือก Email แม่</option>
              {(inventory?.masterEmails ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            ชื่อ Profile
            <input
              value={form.profileName}
              onChange={(event) =>
                setForm({ ...form, profileName: event.target.value })
              }
            />
          </label>
          <label>
            PIN / Password
            <input
              type="password"
              value={form.pin}
              onChange={(event) => setForm({ ...form, pin: event.target.value })}
            />
          </label>
          <label>
            Profile ใช้ได้ถึง
            <input
              type="date"
              value={form.profileExpiresAt}
              onChange={(event) =>
                setForm({ ...form, profileExpiresAt: event.target.value })
              }
            />
          </label>
          <label>
            Note
            <input
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
          </label>
          <button
            className={styles.primary}
            disabled={!form.masterEmailId || !form.profileName}
            onClick={() => void submit()}
            type="button"
          >
            เพิ่ม Profile
          </button>
        </div>
      </section>
    </div>
  );
}

function Settings() {
  return (
    <section className={styles.panel}>
      <p className={styles.eyebrow}>SYSTEM CONFIGURATION</p>
      <h2>ตั้งค่าระบบ</h2>
      <div className={styles.emptyState}>
        <span>⚙</span>
        <h3>ตั้งค่าผ่าน Environment</h3>
        <p>
          ตั้งค่า <code>ADMIN_KEY</code>, <code>CREDENTIAL_ENCRYPTION_KEY</code>,
          OAuth และ payment provider ใน server environment เท่านั้น
        </p>
      </div>
      <p className={styles.hint}>
        ไม่ควรวางรหัสรับเงิน, encryption key หรือ credential จริงไว้ใน frontend
      </p>
    </section>
  );
}
