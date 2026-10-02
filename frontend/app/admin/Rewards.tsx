"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteAdminStreamer,
  deleteAdminTopupPromotion,
  describeReward,
  fetchAdminStreamers,
  fetchAdminTopupPromotions,
  formatDiscount,
  saveAdminStreamer,
  saveAdminTopupPromotion,
  type AdminStreamer,
  type RewardInput,
  type RewardType,
  type TopupPromotion,
} from "../lib/api";
import styles from "./page.module.css";
import rewardStyles from "./rewards.module.css";

type Notify = (message: string) => void;

async function run(action: () => Promise<unknown>, success: string, onDone: Notify) {
  try {
    await action();
  } catch (err) {
    window.alert(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    return false;
  }
  onDone(success);
  window.alert(success);
  return true;
}

type RewardForm = { rewardType: RewardType; rewardValue: string; maxReward: string; status: "active" | "inactive" };

function rewardPayload(form: RewardForm): RewardInput {
  return {
    rewardType: form.rewardType,
    rewardValue: Number(form.rewardValue),
    maxReward: form.rewardType === "percent" && form.maxReward.trim() ? Number(form.maxReward) : null,
    status: form.status,
  };
}

function RewardFields({ form, onChange }: { form: RewardForm; onChange: (form: RewardForm) => void }) {
  return (
    <>
      <label>
        ประเภทส่วนลด
        <select
          value={form.rewardType}
          onChange={(event) => onChange({ ...form, rewardType: event.target.value as RewardType })}
        >
          <option value="fixed">บาท (จำนวนคงที่)</option>
          <option value="percent">เปอร์เซ็นต์ของยอดเติม</option>
        </select>
      </label>
      <label>
        {form.rewardType === "fixed" ? "ส่วนลด (บาท)" : "ส่วนลด (%)"}
        <input
          inputMode="decimal"
          value={form.rewardValue}
          onChange={(event) => onChange({ ...form, rewardValue: event.target.value.replace(/[^\d.]/g, "") })}
        />
      </label>
      {form.rewardType === "percent" && (
        <label>
          ส่วนลดสูงสุด (บาท · เว้นว่าง = ไม่จำกัด)
          <input
            inputMode="decimal"
            value={form.maxReward}
            onChange={(event) => onChange({ ...form, maxReward: event.target.value.replace(/[^\d.]/g, "") })}
          />
        </label>
      )}
      <label>
        สถานะ
        <select
          value={form.status}
          onChange={(event) => onChange({ ...form, status: event.target.value as "active" | "inactive" })}
        >
          <option value="active">เปิดใช้งาน</option>
          <option value="inactive">ปิด</option>
        </select>
      </label>
    </>
  );
}

const baht = (cents: number) => `฿${(cents / 100).toLocaleString("th-TH")}`;

// ─── Top-up promotions ───

const blankPromotion = {
  name: "",
  minAmount: "",
  rewardType: "fixed" as RewardType,
  rewardValue: "",
  maxReward: "",
  status: "active" as "active" | "inactive",
};

export function TopupPromotionsPanel({ onDone }: { onDone: Notify }) {
  const [promotions, setPromotions] = useState<TopupPromotion[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(blankPromotion);

  const load = useCallback(() => {
    fetchAdminTopupPromotions()
      .then((data) => setPromotions(data.promotions))
      .catch((err) => window.alert(err instanceof Error ? err.message : "โหลดโปรไม่สำเร็จ"));
  }, []);
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  function edit(promotion: TopupPromotion) {
    setEditing(promotion.id);
    setForm({
      name: promotion.name,
      minAmount: String(promotion.minAmountCents / 100),
      rewardType: promotion.rewardType,
      rewardValue: String(promotion.rewardValue),
      maxReward: promotion.maxRewardCents ? String(promotion.maxRewardCents / 100) : "",
      status: promotion.status ?? "active",
    });
  }

  async function save() {
    const id = editing === "new" ? null : editing;
    const ok = await run(
      () => saveAdminTopupPromotion(id, { name: form.name, minAmount: Number(form.minAmount), ...rewardPayload(form) }),
      id ? `แก้ไขโปร ${form.name} สำเร็จ` : `เพิ่มโปร ${form.name} สำเร็จ`,
      onDone,
    );
    if (ok) {
      setEditing(null);
      load();
    }
  }

  async function remove(promotion: TopupPromotion) {
    if (!window.confirm(`ลบโปร "${promotion.name}" ใช่ไหม?`)) return;
    if (await run(() => deleteAdminTopupPromotion(promotion.id), `ลบโปร ${promotion.name} แล้ว`, onDone)) load();
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>TOP-UP PROMOTIONS</p>
          <h2>โปรเติมเงิน</h2>
          <p className={styles.muted}>
            เติมครบตามยอด → ลดยอดโอนทันทีตอนสร้าง QR แต่ได้ Point เต็มจำนวน (ได้โปรที่คุ้มที่สุดโปรเดียว)
          </p>
        </div>
        <div className={styles.panelTools}>
          <button
            className={styles.primary}
            onClick={() => {
              setEditing("new");
              setForm(blankPromotion);
            }}
            type="button"
          >
            เพิ่มโปร
          </button>
        </div>
      </div>

      {editing && (
        <div className={`${styles.formRows} ${rewardStyles.inlineForm}`}>
          <label>
            ชื่อโปร
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            เติมครบ (บาท)
            <input
              inputMode="decimal"
              value={form.minAmount}
              onChange={(event) => setForm({ ...form, minAmount: event.target.value.replace(/[^\d.]/g, "") })}
            />
          </label>
          <RewardFields form={form} onChange={(next) => setForm({ ...form, ...next })} />
          <div className={styles.formActions}>
            <button
              className={styles.primary}
              disabled={!form.name.trim() || !Number(form.minAmount) || !Number(form.rewardValue)}
              onClick={() => void save()}
              type="button"
            >
              {editing === "new" ? "เพิ่มโปร" : "บันทึกการแก้ไข"}
            </button>
            <button className={styles.secondary} onClick={() => setEditing(null)} type="button">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      <div className={styles.table}>
        {promotions.map((promotion) => (
          <div key={promotion.id}>
            <b>{promotion.name}</b>
            <span>
              เติมครบ {baht(promotion.minAmountCents)} → {describeReward(promotion)} · ใช้แล้ว {promotion.timesUsed ?? 0}{" "}
              ครั้ง ({formatDiscount(promotion.rewardGivenCents)})
            </span>
            <em className={promotion.status === "active" ? styles.green : styles.yellow}>
              {promotion.status === "active" ? "เปิด" : "ปิด"}
            </em>
            <button onClick={() => edit(promotion)} type="button">
              แก้ไข
            </button>
            <button className={styles.danger} onClick={() => void remove(promotion)} type="button">
              ลบ
            </button>
          </div>
        ))}
        {promotions.length === 0 && <p className={styles.emptyInline}>ยังไม่มีโปรเติมเงิน</p>}
      </div>
    </section>
  );
}

// ─── Streamers ───

const blankStreamer = {
  name: "",
  link: "",
  code: "",
  maxUses: "",
  rewardType: "fixed" as RewardType,
  rewardValue: "",
  maxReward: "",
  status: "active" as "active" | "inactive",
};

export function StreamersPanel({ onDone }: { onDone: Notify }) {
  const [streamers, setStreamers] = useState<AdminStreamer[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(blankStreamer);

  const load = useCallback(() => {
    fetchAdminStreamers()
      .then((data) => setStreamers(data.streamers))
      .catch((err) => window.alert(err instanceof Error ? err.message : "โหลดโค้ดส่วนลดไม่สำเร็จ"));
  }, []);
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  function edit(streamer: AdminStreamer) {
    setEditing(streamer.id);
    setForm({
      name: streamer.name,
      link: streamer.link ?? "",
      code: streamer.code,
      maxUses: streamer.maxUses ? String(streamer.maxUses) : "",
      rewardType: streamer.rewardType,
      rewardValue: String(streamer.rewardValue),
      maxReward: streamer.maxRewardCents ? String(streamer.maxRewardCents / 100) : "",
      status: streamer.status,
    });
  }

  async function save(regenerateCode = false) {
    const id = editing === "new" ? null : editing;
    const ok = await run(
      () =>
        saveAdminStreamer(id, {
          name: form.name,
          link: form.link.trim() || null,
          code: regenerateCode ? undefined : form.code.trim() || undefined,
          regenerateCode,
          maxUses: form.maxUses.trim() ? Number(form.maxUses) : null,
          ...rewardPayload(form),
        }),
      id ? `บันทึกโค้ดส่วนลด ${form.name} สำเร็จ` : `เพิ่มโค้ดส่วนลด ${form.name} แล้ว`,
      onDone,
    );
    if (ok) {
      setEditing(null);
      load();
    }
  }

  async function remove(streamer: AdminStreamer) {
    if (!window.confirm(`ลบโค้ดส่วนลด "${streamer.name}" ใช่ไหม? โค้ด ${streamer.code} จะใช้ไม่ได้อีก`)) return;
    if (await run(() => deleteAdminStreamer(streamer.id), `ลบโค้ดส่วนลด ${streamer.name} แล้ว`, onDone)) load();
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      onDone(`คัดลอก${label}แล้ว`);
    } catch {
      window.prompt(`คัดลอก${label}`, text);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>DISCOUNT CODES</p>
          <h2>โค้ดส่วนลด</h2>
          <p className={styles.muted}>
            ลูกค้าใหม่กรอกโค้ดตอนเติมครั้งแรก · 1 บัญชีใช้ได้ 1 ครั้ง · ลดยอดโอนทันทีตอนสร้าง QR
          </p>
        </div>
        <div className={styles.panelTools}>
          <button
            className={styles.primary}
            onClick={() => {
              setEditing("new");
              setForm(blankStreamer);
            }}
            type="button"
          >
            เพิ่มโค้ดส่วนลด
          </button>
        </div>
      </div>

      {editing && (
        <div className={`${styles.formRows} ${rewardStyles.inlineForm}`}>
          <label>
            ชื่อโค้ด (เช่น ชื่อแคมเปญหรือผู้ที่แจกโค้ด)
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            ลิงก์ (ถ้ามี)
            <input
              placeholder="https://..."
              value={form.link}
              onChange={(event) => setForm({ ...form, link: event.target.value })}
            />
          </label>
          <label>
            โค้ด (เว้นว่าง = สร้างให้อัตโนมัติ)
            <input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })}
            />
          </label>
          <label>
            ใช้ได้กี่คน (เว้นว่าง = ไม่จำกัด)
            <input
              inputMode="numeric"
              value={form.maxUses}
              onChange={(event) => setForm({ ...form, maxUses: event.target.value.replace(/\D/g, "") })}
            />
          </label>
          <RewardFields form={form} onChange={(next) => setForm({ ...form, ...next })} />
          <div className={styles.formActions}>
            <button
              className={styles.primary}
              disabled={!form.name.trim() || !Number(form.rewardValue)}
              onClick={() => void save()}
              type="button"
            >
              {editing === "new" ? "เพิ่มและสร้างโค้ด" : "บันทึกการแก้ไข"}
            </button>
            {editing !== "new" && (
              <button className={styles.secondary} onClick={() => void save(true)} type="button">
                สุ่มโค้ดใหม่
              </button>
            )}
            <button className={styles.secondary} onClick={() => setEditing(null)} type="button">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      <div className={rewardStyles.streamerGrid}>
        {streamers.map((streamer) => (
          <article key={streamer.id} className={rewardStyles.streamerCard}>
            <header>
              <div>
                <b>{streamer.name}</b>
                {streamer.link ? (
                  <a href={streamer.link} rel="noreferrer" target="_blank">
                    {streamer.link}
                  </a>
                ) : (
                  <small>ไม่มีลิงก์</small>
                )}
              </div>
              <em className={streamer.status === "active" ? styles.green : styles.yellow}>
                {streamer.status === "active" ? "เปิด" : "ปิด"}
              </em>
            </header>
            <div className={rewardStyles.codeRow}>
              <code>{streamer.code}</code>
              <button onClick={() => void copy(streamer.code, "โค้ด")} type="button">
                คัดลอกโค้ด
              </button>
              <button onClick={() => void copy(streamer.referralLink, "ลิงก์")} type="button">
                คัดลอกลิงก์
              </button>
            </div>
            <p className={rewardStyles.rewardLine}>{describeReward(streamer)} ต่อคน</p>
            <dl>
              <div>
                <dt>ใช้โค้ดแล้ว</dt>
                <dd>
                  {streamer.redeemed}
                  {streamer.maxUses ? ` / ${streamer.maxUses}` : ""} คน
                  {streamer.pending ? ` (+${streamer.pending} รอชำระ)` : ""}
                </dd>
              </div>
              <div>
                <dt>ยอดเติมจากลูกค้า</dt>
                <dd>
                  {baht(streamer.topupCents)} · {streamer.topups} ครั้ง
                </dd>
              </div>
              <div>
                <dt>ซื้อแพ็กเกจ</dt>
                <dd>
                  {streamer.purchases} ครั้ง · {streamer.pointsSpent.toLocaleString()} Point
                </dd>
              </div>
              <div>
                <dt>ส่วนลดที่แจกไป</dt>
                <dd>{formatDiscount(streamer.rewardGivenCents)}</dd>
              </div>
            </dl>
            <footer>
              <button onClick={() => edit(streamer)} type="button">
                แก้ไข
              </button>
              <button className={styles.danger} onClick={() => void remove(streamer)} type="button">
                ลบ
              </button>
            </footer>
          </article>
        ))}
        {streamers.length === 0 && <p className={styles.emptyInline}>ยังไม่มีโค้ดส่วนลด</p>}
      </div>
    </section>
  );
}
