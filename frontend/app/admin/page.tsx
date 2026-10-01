"use client";

import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  deleteAdminPackage,
  deleteMasterEmail,
  deletePaymentAccount,
  deleteProfile,
  expireProfileRental,
  fetchAuditLogs,
  fetchAdminInventory,
  fetchAdminSettings,
  saveAdminPackage,
  saveMasterEmail,
  savePaymentAccount,
  saveProfile,
  setDefaultPaymentAccount,
  suspendAdminUser,
  updateAdminPackage,
  updateAdminSettings,
  updateAdminUser,
  updateMasterEmail,
  updatePaymentAccount,
  updateProfile,
  updateProfileStatus,
  type AuditLogQuery,
  type AuditLogResponse,
  type AdminInventoryQuery,
  type AdminInventory,
  type PageMeta,
} from "../lib/api";
import { useSession } from "../providers";
import { DURATION_UNITS, formatDuration, splitDuration, toMinutes, type DurationUnit } from "../lib/duration";
import { Dashboard } from "./Dashboard";
import { DecoyRoomsPanel } from "./Decoys";
import { LineBotPanel } from "./LineBot";
import { PaymentSupportPanel } from "./PaymentSupport";
import { PendingTopupsPanel } from "./PendingTopups";
import { StreamersPanel, TopupPromotionsPanel } from "./Rewards";
import styles from "./page.module.css";

const menu = [
  ["dashboard", "Dashboard", "◭"],
  ["overview", "ภาพรวม", "◫"],
  ["packages", "โปรโมชัน", "▦"],
  ["accounts", "ห้อง / Email แม่", "◎"],
  ["profiles", "Slot / โปรไฟล์", "◉"],
  ["payments", "ตรวจสอบการชำระ", "฿"],
  ["users", "ผู้ใช้", "◍"],
  ["topupPromotions", "โปรเติมเงิน", "⬆"],
  ["streamers", "Streamer / โค้ด", "★"],
  ["decoys", "ห้องหลอก", "◌"],
  ["audit", "Audit log", "▣"],
  ["settings", "ตั้งค่าระบบ", "⚙"],
] as const;

type Section = (typeof menu)[number][0];

const defaultInventoryQuery: AdminInventoryQuery = {
  profilesPage: 1,
  profilesSearch: "",
  profilesStatus: "all",
  usersPage: 1,
  usersSearch: "",
  usersStatus: "all",
  transfersPage: 1,
  transfersSearch: "",
};

const defaultAuditQuery: AuditLogQuery = {
  page: 1,
  search: "",
  action: "",
  entityType: "",
  actorUserId: "",
  status: "",
  from: "",
  to: "",
};

const tomorrow = new Date(Date.now() + 1000 * 60 * 60 * 24)
  .toISOString()
  .slice(0, 10);

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function dateInputValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function dateOnlyToIso(value: string, mode: "start" | "end") {
  void mode;
  return value;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatBahtFromCents(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return (Number(value) / 100).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function runEdit(
  save: () => Promise<unknown>,
  successMessage: string,
  onDone: (message: string) => void,
) {
  try {
    await save();
  } catch (err) {
    window.alert(err instanceof Error ? err.message : "แก้ไขไม่สำเร็จ");
    return false;
  }
  onDone(successMessage);
  window.alert(successMessage);
  return true;
}

const rowMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const },
};

export default function AdminPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const [section, setSection] = useState<Section>("dashboard");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [inventory, setInventory] = useState<AdminInventory | null>(null);
  const [inventoryQuery, setInventoryQuery] = useState<AdminInventoryQuery>(defaultInventoryQuery);
  const [isLoading, setIsLoading] = useState(false);
  const currentTitle = menu.find(([key]) => key === section)?.[1] ?? "ภาพรวม";

  async function loadInventory(query = inventoryQuery) {
    setIsLoading(true);
    setError("");
    try {
      const data = await fetchAdminInventory(query);
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
      void loadInventory(inventoryQuery);
    });
  }, [user, inventoryQuery]);

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
          <div className={styles.headerActions}>
            <ThemeToggle />
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
          </div>
        </header>

        <AnimatePresence>
          {notice && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className={styles.notice}
              exit={{ opacity: 0, y: -8 }}
              initial={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <span>✓</span>{notice}
            </motion.div>
          )}
          {error && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className={styles.notice}
              exit={{ opacity: 0, y: -8 }}
              initial={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <span>!</span>{error}
            </motion.div>
          )}
        </AnimatePresence>

        {section === "dashboard" && <Dashboard />}
        {section === "overview" && <Overview inventory={inventory} />}
        {section === "packages" && (
          <PackagesPanel inventory={inventory} onDone={handleDone} />
        )}
        {section === "accounts" && (
          <AccountsPanel inventory={inventory} onDone={handleDone} />
        )}
        {section === "profiles" && (
          <ProfilesPanel
            inventory={inventory}
            query={inventoryQuery}
            setQuery={setInventoryQuery}
            onDone={handleDone}
          />
        )}
        {section === "users" && (
          <>
            <PendingTopupsPanel onDone={handleDone} />
            <UsersPanel
              inventory={inventory}
              currentUserId={user.id}
              query={inventoryQuery}
              setQuery={setInventoryQuery}
              onDone={handleDone}
            />
          </>
        )}
        {section === "payments" && <PaymentSupportPanel onDone={handleDone} />}
        {section === "topupPromotions" && <TopupPromotionsPanel onDone={handleDone} />}
        {section === "streamers" && <StreamersPanel onDone={handleDone} />}
        {section === "decoys" && (
          <DecoyRoomsPanel
            services={[...new Set((inventory?.masterEmails ?? []).map((account) => account.service))]}
            onDone={handleDone}
          />
        )}
        {section === "audit" && <AuditLogsPanel users={inventory?.users ?? []} />}
        {section === "settings" && <LineBotPanel onDone={handleDone} />}
        {section === "settings" && inventory && (
          <Settings
            inventory={inventory}
            query={inventoryQuery}
            setQuery={setInventoryQuery}
            onDone={handleDone}
          />
        )}
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
              <motion.div key={pkg.id} {...rowMotion}>
                <span className={`${styles.statusDot} ${styles.green}`} />
                <b>{pkg.name}</b>
                <span>{pkg.availableStock} profile</span>
                <em className={pkg.availableStock > 0 ? styles.green : styles.red}>
                  {pkg.availableStock > 0 ? "พร้อมขาย" : "หมด"}
                </em>
              </motion.div>
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

