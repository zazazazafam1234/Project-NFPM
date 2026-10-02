"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PAYOUT_CYCLE_LABEL,
  addAdminReseller,
  addResellerManager,
  approveResellerPayout,
  bahtFromCents,
  cutResellerPayouts,
  deleteAdminReseller,
  fetchAdminResellerUses,
  fetchAdminResellers,
  removeResellerManager,
  saveResellerSettings,
  updateAdminReseller,
  type PayoutCycle,
  type ResellerBank,
  type ResellerManager,
  type ResellerPayout,
  type ResellerStat,
  type ResellerUse,
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
  return true;
}

const blankForm = { user: "", commission: "0.25", maxUses: "", code: "" };

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-";
}

export function ResellersPanel({ onDone }: { onDone: Notify }) {
  const [resellers, setResellers] = useState<ResellerStat[]>([]);
  const [managers, setManagers] = useState<ResellerManager[]>([]);
  const [discountPercent, setDiscountPercent] = useState("5");
  const [payoutCycle, setPayoutCycle] = useState<PayoutCycle>("monthly");
  const [payouts, setPayouts] = useState<ResellerPayout[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(blankForm);
  const [managerQuery, setManagerQuery] = useState("");
  const [usesOf, setUsesOf] = useState<{ reseller: ResellerStat; uses: ResellerUse[]; bank: ResellerBank | null } | null>(
    null,
  );

  const load = useCallback(() => {
    fetchAdminResellers()
      .then((data) => {
        setResellers(data.resellers);
        setManagers(data.managers);
        setDiscountPercent(String(data.discountPercent));
        setPayoutCycle(data.payoutCycle);
        setPayouts(data.payouts);
      })
      .catch((err) => window.alert(err instanceof Error ? err.message : "โหลดตัวแทนจำหน่ายไม่สำเร็จ"));
  }, []);
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  function edit(reseller: ResellerStat) {
    setEditing(reseller.id);
    setForm({
      user: `${reseller.userName} (${reseller.userEmail})`,
      commission: String(reseller.commissionCents / 100),
      maxUses: reseller.maxUses ? String(reseller.maxUses) : "",
      code: reseller.code,
    });
  }

  async function save() {
    const maxUses = form.maxUses.trim() ? Number(form.maxUses) : null;
    const ok =
      editing === "new"
        ? await run(
            () =>
              addAdminReseller({
                user: form.user,
                commission: Number(form.commission),
                maxUses,
                code: form.code.trim() || undefined,
              }),
            "เพิ่มตัวแทนจำหน่ายและสร้างโค้ดแล้ว",
            onDone,
          )
        : await run(
            () =>
              updateAdminReseller(String(editing), {
                commission: Number(form.commission),
                maxUses,
                code: form.code.trim() || undefined,
              }),
            "บันทึกตัวแทนจำหน่ายแล้ว",
            onDone,
          );
    if (ok) {
      setEditing(null);
      load();
    }
  }

  async function toggle(reseller: ResellerStat) {
    const status = reseller.status === "active" ? "inactive" : "active";
    if (await run(() => updateAdminReseller(reseller.id, { status }), status === "active" ? "เปิดโค้ดแล้ว" : "ปิดโค้ดแล้ว", onDone)) {
      load();
    }
  }

  async function remove(reseller: ResellerStat) {
    if (!window.confirm(`ลบตัวแทน "${reseller.userName}" ใช่ไหม? โค้ด ${reseller.code} จะใช้ไม่ได้อีก`)) return;
    if (await run(() => deleteAdminReseller(reseller.id), `ลบตัวแทน ${reseller.userName} แล้ว`, onDone)) load();
  }

  async function cut() {
    const label = PAYOUT_CYCLE_LABEL[payoutCycle];
    if (!window.confirm(`ตัดยอดค่าคอมทั้งหมดก่อนรอบ${label}ปัจจุบัน เป็นรายการรอโอนใช่ไหม?`)) return;
    try {
      const result = await cutResellerPayouts();
      onDone(
        result.count
          ? `ตัดยอดแล้ว ${result.count} รายการ รวม ฿${bahtFromCents(result.totalCents)} — โอนแล้วกดอนุมัติทีละรายการ`
          : "ไม่มีค่าคอมที่ถึงรอบตัดยอด",
      );
      load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "ตัดยอดไม่สำเร็จ");
    }
  }

  async function approve(payout: ResellerPayout) {
    if (!window.confirm(`โอน ฿${bahtFromCents(payout.amountCents)} ให้ ${payout.userName} แล้วใช่ไหม?`)) return;
    if (await run(() => approveResellerPayout(payout.id), `อนุมัติการโอนให้ ${payout.userName} แล้ว`, onDone)) load();
  }

  async function showUses(reseller: ResellerStat) {
    try {
      const data = await fetchAdminResellerUses(reseller.id);
      setUsesOf({ reseller, uses: data.uses, bank: data.bank });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "โหลดรายการไม่สำเร็จ");
    }
  }

  async function saveSettings() {
    const ok = await run(
      () => saveResellerSettings({ discountPercent: Number(discountPercent), payoutCycle }),
      `บันทึกแล้ว: ส่วนลด ${discountPercent}% · ตัดยอด${PAYOUT_CYCLE_LABEL[payoutCycle]}`,
      onDone,
    );
    if (ok) load();
  }

  async function addManager() {
    if (await run(() => addResellerManager(managerQuery), "แต่งตั้งคนดูแลตัวแทนจำหน่ายแล้ว", onDone)) {
      setManagerQuery("");
      load();
    }
  }

  async function dropManager(manager: ResellerManager) {
    if (!window.confirm(`ถอดยศคนดูแลตัวแทนของ ${manager.name} ใช่ไหม?`)) return;
    if (await run(() => removeResellerManager(manager.id), `ถอดยศ ${manager.name} แล้ว`, onDone)) load();
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
    <>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>RESELLERS</p>
            <h2>ตัวแทนจำหน่าย</h2>
            <p className={styles.muted}>
              ลูกค้ากรอกโค้ดตัวแทนตอนเติมเงิน ได้ส่วนลด {discountPercent}% · ลูกค้า 1 คนใช้โค้ดของตัวแทนแต่ละคนได้ 1 ครั้ง ·
              ตัวแทนได้ค่าคอม (ไม่เข้า Point) เมื่อลูกค้าเติมสำเร็จ · ตัดยอด{PAYOUT_CYCLE_LABEL[payoutCycle]}
            </p>
          </div>
          <div className={styles.panelTools}>
            <button
              className={styles.primary}
              onClick={() => {
                setEditing("new");
                setForm(blankForm);
              }}
              type="button"
            >
              เพิ่มตัวแทน
            </button>
          </div>
        </div>

        <div className={`${styles.formRows} ${rewardStyles.inlineForm}`}>
          <label>
            ส่วนลดลูกค้าที่ใช้โค้ดตัวแทน (%)
            <input
              inputMode="decimal"
              value={discountPercent}
              onChange={(event) => setDiscountPercent(event.target.value.replace(/[^\d.]/g, ""))}
            />
          </label>
          <label>
            รอบตัดยอดค่าคอม
            <select value={payoutCycle} onChange={(event) => setPayoutCycle(event.target.value as PayoutCycle)}>
              <option value="weekly">รายสัปดาห์ (ตัดทุกวันจันทร์)</option>
              <option value="monthly">รายเดือน (ตัดทุกวันที่ 1)</option>
            </select>
          </label>
          <div className={styles.formActions}>
            <button className={styles.primary} onClick={() => void saveSettings()} type="button">
              บันทึกการตั้งค่า
            </button>
          </div>
        </div>

        {editing && (
          <div className={`${styles.formRows} ${rewardStyles.inlineForm}`}>
            <label>
              ผู้ใช้ (ชื่อหรืออีเมล)
              <input
                disabled={editing !== "new"}
                placeholder="เช่น somchai@gmail.com"
                value={form.user}
                onChange={(event) => setForm({ ...form, user: event.target.value })}
              />
            </label>
            <label>
              ค่าคอมต่อลูกค้า 1 คน (บาท)
              <input
                inputMode="decimal"
                value={form.commission}
                onChange={(event) => setForm({ ...form, commission: event.target.value.replace(/[^\d.]/g, "") })}
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
            <label>
              โค้ด (เว้นว่าง = สร้างให้อัตโนมัติ)
              <input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })}
              />
            </label>
            <div className={styles.formActions}>
              <button
                className={styles.primary}
                disabled={!form.user.trim() || form.commission.trim() === ""}
                onClick={() => void save()}
                type="button"
              >
                {editing === "new" ? "เพิ่มตัวแทน" : "บันทึก"}
              </button>
              {editing !== "new" && (
                <button
                  className={styles.secondary}
                  onClick={() =>
                    void run(
                      () => updateAdminReseller(String(editing), { regenerateCode: true }),
                      "สร้างโค้ดใหม่แล้ว",
                      onDone,
                    ).then((ok) => {
                      if (ok) {
                        setEditing(null);
                        load();
                      }
                    })
                  }
                  type="button"
                >
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
          {resellers.map((reseller) => (
            <article key={reseller.id} className={rewardStyles.streamerCard}>
              <header>
                <div>
                  <b>{reseller.userName}</b>
                  <small>{reseller.userEmail}</small>
                </div>
                <em className={reseller.status === "active" ? styles.green : styles.yellow}>
                  {reseller.status === "active" ? "เปิด" : "ปิด"}
                </em>
              </header>
              <div className={rewardStyles.codeRow}>
                <code>{reseller.code}</code>
                <button onClick={() => void copy(reseller.code, "โค้ด")} type="button">
                  คัดลอกโค้ด
                </button>
                {reseller.referralLink && (
                  <button onClick={() => void copy(String(reseller.referralLink), "ลิงก์")} type="button">
                    คัดลอกลิงก์
                  </button>
                )}
              </div>
              <p className={rewardStyles.rewardLine}>ค่าคอม ฿{bahtFromCents(reseller.commissionCents)} ต่อลูกค้า 1 คน</p>
              <dl>
                <div>
                  <dt>ยอดขาย</dt>
                  <dd>
                    {reseller.customers}
                    {reseller.maxUses ? ` / ${reseller.maxUses}` : ""} คน
                    {reseller.pending ? ` (+${reseller.pending} รอชำระ)` : ""}
                  </dd>
                </div>
                <div>
                  <dt>ค่าคอมทั้งหมด</dt>
                  <dd>฿{bahtFromCents(reseller.commissionEarnedCents)}</dd>
                </div>
                <div>
                  <dt>ยังไม่ถึงรอบ / รอโอน / โอนแล้ว</dt>
                  <dd>
                    ฿{bahtFromCents(reseller.commissionOpenCents)} / ฿{bahtFromCents(reseller.commissionPendingCents)} / ฿
                    {bahtFromCents(reseller.commissionPaidCents)}
                  </dd>
                </div>
                <div>
                  <dt>บัญชีรับค่าคอม</dt>
                  <dd>{reseller.hasBank ? "กรอกแล้ว" : "ยังไม่กรอก"}</dd>
                </div>
              </dl>
              <footer>
                <button onClick={() => void showUses(reseller)} type="button">
                  ดูรายการ
                </button>
                <button onClick={() => edit(reseller)} type="button">
                  แก้ไข
                </button>
                <button onClick={() => void toggle(reseller)} type="button">
                  {reseller.status === "active" ? "ปิดโค้ด" : "เปิดโค้ด"}
                </button>
                <button className={styles.danger} onClick={() => void remove(reseller)} type="button">
                  ลบ
                </button>
              </footer>
            </article>
          ))}
          {resellers.length === 0 && <p className={styles.emptyInline}>ยังไม่มีตัวแทนจำหน่าย</p>}
        </div>

        {usesOf && (
          <div className={`${styles.formRows} ${rewardStyles.inlineForm}`}>
            <b>
              รายการล่าสุดของ {usesOf.reseller.userName} ({usesOf.reseller.code})
            </b>
            <p className={styles.muted}>
              บัญชีรับค่าคอม:{" "}
              {usesOf.bank
                ? `${usesOf.bank.bankName} · ${usesOf.bank.accountName} · ${usesOf.bank.accountNumber}`
                : "ยังไม่กรอก"}
            </p>
            <div className={styles.table}>
              {usesOf.uses.map((use) => (
                <div key={use.id}>
                  <b>{use.customer}</b>
                  <span>
                    เติม ฿{bahtFromCents(use.baseAmountCents)} · ลด ฿{bahtFromCents(use.discountCents)} · ค่าคอม ฿
                    {bahtFromCents(use.commissionCents)} · {formatDate(use.createdAt)}
                  </span>
                  <em className={use.status === "redeemed" ? styles.green : styles.yellow}>
                    {use.status === "pending"
                      ? "รอชำระ"
                      : use.payoutStatus === "approved"
                        ? "โอนแล้ว"
                        : use.payoutStatus === "pending"
                          ? "รอโอน"
                          : "ยังไม่ถึงรอบ"}
                  </em>
                </div>
              ))}
              {usesOf.uses.length === 0 && <p className={styles.emptyInline}>ยังไม่มีลูกค้าใช้โค้ดนี้</p>}
            </div>
            <div className={styles.formActions}>
              <button className={styles.secondary} onClick={() => setUsesOf(null)} type="button">
                ปิด
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>COMMISSION PAYOUTS</p>
            <h2>ตัดยอดและโอนค่าคอม</h2>
            <p className={styles.muted}>
              กดตัดยอด = รวมค่าคอมที่เกิดก่อนรอบ{PAYOUT_CYCLE_LABEL[payoutCycle]}ปัจจุบันเป็นรายการรอโอน · โอนเข้าบัญชีตัวแทนแล้วกดอนุมัติ
            </p>
          </div>
          <div className={styles.panelTools}>
            <button className={styles.primary} onClick={() => void cut()} type="button">
              ตัดยอด
            </button>
          </div>
        </div>
        <div className={styles.table}>
          {payouts.map((payout) => (
            <div key={payout.id}>
              <b>
                {payout.userName} · ฿{bahtFromCents(payout.amountCents)}
              </b>
              <span>
                {payout.customers} คน · ถึง {formatDate(payout.periodEnd)} ·{" "}
                {payout.bankName
                  ? `${payout.bankName} · ${payout.bankAccountName} · ${payout.bankAccountNumber}`
                  : "ยังไม่กรอกบัญชีธนาคาร"}
              </span>
              <em className={payout.status === "approved" ? styles.green : styles.yellow}>
                {payout.status === "approved" ? `โอนแล้ว ${formatDate(payout.approvedAt)}` : "รอโอน"}
              </em>
              {payout.status === "pending" && (
                <button className={styles.primary} onClick={() => void approve(payout)} type="button">
                  โอนแล้ว · อนุมัติ
                </button>
              )}
            </div>
          ))}
          {payouts.length === 0 && <p className={styles.emptyInline}>ยังไม่มีรายการตัดยอด</p>}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>RESELLER MANAGERS</p>
            <h2>คนดูแลตัวแทนจำหน่าย</h2>
            <p className={styles.muted}>ดูยอดขายของตัวแทนทุกคนได้ที่หน้า /resellers (ไม่มีสิทธิ์แอดมินอื่น)</p>
          </div>
        </div>
        <div className={`${styles.formRows} ${rewardStyles.inlineForm}`}>
          <label>
            แต่งตั้งจากชื่อหรืออีเมล
            <input value={managerQuery} onChange={(event) => setManagerQuery(event.target.value)} />
          </label>
          <div className={styles.formActions}>
            <button className={styles.primary} disabled={!managerQuery.trim()} onClick={() => void addManager()} type="button">
              แต่งตั้ง
            </button>
          </div>
        </div>
        <div className={styles.table}>
          {managers.map((manager) => (
            <div key={manager.id}>
              <b>{manager.name}</b>
              <span>{manager.email}</span>
              <button className={styles.danger} onClick={() => void dropManager(manager)} type="button">
                ถอดยศ
              </button>
            </div>
          ))}
          {managers.length === 0 && <p className={styles.emptyInline}>ยังไม่มีคนดูแลตัวแทนจำหน่าย</p>}
        </div>
      </section>
    </>
  );
}
