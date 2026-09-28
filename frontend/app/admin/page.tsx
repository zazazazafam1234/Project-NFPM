"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BrandLogo } from "../components/BrandLogo";
import {
  deleteAdminPackage,
  deleteMasterEmail,
  deleteProfile,
  fetchAdminInventory,
  saveAdminPackage,
  saveMasterEmail,
  saveProfile,
  updateAdminPackage,
  updateMasterEmail,
  updateProfile,
  updateProfileStatus,
  type AdminInventory,
} from "../lib/api";
import { useSession } from "../providers";
import styles from "./page.module.css";

const menu = [
  ["overview", "ภาพรวม", "◫"],
  ["packages", "โปรโมชัน", "▦"],
  ["accounts", "ห้อง / Email แม่", "◎"],
  ["profiles", "Slot / โปรไฟล์", "◉"],
  ["settings", "ตั้งค่าระบบ", "⚙"],
] as const;

type Section = (typeof menu)[number][0];

const tomorrow = new Date(Date.now() + 1000 * 60 * 60 * 24)
  .toISOString()
  .slice(0, 10);

function dateInputValue(value: string | null | undefined) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

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
    if (user?.role !== "admin") return;
    queueMicrotask(() => {
      void loadInventory();
    });
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
  const [stockSearch, setStockSearch] = useState("");
  const visiblePackages = (inventory?.packages ?? []).filter((pkg) => {
    const query = stockSearch.trim().toLowerCase();
    if (!query) return true;
    return [pkg.name, pkg.slug, pkg.service, pkg.status]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  return (
    <>
      <div className={styles.metrics}>
        <Metric
          label="โปรโมชันเปิดขาย"
          value={String(metrics?.activePackages ?? "—")}
          detail="packages.status = active"
          icon="▦"
        />
        <Metric
          label="ห้อง Active"
          value={String(metrics?.activeMasterEmails ?? "—")}
          detail="พร้อมนับ stock"
          icon="◎"
        />
        <Metric
          label="Slot ว่าง"
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
              <h2>ห้องและ Slot หน้าร้าน</h2>
            </div>
            <input
              className={styles.search}
              placeholder="ค้นหา stock"
              value={stockSearch}
              onChange={(event) => setStockSearch(event.target.value)}
            />
          </div>
          <div className={styles.roomList}>
            {visiblePackages.map((pkg) => (
              <div key={pkg.id}>
                <span className={`${styles.statusDot} ${styles.green}`} />
                <b>{pkg.name}</b>
                <span>{pkg.availableStock} profile</span>
                <em className={pkg.availableStock > 0 ? styles.green : styles.red}>
                  {pkg.availableStock > 0 ? "พร้อมขาย" : "หมด"}
                </em>
              </div>
            ))}
            {visiblePackages.length === 0 && (
              <p className={styles.emptyInline}>ไม่พบรายการที่ค้นหา</p>
            )}
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

function EditModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHead}>
          <div>
            <p className={styles.eyebrow}>EDIT</p>
            <h2>{title}</h2>
          </div>
          <button className={styles.modalClose} onClick={onClose} type="button">
            ×
          </button>
        </div>
        {children}
      </section>
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
    description: "",
    durationDays: 7,
    priceAmount: 49,
    currency: "THB",
    status: "active",
  });
  const [editForm, setEditForm] = useState(form);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const canSave = form.slug && form.name && form.durationDays > 0;
  const canSaveEdit = editForm.slug && editForm.name && editForm.durationDays > 0;
  const visiblePackages = (inventory?.packages ?? []).filter((pkg) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [pkg.slug, pkg.name, pkg.service, pkg.status, pkg.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  function resetForm() {
    setEditingId(null);
    setForm({
      slug: "netflix-week",
      name: "Netflix รายสัปดาห์",
      service: "netflix",
      description: "",
      durationDays: 7,
      priceAmount: 49,
      currency: "THB",
      status: "active",
    });
  }

  async function submit() {
    await saveAdminPackage(form);
    onDone(`เพิ่มโปรโมชัน ${form.name} แล้ว`);
    resetForm();
  }

  async function submitEdit() {
    if (!editingId) return;
    await updateAdminPackage(editingId, editForm);
    onDone(`แก้ไขโปรโมชัน ${editForm.name} แล้ว`);
    setEditingId(null);
  }

  async function removePackage(packageId: string, name: string) {
    if (!window.confirm(`ลบ/Archive โปรโมชัน ${name}?`)) return;
    await deleteAdminPackage(packageId);
    onDone(`Archive โปรโมชัน ${name} แล้ว`);
    if (editingId === packageId) setEditingId(null);
  }

  return (
    <>
    <div className={styles.dashboardGrid}>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>CUSTOMER PROMOTIONS</p>
            <h2>โปรโมชันให้ลูกค้าเลือก</h2>
          </div>
          <input
            className={styles.search}
            placeholder="ค้นหาโปรโมชัน"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className={styles.packageAdmin}>
          {visiblePackages.map((pkg) => (
            <div key={pkg.id}>
              <span>{pkg.slug}</span>
              <b>{pkg.price_amount} Point</b>
              <em className={pkg.status === "active" ? styles.green : styles.yellow}>
                {pkg.availableStock} stock
              </em>
              <button
                type="button"
                onClick={() =>
                {
                  setEditingId(pkg.id);
                  setEditForm({
                    slug: pkg.slug,
                    name: pkg.name,
                    service: pkg.service,
                    description: pkg.description ?? "",
                    durationDays: Number(pkg.duration_days),
                    priceAmount: Number(pkg.price_amount),
                    currency: pkg.currency ?? "THB",
                    status: pkg.status,
                  });
                }
                }
              >
                แก้ไข
              </button>
              <button
                className={styles.danger}
                type="button"
                onClick={() => void removePackage(pkg.id, pkg.name)}
              >
                ลบ
              </button>
            </div>
          ))}
          {visiblePackages.length === 0 && (
            <p className={styles.emptyInline}>ไม่พบโปรโมชันที่ค้นหา</p>
          )}
        </div>
      </section>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>UPSERT PROMOTION</p>
        <h2>เพิ่มโปรโมชัน</h2>
        <p className={styles.muted}>
          สร้างโปรโมชันใหม่ให้ลูกค้าเลือกหลังเลือก slot
        </p>
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
            รายละเอียด
            <input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
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
          <label>
            สถานะ
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <div className={styles.formActions}>
            <button
              className={styles.primary}
              disabled={!canSave}
              onClick={() => void submit()}
              type="button"
            >
              เพิ่มโปรโมชัน
            </button>
          </div>
        </div>
      </section>
    </div>
    {editingId && (
      <EditModal title="แก้ไขโปรโมชัน" onClose={() => setEditingId(null)}>
        <div className={styles.formRows}>
          <label>
            Slug
            <input
              value={editForm.slug}
              onChange={(event) => setEditForm({ ...editForm, slug: event.target.value })}
            />
          </label>
          <label>
            ชื่อ
            <input
              value={editForm.name}
              onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
            />
          </label>
          <label>
            Service
            <input
              value={editForm.service}
              onChange={(event) => setEditForm({ ...editForm, service: event.target.value })}
            />
          </label>
          <label>
            รายละเอียด
            <input
              value={editForm.description}
              onChange={(event) => setEditForm({ ...editForm, description: event.target.value })}
            />
          </label>
          <label>
            ระยะเวลา
            <input
              inputMode="numeric"
              value={editForm.durationDays}
              onChange={(event) =>
                setEditForm({ ...editForm, durationDays: Number(event.target.value) })
              }
            />
          </label>
          <label>
            ราคา Point
            <input
              inputMode="numeric"
              value={editForm.priceAmount}
              onChange={(event) =>
                setEditForm({ ...editForm, priceAmount: Number(event.target.value) })
              }
            />
          </label>
          <label>
            สถานะ
            <select
              value={editForm.status}
              onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <div className={styles.formActions}>
            <button
              className={styles.primary}
              disabled={!canSaveEdit}
              onClick={() => void submitEdit()}
              type="button"
            >
              บันทึกการแก้ไข
            </button>
            <button className={styles.secondary} onClick={() => setEditingId(null)} type="button">
              ยกเลิก
            </button>
          </div>
        </div>
      </EditModal>
    )}
    </>
  );
}

function AccountsPanel({
  inventory,
  onDone,
}: {
  inventory: AdminInventory | null;
  onDone: (message: string) => void;
}) {
  const firstPackageId = inventory?.packages[0]?.id ?? "";
  const [form, setForm] = useState({
    packageId: firstPackageId,
    email: "",
    password: "",
    purchasedAt: tomorrow,
    masterExpiredAt: tomorrow,
    status: "active",
    note: "",
  });
  const [editForm, setEditForm] = useState(form);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const selectedPackageId = form.packageId || firstPackageId;
  const selectedEditPackageId = editForm.packageId || firstPackageId;
  const visibleAccounts = (inventory?.masterEmails ?? []).filter((account) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [
      account.email,
      account.packageName,
      account.packageSlug,
      account.service,
      account.status,
      account.note,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  function resetForm() {
    setEditingId(null);
    setForm({
      packageId: firstPackageId,
      email: "",
      password: "",
      purchasedAt: tomorrow,
      masterExpiredAt: tomorrow,
      status: "active",
      note: "",
    });
  }

  async function submit() {
    const payload = {
      ...form,
      packageId: selectedPackageId,
      purchasedAt: new Date(form.purchasedAt).toISOString(),
      masterExpiredAt: new Date(form.masterExpiredAt).toISOString(),
    };
    await saveMasterEmail(payload);
    onDone("เพิ่มห้องบัญชีแม่และเข้ารหัส password แล้ว");
    resetForm();
  }

  async function submitEdit() {
    if (!editingId) return;
    await updateMasterEmail(editingId, {
      ...editForm,
      packageId: selectedEditPackageId,
      password: editForm.password || undefined,
      purchasedAt: new Date(editForm.purchasedAt).toISOString(),
      masterExpiredAt: new Date(editForm.masterExpiredAt).toISOString(),
    });
    onDone(`แก้ไขห้อง ${editForm.email} แล้ว`);
    setEditingId(null);
  }

  async function removeAccount(accountId: string, email: string) {
    if (!window.confirm(`ลบ/ปิดห้อง ${email}? Slot ที่ไม่ได้เช่าอยู่จะถูกปิดด้วย`)) return;
    await deleteMasterEmail(accountId);
    onDone(`ปิดห้อง ${email} แล้ว`);
    if (editingId === accountId) setEditingId(null);
  }

  return (
    <>
    <div className={styles.dashboardGrid}>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>ROOM ACCOUNTS</p>
            <h2>ห้อง / Email แม่</h2>
          </div>
          <input
            className={styles.search}
            placeholder="ค้นหาห้อง"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className={styles.table}>
          {visibleAccounts.map((account) => (
            <div key={account.id}>
              <b>{account.email}</b>
              <span>
                {account.packageName ?? account.service} · {account.availableProfiles} / {account.profileCount} slot
              </span>
              <em className={account.status === "active" ? styles.green : styles.yellow}>
                {account.status}
              </em>
              <button
                type="button"
                onClick={() => {
                  setEditingId(account.id);
                  setEditForm({
                    packageId: account.packageId ?? firstPackageId,
                    email: account.email,
                    password: "",
                    purchasedAt: dateInputValue(account.purchased_at) || tomorrow,
                    masterExpiredAt: dateInputValue(account.master_expired_at) || tomorrow,
                    status: account.status,
                    note: account.note ?? "",
                  });
                }}
              >
                แก้ไข
              </button>
              <button
                className={styles.danger}
                type="button"
                onClick={() => void removeAccount(account.id, account.email)}
              >
                ลบ
              </button>
            </div>
          ))}
          {visibleAccounts.length === 0 && (
            <p className={styles.emptyInline}>ไม่พบห้องที่ค้นหา</p>
          )}
        </div>
      </section>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>ADD ROOM ACCOUNT</p>
        <h2>เพิ่มห้องบัญชีแม่</h2>
        <div className={styles.formRows}>
          <label>
            โปรโมชันตั้งต้น / Service
            <select
              value={selectedPackageId}
              onChange={(event) => setForm({ ...form, packageId: event.target.value })}
            >
              <option value="">เลือกโปรโมชันตั้งต้น</option>
              {(inventory?.packages ?? []).map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name} · {pkg.price_amount} Point · {pkg.duration_days} วัน
                </option>
              ))}
            </select>
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
            วันที่ซื้อ
            <input
              type="date"
              value={form.purchasedAt}
              onChange={(event) =>
                setForm({ ...form, purchasedAt: event.target.value })
              }
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
            สถานะ
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="expired">expired</option>
              <option value="suspended">suspended</option>
            </select>
          </label>
          <label>
            Note
            <input
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
          </label>
          <div className={styles.formActions}>
            <button
              className={styles.primary}
              disabled={!selectedPackageId || !form.email || !form.password}
              onClick={() => void submit()}
              type="button"
            >
              เพิ่มห้องและ Encrypt
            </button>
          </div>
        </div>
      </section>
    </div>
    {editingId && (
      <EditModal title="แก้ไขห้องบัญชีแม่" onClose={() => setEditingId(null)}>
        <div className={styles.formRows}>
          <label>
            โปรโมชันตั้งต้น / Service
            <select
              value={selectedEditPackageId}
              onChange={(event) => setEditForm({ ...editForm, packageId: event.target.value })}
            >
              <option value="">เลือกโปรโมชันตั้งต้น</option>
              {(inventory?.packages ?? []).map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name} · {pkg.price_amount} Point · {pkg.duration_days} วัน
                </option>
              ))}
            </select>
          </label>
          <label>
            Email
            <input
              value={editForm.email}
              onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
            />
          </label>
          <label>
            Password (เว้นว่าง = ไม่เปลี่ยน)
            <input
              type="password"
              value={editForm.password}
              onChange={(event) => setEditForm({ ...editForm, password: event.target.value })}
            />
          </label>
          <label>
            วันที่ซื้อ
            <input
              type="date"
              value={editForm.purchasedAt}
              onChange={(event) =>
                setEditForm({ ...editForm, purchasedAt: event.target.value })
              }
            />
          </label>
          <label>
            หมดอายุจริง
            <input
              type="date"
              value={editForm.masterExpiredAt}
              onChange={(event) =>
                setEditForm({ ...editForm, masterExpiredAt: event.target.value })
              }
            />
          </label>
          <label>
            สถานะ
            <select
              value={editForm.status}
              onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="expired">expired</option>
              <option value="suspended">suspended</option>
            </select>
          </label>
          <label>
            Note
            <input
              value={editForm.note}
              onChange={(event) => setEditForm({ ...editForm, note: event.target.value })}
            />
          </label>
          <div className={styles.formActions}>
            <button
              className={styles.primary}
              disabled={!selectedEditPackageId || !editForm.email}
              onClick={() => void submitEdit()}
              type="button"
            >
              บันทึกห้อง
            </button>
            <button className={styles.secondary} onClick={() => setEditingId(null)} type="button">
              ยกเลิก
            </button>
          </div>
        </div>
      </EditModal>
    )}
    </>
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
    status: "available",
    profileExpiresAt: "",
    note: "",
  });
  const [editForm, setEditForm] = useState(form);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const selectedMasterEmailId = form.masterEmailId || firstAccount;
  const selectedEditMasterEmailId = editForm.masterEmailId || firstAccount;
  const profiles = inventory?.profiles ?? [];
  const statusTabs = [
    ["all", "ทั้งหมด"],
    ["available", "ว่าง"],
    ["rented", "เช่าอยู่"],
    ["reserved", "จองไว้"],
    ["inactive", "ปิดใช้งาน"],
    ["expired", "หมดอายุ"],
  ] as const;
  const visibleProfiles = profiles.filter((profile) => {
    if (statusFilter !== "all" && profile.status !== statusFilter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [
      profile.profile_name,
      profile.masterEmail,
      profile.packageName,
      profile.packageSlug,
      profile.service,
      profile.status,
      profile.note,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const countByStatus = profiles.reduce<Record<string, number>>((acc, profile) => {
    acc.all = (acc.all ?? 0) + 1;
    acc[profile.status] = (acc[profile.status] ?? 0) + 1;
    return acc;
  }, { all: 0 });

  function resetForm() {
    setEditingId(null);
    setForm({
      masterEmailId: firstAccount,
      profileName: "",
      pin: "",
      status: "available",
      profileExpiresAt: "",
      note: "",
    });
  }

  async function submit() {
    const payload = {
      ...form,
      masterEmailId: selectedMasterEmailId,
      profileExpiresAt: form.profileExpiresAt
        ? new Date(form.profileExpiresAt).toISOString()
        : undefined,
    };
    await saveProfile(payload);
    onDone("เพิ่ม Slot และเข้ารหัส PIN แล้ว");
    resetForm();
  }

  async function submitEdit() {
    if (!editingId) return;
    await updateProfile(editingId, {
      ...editForm,
      masterEmailId: selectedEditMasterEmailId,
      pin: editForm.pin || undefined,
      profileExpiresAt: editForm.profileExpiresAt
        ? new Date(editForm.profileExpiresAt).toISOString()
        : null,
    });
    onDone(`แก้ไข Slot ${editForm.profileName} แล้ว`);
    setEditingId(null);
  }

  async function changeStatus(profileId: string, status: string) {
    await updateProfileStatus(profileId, status);
    onDone(`เปลี่ยนสถานะ profile เป็น ${status} แล้ว`);
  }

  async function removeProfile(profileId: string, profileName: string) {
    if (!window.confirm(`ลบ/ปิด Slot ${profileName}?`)) return;
    await deleteProfile(profileId);
    onDone(`ลบ Slot ${profileName} แล้ว`);
    if (editingId === profileId) setEditingId(null);
  }

  return (
    <>
    <div className={styles.dashboardGrid}>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>ROOM SLOTS</p>
            <h2>Slot / โปรไฟล์ที่ดูได้</h2>
          </div>
          <input
            className={styles.search}
            placeholder="ค้นหา slot"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className={styles.categoryTabs}>
          {statusTabs.map(([key, label]) => (
            <button
              className={statusFilter === key ? styles.categoryActive : ""}
              key={key}
              onClick={() => setStatusFilter(key)}
              type="button"
            >
              {label}
              <span>{countByStatus[key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className={styles.table}>
          {visibleProfiles.map((profile) => (
            <div key={profile.id}>
              <b>{profile.profile_name}</b>
              <span>{profile.masterEmail} · {profile.packageName ?? profile.service}</span>
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
              <button
                onClick={() => {
                  setEditingId(profile.id);
                  setEditForm({
                    masterEmailId: profile.master_email_id,
                    profileName: profile.profile_name,
                    pin: "",
                    status: profile.status,
                    profileExpiresAt: dateInputValue(profile.profile_expires_at),
                    note: profile.note ?? "",
                  });
                }}
                type="button"
              >
                แก้ไข
              </button>
              <button
                className={styles.danger}
                onClick={() => void removeProfile(profile.id, profile.profile_name)}
                type="button"
              >
                ลบ
              </button>
            </div>
          ))}
          {visibleProfiles.length === 0 && (
            <p className={styles.emptyInline}>ไม่พบ Slot ในหมวดหมู่/คำค้นนี้</p>
          )}
        </div>
      </section>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>ADD SLOT</p>
        <h2>เพิ่ม Slot โปรไฟล์</h2>
        <div className={styles.formRows}>
          <label>
            ห้อง / Email แม่
            <select
              value={selectedMasterEmailId}
              onChange={(event) =>
                setForm({ ...form, masterEmailId: event.target.value })
              }
            >
              <option value="">เลือกห้องบัญชีแม่</option>
              {(inventory?.masterEmails ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email} · {account.packageName ?? account.service}
                </option>
              ))}
            </select>
          </label>
          <label>
            ชื่อ Slot / Profile
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
            สถานะ
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              <option value="available">available</option>
              <option value="rented">rented</option>
              <option value="inactive">inactive</option>
              <option value="expired">expired</option>
              <option value="reserved">reserved</option>
            </select>
          </label>
          <label>
            Slot ใช้ได้ถึง
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
          <div className={styles.formActions}>
            <button
              className={styles.primary}
              disabled={!selectedMasterEmailId || !form.profileName}
              onClick={() => void submit()}
              type="button"
            >
              เพิ่ม Slot
            </button>
          </div>
        </div>
      </section>
    </div>
    {editingId && (
      <EditModal title="แก้ไข Slot โปรไฟล์" onClose={() => setEditingId(null)}>
        <div className={styles.formRows}>
          <label>
            ห้อง / Email แม่
            <select
              value={selectedEditMasterEmailId}
              onChange={(event) =>
                setEditForm({ ...editForm, masterEmailId: event.target.value })
              }
            >
              <option value="">เลือกห้องบัญชีแม่</option>
              {(inventory?.masterEmails ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email} · {account.packageName ?? account.service}
                </option>
              ))}
            </select>
          </label>
          <label>
            ชื่อ Slot / Profile
            <input
              value={editForm.profileName}
              onChange={(event) =>
                setEditForm({ ...editForm, profileName: event.target.value })
              }
            />
          </label>
          <label>
            PIN / Password (เว้นว่าง = ไม่เปลี่ยน)
            <input
              type="password"
              value={editForm.pin}
              onChange={(event) => setEditForm({ ...editForm, pin: event.target.value })}
            />
          </label>
          <label>
            สถานะ
            <select
              value={editForm.status}
              onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
            >
              <option value="available">available</option>
              <option value="rented">rented</option>
              <option value="inactive">inactive</option>
              <option value="expired">expired</option>
              <option value="reserved">reserved</option>
            </select>
          </label>
          <label>
            Slot ใช้ได้ถึง
            <input
              type="date"
              value={editForm.profileExpiresAt}
              onChange={(event) =>
                setEditForm({ ...editForm, profileExpiresAt: event.target.value })
              }
            />
          </label>
          <label>
            Note
            <input
              value={editForm.note}
              onChange={(event) => setEditForm({ ...editForm, note: event.target.value })}
            />
          </label>
          <div className={styles.formActions}>
            <button
              className={styles.primary}
              disabled={!selectedEditMasterEmailId || !editForm.profileName}
              onClick={() => void submitEdit()}
              type="button"
            >
              บันทึก Slot
            </button>
            <button className={styles.secondary} onClick={() => setEditingId(null)} type="button">
              ยกเลิก
            </button>
          </div>
        </div>
      </EditModal>
    )}
    </>
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