function PaginationControls({
  meta,
  onPageChange,
}: {
  meta?: PageMeta;
  onPageChange: (page: number) => void;
}) {
  if (!meta) return null;
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className={styles.pagination}>
      <span>
        {from.toLocaleString()}-{to.toLocaleString()} จาก {meta.total.toLocaleString()} รายการ · หน้า{" "}
        {meta.page.toLocaleString()} / {meta.totalPages.toLocaleString()}
      </span>
      <div>
        <button
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
          type="button"
        >
          ก่อนหน้า
        </button>
        <button
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
          type="button"
        >
          ถัดไป
        </button>
      </div>
    </div>
  );
}

function metadataText(metadata: Record<string, unknown>) {
  const text = JSON.stringify(metadata);
  if (text.length <= 260) return text;
  return `${text.slice(0, 260)}...`;
}

function metadataValue(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return value === null || value === undefined ? "" : String(value);
}

function AuditLogsPanel({ users }: { users: AdminInventory["users"] }) {
  const [query, setQuery] = useState<AuditLogQuery>(defaultAuditQuery);
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(nextQuery = query) {
    setLoading(true);
    setError("");
    try {
      setData(await fetchAuditLogs(nextQuery));
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลด Audit log ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(query);
  }, [query]);

  function patchQuery(patch: Partial<AuditLogQuery>) {
    setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>AUDIT TRAIL</p>
          <h2>Audit log ทั้งเว็บ</h2>
        </div>
        <div className={styles.panelTools}>
          <button className={styles.primary} onClick={() => void load()} type="button">
            รีเฟรช
          </button>
        </div>
      </div>

      <div className={styles.auditFilters}>
        <input
          className={styles.search}
          placeholder="ค้นหา action, user, path, metadata"
          value={query.search}
          onChange={(event) => patchQuery({ search: event.target.value })}
        />
        <select value={query.action} onChange={(event) => patchQuery({ action: event.target.value })}>
          <option value="">ทุก action</option>
          {(data?.actions ?? []).map((item) => (
            <option key={item.action} value={item.action}>
              {item.action} ({item.count})
            </option>
          ))}
        </select>
        <select value={query.entityType} onChange={(event) => patchQuery({ entityType: event.target.value })}>
          <option value="">ทุก entity</option>
          {(data?.entityTypes ?? []).map((item) => (
            <option key={item.entityType} value={item.entityType}>
              {item.entityType} ({item.count})
            </option>
          ))}
        </select>
        <select value={query.status} onChange={(event) => patchQuery({ status: event.target.value })}>
          <option value="">ทุก status</option>
          <option value="200">200</option>
          <option value="201">201</option>
          <option value="204">204</option>
          <option value="400">400</option>
          <option value="401">401</option>
          <option value="404">404</option>
          <option value="500">500</option>
        </select>
        <select value={query.actorUserId} onChange={(event) => patchQuery({ actorUserId: event.target.value })}>
          <option value="">ทุก user</option>
          {users.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.email}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={query.from}
          onChange={(event) => patchQuery({ from: event.target.value })}
        />
        <input
          type="date"
          value={query.to}
          onChange={(event) => patchQuery({ to: event.target.value })}
        />
        <button className={styles.secondary} onClick={() => setQuery(defaultAuditQuery)} type="button">
          ล้าง filter
        </button>
      </div>

      {error && <p className={styles.emptyInline}>{error}</p>}
      {loading && <p className={styles.emptyInline}>กำลังโหลด Audit log…</p>}

      <div className={`${styles.table} ${styles.auditTable}`}>
        {(data?.logs ?? []).map((log) => {
          const status = metadataValue(log.metadata, "status");
          const path = metadataValue(log.metadata, "path") || log.entityId || "-";
          const ip = metadataValue(log.metadata, "ip");
          return (
            <motion.div key={log.id} {...rowMotion}>
              <div className={styles.auditMain}>
                <b>{log.action}</b>
                <small>{formatDateTime(log.createdAt)}</small>
                <code>{path}</code>
                <p>{metadataText(log.metadata)}</p>
              </div>
              <em>{log.entityType}</em>
              <span>
                {log.actorName || log.actorEmail || "Guest"}
                {status ? ` · ${status}` : ""}
                {ip ? ` · ${ip}` : ""}
              </span>
            </motion.div>
          );
        })}
      </div>

      {!loading && (data?.logs.length ?? 0) === 0 && (
        <div className={styles.emptyState}>
          <span>▣</span>
          <h3>ยังไม่มี Audit log ตาม filter นี้</h3>
          <p>ลองล้าง filter หรือเลือกช่วงวันที่ใหม่</p>
        </div>
      )}

      <PaginationControls
        meta={data?.pagination}
        onPageChange={(page) => patchQuery({ page })}
      />
    </section>
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
  eyebrow = "EDIT",
  children,
  onClose,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className={styles.modalBackdrop}
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      role="presentation"
      transition={{ duration: 0.18 }}
      onMouseDown={onClose}
    >
      <motion.section
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={styles.modalCard}
        exit={{ opacity: 0, scale: 0.98, y: 10 }}
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHead}>
          <div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button className={styles.modalClose} onClick={onClose} type="button">
            ×
          </button>
        </div>
        {children}
      </motion.section>
    </motion.div>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <EditModal title={title} eyebrow="CONFIRM" onClose={onClose}>
      <p className={styles.modalText}>{message}</p>
      <div className={styles.formActions}>
        <button className={styles.dangerButton} onClick={onConfirm} type="button">
          {confirmLabel}
        </button>
        <button className={styles.secondary} onClick={onClose} type="button">
          ยกเลิก
        </button>
      </div>
    </EditModal>
  );
}

function DurationInput({
  value,
  unit,
  onChange,
}: {
  value: number;
  unit: DurationUnit;
  onChange: (value: number, unit: DurationUnit) => void;
}) {
  return (
    <span className={styles.durationInput}>
      <input
        inputMode="numeric"
        min={1}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value), unit)}
      />
      <select value={unit} onChange={(event) => onChange(value, event.target.value as DurationUnit)}>
        {DURATION_UNITS.map((item) => (
          <option key={item.unit} value={item.unit}>
            {item.label}
          </option>
        ))}
      </select>
      <small>= {formatDuration(toMinutes(value, unit))}</small>
    </span>
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
    durationValue: 7,
    durationUnit: "day" as DurationUnit,
    priceAmount: 49,
    currency: "THB",
    status: "active",
  });
  const [editForm, setEditForm] = useState(form);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingPackage, setDeletingPackage] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState("");
  const canSave = form.slug && form.name && toMinutes(form.durationValue, form.durationUnit) >= 1;
  const canSaveEdit = editForm.slug && editForm.name && toMinutes(editForm.durationValue, editForm.durationUnit) >= 1;
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
      durationValue: 7,
      durationUnit: "day",
      priceAmount: 49,
      currency: "THB",
      status: "active",
    });
  }

  function packagePayload(values: typeof form) {
    const { durationValue, durationUnit, ...rest } = values;
    return { ...rest, durationMinutes: toMinutes(durationValue, durationUnit) };
  }

  async function submit() {
    await saveAdminPackage(packagePayload(form));
    onDone(`เพิ่มโปรโมชัน ${form.name} แล้ว`);
    resetForm();
    setIsAdding(false);
  }

  async function submitEdit() {
    if (!editingId) return;
    const saved = await runEdit(
      () => updateAdminPackage(editingId, packagePayload(editForm)),
      `แก้ไขโปรโมชัน ${editForm.name} สำเร็จ`,
      onDone,
    );
    if (saved) setEditingId(null);
  }

  async function removePackage(packageId: string, name: string) {
    await deleteAdminPackage(packageId);
    onDone(`Archive โปรโมชัน ${name} แล้ว`);
    if (editingId === packageId) setEditingId(null);
    setDeletingPackage(null);
  }

  return (
    <>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>CUSTOMER PROMOTIONS</p>
            <h2>โปรโมชันให้ลูกค้าเลือก</h2>
          </div>
          <div className={styles.panelTools}>
            <input
              className={styles.search}
              placeholder="ค้นหาโปรโมชัน"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className={styles.primary} onClick={() => setIsAdding(true)} type="button">
              เพิ่ม
            </button>
          </div>
        </div>
        <div className={styles.packageAdmin}>
          {visiblePackages.map((pkg) => (
            <motion.div key={pkg.id} {...rowMotion}>
              <span>{pkg.slug}</span>
              <b>{pkg.price_amount} Point · {formatDuration(Number(pkg.duration_minutes))}</b>
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
                    ...(() => {
                      const { value, unit } = splitDuration(Number(pkg.duration_minutes));
                      return { durationValue: value, durationUnit: unit };
                    })(),
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
                onClick={() => setDeletingPackage({ id: pkg.id, name: pkg.name })}
              >
                ลบ
              </button>
            </motion.div>
          ))}
          {visiblePackages.length === 0 && (
            <p className={styles.emptyInline}>ไม่พบโปรโมชันที่ค้นหา</p>
          )}
        </div>
      </section>
    <AnimatePresence>
      {isAdding && (
        <EditModal title="เพิ่มโปรโมชัน" eyebrow="ADD" onClose={() => setIsAdding(false)}>
        <div className={styles.formRows}>
          <p className={styles.muted}>
            สร้างโปรโมชันใหม่ให้ลูกค้าเลือกหลังเลือก slot
          </p>
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
            <DurationInput
              value={form.durationValue}
              unit={form.durationUnit}
              onChange={(durationValue, durationUnit) => setForm({ ...form, durationValue, durationUnit })}
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
        </EditModal>
      )}
    </AnimatePresence>
    <AnimatePresence>
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
            <DurationInput
              value={editForm.durationValue}
              unit={editForm.durationUnit}
              onChange={(durationValue, durationUnit) => setEditForm({ ...editForm, durationValue, durationUnit })}
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
    </AnimatePresence>
    <AnimatePresence>
      {deletingPackage && (
        <ConfirmModal
          title="ลบโปรโมชัน"
          message={`ต้องการลบ/Archive โปรโมชัน ${deletingPackage.name} ใช่ไหม?`}
          confirmLabel="ลบโปรโมชัน"
          onClose={() => setDeletingPackage(null)}
          onConfirm={() => void removePackage(deletingPackage.id, deletingPackage.name)}
        />
      )}
    </AnimatePresence>
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
  const serviceOptions = Array.from(new Set([
    ...(inventory?.packages ?? []).map((pkg) => pkg.service),
    ...(inventory?.masterEmails ?? []).map((account) => account.service),
    "netflix",
  ].filter(Boolean))).sort();
  const defaultService = serviceOptions[0] ?? "netflix";
  const [form, setForm] = useState({
    service: defaultService,
    email: "",
    password: "",
    accountPin: "",
    mailboxPassword: "",
    purchasedAt: tomorrow,
    masterExpiredAt: tomorrow,
    status: "active",
    maxProfiles: 5,
    note: "",
  });
  const [editForm, setEditForm] = useState(form);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingAccount = (inventory?.masterEmails ?? []).find((account) => account.id === editingId);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState<{ id: string; email: string } | null>(null);
  const [search, setSearch] = useState("");
  const visibleAccounts = (inventory?.masterEmails ?? []).filter((account) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [
      account.email,
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
      service: defaultService,
      email: "",
      password: "",
      accountPin: "",
      mailboxPassword: "",
      purchasedAt: tomorrow,
      masterExpiredAt: tomorrow,
      status: "active",
      maxProfiles: 5,
      note: "",
    });
  }

  async function submit() {
    const payload = {
      ...form,
      accountPin: form.accountPin.trim() || undefined,
      mailboxPassword: form.mailboxPassword.trim() || undefined,
      service: form.service.trim().toLowerCase(),
      purchasedAt: dateOnlyToIso(form.purchasedAt, "start"),
      masterExpiredAt: dateOnlyToIso(form.masterExpiredAt, "end"),
    };
    await saveMasterEmail(payload);
    onDone("เพิ่มห้องบัญชีแม่และเข้ารหัส password แล้ว");
    resetForm();
    setIsAdding(false);
  }

  async function submitEdit() {
    if (!editingId) return;
    const saved = await runEdit(
      () =>
        updateMasterEmail(editingId, {
          ...editForm,
          service: editForm.service.trim().toLowerCase(),
          password: editForm.password || undefined,
          accountPin: editForm.accountPin.trim() || undefined,
          mailboxPassword: editForm.mailboxPassword.trim() || undefined,
          purchasedAt: dateOnlyToIso(editForm.purchasedAt, "start"),
          masterExpiredAt: dateOnlyToIso(editForm.masterExpiredAt, "end"),
        }),
      `แก้ไขห้อง ${editForm.email} สำเร็จ`,
      onDone,
    );
    if (saved) setEditingId(null);
  }

  async function removeAccount(accountId: string, email: string) {
    await deleteMasterEmail(accountId);
    onDone(`ปิดห้อง ${email} แล้ว`);
    if (editingId === accountId) setEditingId(null);
    setDeletingAccount(null);
  }

  return (
    <>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>ROOM ACCOUNTS</p>
            <h2>ห้อง / Email แม่</h2>
          </div>
          <div className={styles.panelTools}>
            <input
              className={styles.search}
              placeholder="ค้นหาห้อง"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className={styles.primary} onClick={() => setIsAdding(true)} type="button">
              เพิ่ม
            </button>
          </div>
        </div>
        <div className={styles.table}>
          {visibleAccounts.map((account) => (
            <motion.div key={account.id} {...rowMotion}>
              <b>{account.email}</b>
              <span>
                {account.service} · {account.availableProfiles} / {account.profileCount} slot (max {account.maxProfiles})
              </span>
              <em className={account.status === "active" ? styles.green : styles.yellow}>
                {account.status}
              </em>
              <button
                type="button"
                onClick={() => {
                  setEditingId(account.id);
                  setEditForm({
                    service: account.service,
                    email: account.email,
                    password: "",
                    accountPin: "",
                    mailboxPassword: "",
                    purchasedAt: dateInputValue(account.purchased_at) || tomorrow,
                    masterExpiredAt: dateInputValue(account.master_expired_at) || tomorrow,
                    status: account.status,
                    maxProfiles: account.maxProfiles ?? 5,
                    note: account.note ?? "",
                  });
                }}
              >
                แก้ไข
              </button>
              <button
                className={styles.danger}
                type="button"
                onClick={() => setDeletingAccount({ id: account.id, email: account.email })}
              >
                ลบ
              </button>
            </motion.div>
          ))}
          {visibleAccounts.length === 0 && (
            <p className={styles.emptyInline}>ไม่พบห้องที่ค้นหา</p>
          )}
        </div>
      </section>
    <AnimatePresence>
      {isAdding && (
        <EditModal title="เพิ่มห้องบัญชีแม่" eyebrow="ADD" onClose={() => setIsAdding(false)}>
        <div className={styles.formRows}>
          <label>
            Service
            <input
              list="account-service-options"
              placeholder="เช่น netflix"
              value={form.service}
              onChange={(event) => setForm({ ...form, service: event.target.value })}
            />
          </label>
          <datalist id="account-service-options">
            {serviceOptions.map((service) => (
              <option key={service} value={service} />
            ))}
          </datalist>
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
            PIN บัญชีแม่ (ถ้ามี · ใช้เปลี่ยน PIN โปรไฟล์อัตโนมัติ)
            <input
              inputMode="numeric"
              maxLength={4}
              value={form.accountPin}
              onChange={(event) => setForm({ ...form, accountPin: event.target.value.replace(/\D/g, "") })}
            />
          </label>
          <label>
            Gmail App Password ของอีเมลนี้ (ใช้ดึงรหัสยืนยันจาก Netflix ตอนเพิ่ม/ลบอีเมลโปรไฟล์)
            <input
              type="password"
              autoComplete="new-password"
              value={form.mailboxPassword}
              onChange={(event) => setForm({ ...form, mailboxPassword: event.target.value })}
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
            จำนวน Profile สูงสุด (Capacity)
            <input
              inputMode="numeric"
              min={1}
              max={100}
              value={form.maxProfiles}
              onChange={(event) =>
                setForm({ ...form, maxProfiles: Number(event.target.value) })
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
              disabled={!form.service.trim() || !form.email || !form.password}
              onClick={() => void submit()}
              type="button"
            >
              เพิ่มห้องและ Encrypt
            </button>
          </div>
        </div>
        </EditModal>
      )}
    </AnimatePresence>
    <AnimatePresence>
      {editingId && (
        <EditModal title="แก้ไขห้องบัญชีแม่" onClose={() => setEditingId(null)}>
        <div className={styles.formRows}>
          <label>
            Service
            <input
              list="account-service-options"
              placeholder="เช่น netflix"
              value={editForm.service}
              onChange={(event) => setEditForm({ ...editForm, service: event.target.value })}
            />
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
            PIN บัญชีแม่ ({editingAccount?.hasAccountPin ? "มีแล้ว · เว้นว่าง = ไม่เปลี่ยน" : "ยังไม่ได้ตั้ง"})
            <input
              inputMode="numeric"
              maxLength={4}
              value={editForm.accountPin}
              onChange={(event) => setEditForm({ ...editForm, accountPin: event.target.value.replace(/\D/g, "") })}
            />
          </label>
          <label>
            Gmail App Password ({editingAccount?.hasMailboxPassword ? "มีแล้ว · เว้นว่าง = ไม่เปลี่ยน" : "ยังไม่ได้ตั้ง"})
            <input
              type="password"
              autoComplete="new-password"
              value={editForm.mailboxPassword}
              onChange={(event) => setEditForm({ ...editForm, mailboxPassword: event.target.value })}
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
            จำนวน Profile สูงสุด (Capacity)
            <input
              inputMode="numeric"
              min={1}
              max={100}
              value={editForm.maxProfiles}
              onChange={(event) =>
                setEditForm({ ...editForm, maxProfiles: Number(event.target.value) })
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
              disabled={!editForm.service.trim() || !editForm.email}
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
    </AnimatePresence>
    <AnimatePresence>
      {deletingAccount && (
        <ConfirmModal
          title="ลบห้องบัญชีแม่"
          message={`ต้องการลบ/ปิดห้อง ${deletingAccount.email} ใช่ไหม? Slot ที่ไม่ได้เช่าอยู่จะถูกปิดด้วย`}
          confirmLabel="ลบห้อง"
          onClose={() => setDeletingAccount(null)}
          onConfirm={() => void removeAccount(deletingAccount.id, deletingAccount.email)}
        />
      )}
    </AnimatePresence>
    </>
  );
}

function ProfilesPanel({
  inventory,
  query,
  setQuery,
  onDone,
}: {
  inventory: AdminInventory | null;
  query: AdminInventoryQuery;
  setQuery: Dispatch<SetStateAction<AdminInventoryQuery>>;
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
  const [isAdding, setIsAdding] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState<{ id: string; name: string } | null>(null);
  const [expiringProfile, setExpiringProfile] = useState<{ id: string; name: string } | null>(null);
  const selectedMasterEmailId = form.masterEmailId || firstAccount;
  const selectedEditMasterEmailId = editForm.masterEmailId || firstAccount;
  const profiles = inventory?.profiles ?? [];
  const profileCounts = inventory?.counts?.profiles ?? { all: 0 };
  const profilePage = inventory?.pagination?.profiles;
  const statusTabs = [
    ["all", "ทั้งหมด"],
    ["available", "ว่าง"],
    ["rented", "เช่าอยู่"],
    ["reserved", "จองไว้"],
    ["inactive", "ปิดใช้งาน"],
    ["expired", "หมดอายุ"],
  ] as const;

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
        ? dateOnlyToIso(form.profileExpiresAt, "end")
        : undefined,
    };
    await saveProfile(payload);
    onDone("เพิ่ม Slot และเข้ารหัส PIN แล้ว");
    resetForm();
    setIsAdding(false);
  }

  async function submitEdit() {
    if (!editingId) return;
    const saved = await runEdit(
      () =>
        updateProfile(editingId, {
          ...editForm,
          masterEmailId: selectedEditMasterEmailId,
          pin: editForm.pin || undefined,
          profileExpiresAt: editForm.profileExpiresAt
            ? dateOnlyToIso(editForm.profileExpiresAt, "end")
            : null,
        }),
      `แก้ไข Slot ${editForm.profileName} สำเร็จ`,
      onDone,
    );
    if (saved) setEditingId(null);
  }

  async function changeStatus(profileId: string, status: string) {
    await runEdit(
      () => updateProfileStatus(profileId, status),
      `เปลี่ยนสถานะ profile เป็น ${status} แล้ว`,
      onDone,
    );
  }

  async function expireProfile(profileId: string, profileName: string) {
    setExpiringProfile(null);
    try {
      const { pinRotation } = await expireProfileRental(profileId);
      const message = pinRotation
        ? `${profileName} หมดเวลาแล้ว · ระบบกำลังเปลี่ยน PIN และจะปล่อย Slot ภายใน 1 นาที`
        : `${profileName} หมดเวลาแล้ว · ปล่อย Slot แล้ว (ไม่ได้เปลี่ยน PIN อัตโนมัติ กรุณาเปลี่ยนเอง)`;
      onDone(message);
      window.alert(message);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    }
  }

  async function removeProfile(profileId: string, profileName: string) {
    setDeletingProfile(null);
    const removed = await runEdit(() => deleteProfile(profileId), `ลบ Slot ${profileName} แล้ว`, onDone);
    if (removed && editingId === profileId) setEditingId(null);
  }

  return (
    <>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>ROOM SLOTS</p>
            <h2>Slot / โปรไฟล์ที่ดูได้</h2>
          </div>
          <div className={styles.panelTools}>
            <input
              className={styles.search}
              placeholder="ค้นหา slot"
              value={query.profilesSearch}
              onChange={(event) =>
                setQuery((current) => ({
                  ...current,
                  profilesSearch: event.target.value,
                  profilesPage: 1,
                }))
              }
            />
            <button className={styles.primary} onClick={() => setIsAdding(true)} type="button">
              เพิ่ม
            </button>
          </div>
        </div>
        <div className={styles.categoryTabs}>
          {statusTabs.map(([key, label]) => (
            <button
              className={query.profilesStatus === key ? styles.categoryActive : ""}
              key={key}
              onClick={() =>
                setQuery((current) => ({
                  ...current,
                  profilesStatus: key,
                  profilesPage: 1,
                }))
              }
              type="button"
            >
              {label}
              <span>{profileCounts[key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className={styles.table}>
          {profiles.map((profile) => (
            <motion.div key={profile.id} {...rowMotion}>
              <b>{profile.profile_name}</b>
              <span>{profile.masterEmail} · {profile.service} · {(() => {
                const room = (inventory?.masterEmails ?? []).find((a) => a.id === profile.master_email_id);
                return room ? `${room.profileCount}/${room.maxProfiles}` : "";
              })()}</span>
              <em className={profile.status === "available" ? styles.green : styles.yellow}>
                {profile.status}
              </em>
              <button
                disabled={profile.status === "rented" || profile.status === "reserved"}
                title={profile.status === "rented" ? "Slot นี้มีลูกค้าเช่าอยู่" : undefined}
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
              {profile.status === "rented" && (
                <button
                  className={styles.danger}
                  onClick={() => setExpiringProfile({ id: profile.id, name: profile.profile_name })}
                  type="button"
                >
                  หมดเวลา
                </button>
              )}
              <button
                className={styles.danger}
                onClick={() => setDeletingProfile({ id: profile.id, name: profile.profile_name })}
                type="button"
              >
                ลบ
              </button>
            </motion.div>
          ))}
          {profiles.length === 0 && (
            <p className={styles.emptyInline}>ไม่พบ Slot ในหมวดหมู่/คำค้นนี้</p>
          )}
        </div>
        <PaginationControls
          meta={profilePage}
          onPageChange={(page) =>
            setQuery((current) => ({
              ...current,
              profilesPage: page,
            }))
          }
        />
      </section>
    <AnimatePresence>
      {isAdding && (
        <EditModal title="เพิ่ม Slot โปรไฟล์" eyebrow="ADD" onClose={() => setIsAdding(false)}>
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
              {(inventory?.masterEmails ?? []).map((account) => {
                const isFull = account.profileCount >= account.maxProfiles;
                return (
                  <option key={account.id} value={account.id}>
                    {account.email} · {account.service} · {account.profileCount}/{account.maxProfiles} profile{isFull ? " (เต็ม)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {(() => {
            const selected = (inventory?.masterEmails ?? []).find((a) => a.id === selectedMasterEmailId);
            if (selected && selected.profileCount >= selected.maxProfiles) {
              return <p style={{ color: "var(--red, #f04)", fontSize: "0.85rem" }}>ห้องนี้เต็มแล้ว ({selected.profileCount}/{selected.maxProfiles}) กรุณาเลือกห้องอื่นหรือเพิ่ม Capacity</p>;
            }
            return null;
          })()}
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
            Slot ใช้ได้ถึง (เว้นว่าง = ตามวันหมดอายุ Email แม่)
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
              disabled={!selectedMasterEmailId || !form.profileName || (() => {
                const selected = (inventory?.masterEmails ?? []).find((a) => a.id === selectedMasterEmailId);
                return Boolean(selected && selected.profileCount >= selected.maxProfiles);
              })()}
              onClick={() => void submit()}
              type="button"
            >
              เพิ่ม Slot
            </button>
          </div>
        </div>
        </EditModal>
      )}
    </AnimatePresence>
    <AnimatePresence>
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
                  {account.email} · {account.service}
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
            Slot ใช้ได้ถึง (เว้นว่าง = ตามวันหมดอายุ Email แม่)
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
    </AnimatePresence>
    <AnimatePresence>
      {deletingProfile && (
        <ConfirmModal
          title="ลบ Slot โปรไฟล์"
          message={`ต้องการลบ/ปิด Slot ${deletingProfile.name} ใช่ไหม?`}
          confirmLabel="ลบ Slot"
          onClose={() => setDeletingProfile(null)}
          onConfirm={() => void removeProfile(deletingProfile.id, deletingProfile.name)}
        />
      )}
    </AnimatePresence>
    <AnimatePresence>
      {expiringProfile && (
        <ConfirmModal
          title="ให้ Slot หมดเวลาทันที"
          message={`จบการเช่าของ ${expiringProfile.name} ตอนนี้เลยใช่ไหม? ลูกค้าจะได้รับอีเมลแจ้งหมดอายุ`}
          confirmLabel="หมดเวลาเลย"
          onClose={() => setExpiringProfile(null)}
          onConfirm={() => void expireProfile(expiringProfile.id, expiringProfile.name)}
        />
      )}
    </AnimatePresence>
    </>
  );
}

function UsersPanel({
  inventory,
  currentUserId,
  query,
  setQuery,
  onDone,
}: {
  inventory: AdminInventory | null;
  currentUserId: string;
  query: AdminInventoryQuery;
  setQuery: Dispatch<SetStateAction<AdminInventoryQuery>>;
  onDone: (message: string) => void;
}) {
  const users = inventory?.users ?? [];
  const userCounts = inventory?.counts?.users ?? { all: 0, admin: 0 };
  const userPage = inventory?.pagination?.users;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statusAction, setStatusAction] = useState<{
    id: string;
    name: string;
    status: "active" | "suspended";
  } | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    role: "user" as "user" | "admin",
    status: "active" as "active" | "suspended",
    points: 0,
  });
  const statusTabs = [
    ["all", "ทั้งหมด"],
    ["active", "ใช้งาน"],
    ["suspended", "ปิดบัญชี"],
    ["admin", "Admin"],
  ] as const;

  async function submitEdit() {
    if (!editingId) return;
    const saved = await runEdit(
      () => updateAdminUser(editingId, editForm),
      `แก้ไขผู้ใช้ ${editForm.name} สำเร็จ`,
      onDone,
    );
    if (saved) setEditingId(null);
  }

  async function toggleStatus(userId: string, name: string, status: string) {
    if (status === "active") {
      await suspendAdminUser(userId);
      onDone(`ปิดบัญชี ${name} แล้ว`);
      setStatusAction(null);
      return;
    }
    await updateAdminUser(userId, { status: "active" });
    onDone(`เปิดบัญชี ${name} แล้ว`);
    setStatusAction(null);
  }

  return (
    <>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>CUSTOMERS & ADMINS</p>
            <h2>จัดการผู้ใช้ในระบบ</h2>
          </div>
          <input
            className={styles.search}
            placeholder="ค้นหาผู้ใช้"
            value={query.usersSearch}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                usersSearch: event.target.value,
                usersPage: 1,
              }))
            }
          />
        </div>
        <div className={styles.categoryTabs}>
          {statusTabs.map(([key, label]) => (
            <button
              className={query.usersStatus === key ? styles.categoryActive : ""}
              key={key}
              onClick={() =>
                setQuery((current) => ({
                  ...current,
                  usersStatus: key,
                  usersPage: 1,
                }))
              }
              type="button"
            >
              {label}
              <span>{userCounts[key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className={styles.table}>
          {users.map((item) => (
            <motion.div key={item.id} {...rowMotion}>
              {item.image
                ? <Image src={item.image} alt="" width={30} height={30} className={styles.userAvatar} />
                : <span className={styles.userAvatarFallback}>{item.name.slice(0, 1).toUpperCase()}</span>
              }
              <b className={styles.userName}>{item.name}</b>
              <span>
                {item.email} · {Number(item.points).toLocaleString()} Point · ใช้งาน {item.activeSubscriptionCount}
              </span>
              <em className={item.status === "active" ? styles.green : styles.yellow}>
                {item.role}/{item.status}
              </em>
              <button
                onClick={() => {
                  setEditingId(item.id);
                  setEditForm({
                    name: item.name,
                    role: item.role,
                    status: item.status,
                    points: Number(item.points),
                  });
                }}
                type="button"
              >
                แก้ไข
              </button>
              <button
                className={item.status === "active" ? styles.danger : ""}
                disabled={item.id === currentUserId && item.status === "active"}
                onClick={() =>
                  setStatusAction({
                    id: item.id,
                    name: item.name,
                    status: item.status,
                  })
                }
                type="button"
              >
                {item.status === "active" ? "ปิด" : "เปิด"}
              </button>
            </motion.div>
          ))}
          {users.length === 0 && (
            <p className={styles.emptyInline}>ไม่พบผู้ใช้ในหมวดหมู่/คำค้นนี้</p>
          )}
        </div>
        <PaginationControls
          meta={userPage}
          onPageChange={(page) =>
            setQuery((current) => ({
              ...current,
              usersPage: page,
            }))
          }
        />
      </section>
      <AnimatePresence>
        {editingId && (
          <EditModal title="แก้ไขผู้ใช้" onClose={() => setEditingId(null)}>
            <div className={styles.formRows}>
              <label>
                ชื่อ
                <input
                  value={editForm.name}
                  onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                />
              </label>
              <label>
                Role
                <select
                  value={editForm.role}
                  onChange={(event) =>
                    setEditForm({ ...editForm, role: event.target.value as "user" | "admin" })
                  }
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <label>
                สถานะ
                <select
                  value={editForm.status}
                  onChange={(event) =>
                    setEditForm({ ...editForm, status: event.target.value as "active" | "suspended" })
                  }
                >
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                </select>
              </label>
              <label>
                Point คงเหลือ
                <input
                  inputMode="numeric"
                  min={0}
                  value={editForm.points}
                  onChange={(event) =>
                    setEditForm({ ...editForm, points: Number(event.target.value) })
                  }
                />
              </label>
              <div className={styles.formActions}>
                <button
                  className={styles.primary}
                  disabled={!editForm.name || editForm.points < 0}
                  onClick={() => void submitEdit()}
                  type="button"
                >
                  บันทึกผู้ใช้
                </button>
                <button className={styles.secondary} onClick={() => setEditingId(null)} type="button">
                  ยกเลิก
                </button>
              </div>
            </div>
          </EditModal>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {statusAction && (
          <ConfirmModal
            title={statusAction.status === "active" ? "ปิดบัญชีผู้ใช้" : "เปิดบัญชีผู้ใช้"}
            message={
              statusAction.status === "active"
                ? `ต้องการปิดบัญชี ${statusAction.name} ใช่ไหม? ผู้ใช้นี้จะ login และซื้อสินค้าไม่ได้`
                : `ต้องการเปิดบัญชี ${statusAction.name} ให้กลับมาใช้งานได้ใช่ไหม?`
            }
            confirmLabel={statusAction.status === "active" ? "ปิดบัญชี" : "เปิดบัญชี"}
            onClose={() => setStatusAction(null)}
            onConfirm={() => void toggleStatus(statusAction.id, statusAction.name, statusAction.status)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

type PaymentAccountForm = {
  name: string;
  promptPayId: string;
  lineCookie: string;
  status: "active" | "inactive";
  isDefault: boolean;
  topupExpiresMinutes: number;
  note: string;
};

function blankPaymentAccountForm(): PaymentAccountForm {
  return {
    name: "",
    promptPayId: "",
    lineCookie: "",
    status: "active",
    isDefault: false,
    topupExpiresMinutes: 15,
    note: "",
  };
}

function TopupSettingsPanel({ onDone }: { onDone: (message: string) => void }) {
  const [minTopupPoints, setMinTopupPoints] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    fetchAdminSettings()
      .then((settings) => {
        setMinTopupPoints(settings.minTopupPoints);
        setDraft(String(settings.minTopupPoints));
      })
      .catch(() => undefined);
  }, []);

  const value = Number(draft);
  const canSave = Number.isInteger(value) && value >= 1 && value !== minTopupPoints;

  async function save() {
    let saved = minTopupPoints;
    const ok = await runEdit(
      async () => {
        saved = (await updateAdminSettings({ minTopupPoints: value })).minTopupPoints;
      },
      `ตั้งยอดเติมขั้นต่ำเป็น ${value} บาท สำเร็จ`,
      onDone,
    );
    if (ok) setMinTopupPoints(saved);
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>TOP-UP</p>
          <h2>ตั้งค่าการเติม Point</h2>
          <p className={styles.muted}>
            ยอดเติมขั้นต่ำที่ลูกค้าสร้างรายการได้ (1 บาท = 1 Point)
            {minTopupPoints !== null ? ` · ตอนนี้ ${minTopupPoints} บาท` : ""}
          </p>
        </div>
        <div className={styles.panelTools}>
          <input
            aria-label="ยอดเติมขั้นต่ำ (บาท)"
            className={styles.search}
            inputMode="numeric"
            min={1}
            type="number"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className={styles.primary} disabled={!canSave} onClick={() => void save()} type="button">
            บันทึก
          </button>
        </div>
      </div>
    </section>
  );
}

function Settings({
  inventory,
  query,
  setQuery,
  onDone,
}: {
  inventory: AdminInventory;
  query: AdminInventoryQuery;
  setQuery: Dispatch<SetStateAction<AdminInventoryQuery>>;
  onDone: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminInventory["paymentAccounts"][number] | null>(null);
  const [form, setForm] = useState<PaymentAccountForm>(blankPaymentAccountForm);
  const accounts = inventory.paymentAccounts ?? [];
  const transferEvents = inventory.lineTransferEvents ?? [];
  const transferPage = inventory.pagination.lineTransferEvents;
  const visibleAccounts = accounts.filter((account) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [
      account.name,
      account.promptPayIdMasked,
      account.status,
      account.note,
      account.isDefault ? "default" : "",
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const editingAccount = accounts.find((account) => account.id === editingId);

  function beginAdd() {
    setForm(blankPaymentAccountForm());
    setIsAdding(true);
  }

  function beginEdit(account: AdminInventory["paymentAccounts"][number]) {
    setForm({
      name: account.name,
      promptPayId: "",
      lineCookie: "",
      status: account.status,
      isDefault: account.isDefault,
      topupExpiresMinutes: Number(account.topupExpiresMinutes),
      note: account.note ?? "",
    });
    setEditingId(account.id);
  }

  async function submitCreate() {
    await savePaymentAccount({
      name: form.name,
      promptPayId: form.promptPayId,
      lineCookie: form.lineCookie || null,
      status: form.status,
      isDefault: form.isDefault,
      topupExpiresMinutes: Number(form.topupExpiresMinutes),
      note: form.note || null,
    });
    onDone(`เพิ่มบัญชีรับเงิน ${form.name} แล้ว`);
    setIsAdding(false);
  }

  async function submitEdit() {
    if (!editingId) return;
    const saved = await runEdit(
      () =>
        updatePaymentAccount(editingId, {
          name: form.name,
          ...(form.promptPayId.trim() ? { promptPayId: form.promptPayId.trim() } : {}),
          ...(form.lineCookie.trim() ? { lineCookie: form.lineCookie } : {}),
          status: form.status,
          isDefault: form.isDefault,
          topupExpiresMinutes: Number(form.topupExpiresMinutes),
          note: form.note || null,
        }),
      `แก้ไขบัญชีรับเงิน ${form.name} สำเร็จ`,
      onDone,
    );
    if (saved) setEditingId(null);
  }

  async function makeDefault(account: AdminInventory["paymentAccounts"][number]) {
    await setDefaultPaymentAccount(account.id);
    onDone(`เลือก ${account.name} เป็นบัญชีรับเงินหลักแล้ว`);
  }

  async function removeAccount() {
    if (!deleteTarget) return;
    await deletePaymentAccount(deleteTarget.id);
    onDone(`ลบบัญชีรับเงิน ${deleteTarget.name} แล้ว`);
    setDeleteTarget(null);
  }

  return (
    <>
      <TopupSettingsPanel onDone={onDone} />
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>PAYMENT ACCOUNTS</p>
            <h2>ตั้งค่าบัญชีรับเงิน</h2>
          </div>
          <div className={styles.panelTools}>
            <input
              className={styles.search}
              placeholder="ค้นหาบัญชี"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className={styles.primary} onClick={beginAdd} type="button">
              เพิ่มบัญชี
            </button>
          </div>
        </div>
        <div className={styles.table}>
          {visibleAccounts.map((account) => (
            <motion.div key={account.id} {...rowMotion}>
              <b>{account.name}</b>
              <span>
                PromptPay {account.promptPayIdMasked} · QR หมดอายุ {account.topupExpiresMinutes} นาที · LINE{" "}
                {account.hasLineCookie ? "พร้อมใช้" : "ยังไม่ใส่ cookie"}
              </span>
              <em className={account.status === "active" ? styles.green : styles.yellow}>
                {account.isDefault ? "default" : account.status}
              </em>
              <button
                disabled={account.isDefault || account.status !== "active"}
                onClick={() => void makeDefault(account)}
                type="button"
              >
                ใช้บัญชีนี้
              </button>
              <button onClick={() => beginEdit(account)} type="button">
                แก้ไข
              </button>
              <button
                className={styles.danger}
                onClick={() => setDeleteTarget(account)}
                type="button"
              >
                ลบ
              </button>
            </motion.div>
          ))}
          {visibleAccounts.length === 0 && (
            <p className={styles.emptyInline}>ยังไม่มีบัญชีรับเงิน หรือไม่พบรายการที่ค้นหา</p>
          )}
        </div>
        <p className={styles.hint}>
          PromptPay ID และ LINE cookie ถูก encrypt ที่ backend และหน้า Admin จะแสดงเฉพาะข้อมูลแบบ mask เท่านั้น
        </p>
      </section>

      <AnimatePresence>
        {isAdding && (
          <EditModal title="เพิ่มบัญชีรับเงิน" eyebrow="ADD" onClose={() => setIsAdding(false)}>
            <div className={styles.formRows}>
              <label>
                ชื่อบัญชี
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label>
                PromptPay ID
                <input
                  value={form.promptPayId}
                  onChange={(event) => setForm({ ...form, promptPayId: event.target.value })}
                />
              </label>
              <label>
                LINE cookie
                <textarea
                  rows={4}
                  value={form.lineCookie}
                  onChange={(event) => setForm({ ...form, lineCookie: event.target.value })}
                />
              </label>
              <label>
                QR หมดอายุ (นาที)
                <input
                  inputMode="numeric"
                  min={1}
                  max={1440}
                  value={form.topupExpiresMinutes}
                  onChange={(event) =>
                    setForm({ ...form, topupExpiresMinutes: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                สถานะ
                <select
                  value={form.status}
                  onChange={(event) => {
                    const status = event.target.value as "active" | "inactive";
                    setForm({ ...form, status, isDefault: status === "active" ? form.isDefault : false });
                  }}
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>
              <label>
                ใช้เป็น default
                <input
                  checked={form.isDefault}
                  type="checkbox"
                  onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
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
                  disabled={
                    !form.name.trim()
                    || !form.promptPayId.trim()
                    || form.topupExpiresMinutes < 1
                    || form.topupExpiresMinutes > 1440
                  }
                  onClick={() => void submitCreate()}
                  type="button"
                >
                  บันทึกบัญชี
                </button>
                <button className={styles.secondary} onClick={() => setIsAdding(false)} type="button">
                  ยกเลิก
                </button>
              </div>
            </div>
          </EditModal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingId && editingAccount && (
          <EditModal title="แก้ไขบัญชีรับเงิน" onClose={() => setEditingId(null)}>
            <div className={styles.formRows}>
              <p className={styles.muted}>
                บัญชีนี้ใช้ PromptPay {editingAccount.promptPayIdMasked} และ LINE{" "}
                {editingAccount.hasLineCookie ? "มี cookie แล้ว" : "ยังไม่มี cookie"}
              </p>
              <label>
                ชื่อบัญชี
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label>
                PromptPay ID ใหม่
                <input
                  placeholder="เว้นว่างถ้าไม่เปลี่ยน"
                  value={form.promptPayId}
                  onChange={(event) => setForm({ ...form, promptPayId: event.target.value })}
                />
              </label>
              <label>
                LINE cookie ใหม่
                <textarea
                  placeholder="เว้นว่างถ้าไม่เปลี่ยน"
                  rows={4}
                  value={form.lineCookie}
                  onChange={(event) => setForm({ ...form, lineCookie: event.target.value })}
                />
              </label>
              <label>
                QR หมดอายุ (นาที)
                <input
                  inputMode="numeric"
                  min={1}
                  max={1440}
                  value={form.topupExpiresMinutes}
                  onChange={(event) =>
                    setForm({ ...form, topupExpiresMinutes: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                สถานะ
                <select
                  value={form.status}
                  onChange={(event) => {
                    const status = event.target.value as "active" | "inactive";
                    setForm({ ...form, status, isDefault: status === "active" ? form.isDefault : false });
                  }}
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>
              <label>
                ใช้เป็น default
                <input
                  checked={form.isDefault}
                  disabled={form.status !== "active"}
                  type="checkbox"
                  onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
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
                  disabled={
                    !form.name.trim()
                    || form.topupExpiresMinutes < 1
                    || form.topupExpiresMinutes > 1440
                  }
                  onClick={() => void submitEdit()}
                  type="button"
                >
                  บันทึกบัญชี
                </button>
                <button className={styles.secondary} onClick={() => setEditingId(null)} type="button">
                  ยกเลิก
                </button>
              </div>
            </div>
          </EditModal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <ConfirmModal
            title="ลบบัญชีรับเงิน"
            message={`ต้องการลบ ${deleteTarget.name} ใช่ไหม? ถ้ายังมีรายการเติมเงิน pending ระบบจะไม่ให้ลบ`}
            confirmLabel="ลบบัญชี"
            onClose={() => setDeleteTarget(null)}
            onConfirm={() => void removeAccount()}
          />
        )}
      </AnimatePresence>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>LINE TRANSFER LOG</p>
            <h2>ตรวจสอบรายการเงินเข้า</h2>
          </div>
          <input
            className={styles.search}
            placeholder="ค้นหารายการโอน"
            value={query.transfersSearch}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                transfersSearch: event.target.value,
                transfersPage: 1,
              }))
            }
          />
        </div>
        <div className={styles.table}>
          {transferEvents.map((event) => (
            <motion.div key={event.id} {...rowMotion}>
              <b>{formatBahtFromCents(event.incomingAmountCents)} บาท</b>
              <span>
                {event.occurredRaw || formatDateTime(event.occurredAt)} · เข้าบัญชี{" "}
                {event.destinationAccount ?? "-"} · ผู้โอน {event.senderName ?? "-"} · revision{" "}
                {event.lineRevision ?? "-"}
              </span>
              <em
                className={
                  event.status === "matched"
                    ? styles.green
                    : event.status === "failed"
                      ? styles.red
                      : styles.yellow
                }
              >
                {event.status}
              </em>
              <span>
                {event.paymentAccountName ?? "ไม่ทราบบัญชี"} · คงเหลือ{" "}
                {formatBahtFromCents(event.balanceCents)} บาท
                {event.userEmail ? ` · match ${event.userEmail}` : ""}
                {event.matchReason ? ` · ${event.matchReason}` : ""}
              </span>
            </motion.div>
          ))}
          {transferEvents.length === 0 && (
            <p className={styles.emptyInline}>ยังไม่มีรายการเงินเข้า หรือไม่พบรายการที่ค้นหา</p>
          )}
        </div>
        <PaginationControls
          meta={transferPage}
          onPageChange={(page) =>
            setQuery((current) => ({
              ...current,
              transfersPage: page,
            }))
          }
        />
      </section>

      <section className={styles.panel}>
        <p className={styles.eyebrow}>SYSTEM SECRETS</p>
        <h2>ตั้งค่าที่อยู่ใน Environment</h2>
        <div className={styles.emptyState}>
          <span>⚙</span>
          <h3>เก็บเฉพาะ secret ระบบหลักใน server</h3>
          <p>
            ตั้งค่า <code>ADMIN_KEY</code>, <code>CREDENTIAL_ENCRYPTION_KEY</code>,
            OAuth และ database URL ใน server environment เท่านั้น
          </p>
        </div>
        <p className={styles.hint}>
          ไม่ควรวาง encryption key หรือ credential จริงไว้ใน frontend
        </p>
      </section>
    </>
  );
}
