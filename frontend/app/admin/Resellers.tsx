"use client";

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import {
  PAYOUT_CYCLE_LABEL,
  addAdminReseller,
  addResellerManager,
  approveResellerPayout,
  approveResellerRequest,
  rejectResellerRequest,
  bahtFromCents,
  cutResellerPayouts,
  deleteAdminReseller,
  fetchAdminResellerUses,
  fetchAdminResellers,
  removeResellerManager,
  saveResellerSettings,
  searchResellerCandidates,
  updateAdminReseller,
  type PayoutCycle,
  type ResellerBank,
  type ResellerCandidate,
  type ResellerManager,
  type ResellerPayout,
  type ResellerRequest,
  type ResellerStat,
  type ResellerUse,
} from "../lib/api";
import { UserPicker } from "../components/UserPicker";
import { EditModal } from "./EditModal";
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

const blankForm = { commission: "0.25", maxUses: "", code: "" };

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-";
}

type Confirm = { title: string; message: string; label: string; danger?: boolean; action: () => Promise<void> };

export function ResellersPanel({ onDone }: { onDone: Notify }) {
  const [resellers, setResellers] = useState<ResellerStat[]>([]);
  const [managers, setManagers] = useState<ResellerManager[]>([]);
  const [discountPercent, setDiscountPercent] = useState("5");
  const [payoutCycle, setPayoutCycle] = useState<PayoutCycle>("monthly");
  const [payouts, setPayouts] = useState<ResellerPayout[]>([]);
  // Modals
  const [editing, setEditing] = useState<ResellerStat | "new" | null>(null);
  const [form, setForm] = useState(blankForm);
  const [picked, setPicked] = useState<ResellerCandidate | null>(null);
  const [appointing, setAppointing] = useState(false);
  const [pickedManager, setPickedManager] = useState<ResellerCandidate | null>(null);
  const [usesOf, setUsesOf] = useState<{ reseller: ResellerStat; uses: ResellerUse[]; bank: ResellerBank | null } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [requests, setRequests] = useState<ResellerRequest[]>([]);
  const [approving, setApproving] = useState<ResellerRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchAdminResellers()
      .then((data) => {
        setResellers(data.resellers);
        setManagers(data.managers);
        setDiscountPercent(String(data.discountPercent));
        setPayoutCycle(data.payoutCycle);
        setPayouts(data.payouts);
        setRequests(data.requests);
      })
      .catch((err) => window.alert(err instanceof Error ? err.message : "โหลดตัวแทนจำหน่ายไม่สำเร็จ"));
  }, []);
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  function openAdd() {
    setEditing("new");
    setPicked(null);
    setForm(blankForm);
  }

  function openEdit(reseller: ResellerStat) {
    setEditing(reseller);
    setForm({
      commission: String(reseller.commissionCents / 100),
      maxUses: reseller.maxUses ? String(reseller.maxUses) : "",
      code: reseller.code,
    });
  }

  async function save() {
    const maxUses = form.maxUses.trim() ? Number(form.maxUses) : null;
    const target = editing === "new" ? null : editing;
    setBusy(true);
    const ok =
      !target
        ? await run(
            () =>
              addAdminReseller({
                userId: String(picked?.id),
                commission: Number(form.commission),
                maxUses,
                code: form.code.trim() || undefined,
              }),
            `เพิ่ม ${picked?.name} เป็นตัวแทนจำหน่ายแล้ว`,
            onDone,
          )
        : await run(
            () =>
              updateAdminReseller(target.id, {
                commission: Number(form.commission),
                maxUses,
                code: form.code.trim() || undefined,
              }),
            "บันทึกตัวแทนจำหน่ายแล้ว",
            onDone,
          );
    setBusy(false);
    if (ok) {
      setEditing(null);
      load();
    }
  }

  async function regenerateCode(reseller: ResellerStat) {
    setBusy(true);
    const ok = await run(() => updateAdminReseller(reseller.id, { regenerateCode: true }), "สร้างโค้ดใหม่แล้ว", onDone);
    setBusy(false);
    if (ok) {
      setEditing(null);
      load();
    }
  }

  async function appoint() {
    if (!pickedManager) return;
    setBusy(true);
    const ok = await run(() => addResellerManager(pickedManager.id), `แต่งตั้ง ${pickedManager.name} เป็นคนดูแลตัวแทนแล้ว`, onDone);
    setBusy(false);
    if (ok) {
      setAppointing(false);
      setPickedManager(null);
      load();
    }
  }

  function openApprove(request: ResellerRequest) {
    setApproving(request);
    setForm({
      commission: String(request.commissionCents / 100),
      maxUses: request.maxUses ? String(request.maxUses) : "",
      code: "",
    });
  }

  async function approve() {
    if (!approving) return;
    setBusy(true);
    const ok = await run(
      () =>
        approveResellerRequest(approving.id, {
          commission: Number(form.commission),
          maxUses: form.maxUses.trim() ? Number(form.maxUses) : null,
        }),
      `อนุมัติ ${approving.userName} เป็นตัวแทนจำหน่ายแล้ว`,
      onDone,
    );
    setBusy(false);
    if (ok) {
      setApproving(null);
      load();
    }
  }

  const askReject = (request: ResellerRequest) =>
    setConfirm({
      title: "ปฏิเสธคำขอ",
      message: `ปฏิเสธคำขอให้ ${request.userName} เป็นตัวแทนจำหน่าย (ขอโดย ${request.requestedByName ?? "-"})?`,
      label: "ปฏิเสธ",
      danger: true,
      action: async () => {
        await rejectResellerRequest(request.id);
        onDone(`ปฏิเสธคำขอของ ${request.userName} แล้ว`);
      },
    });

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

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.action();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
      setConfirm(null);
      load();
    }
  }

  const askToggle = (reseller: ResellerStat) =>
    setConfirm({
      title: reseller.status === "active" ? "ปิดโค้ดตัวแทน" : "เปิดโค้ดตัวแทน",
      message:
        reseller.status === "active"
          ? `ปิดโค้ด ${reseller.code} ของ ${reseller.userName}? ลูกค้าจะใช้โค้ดนี้ไม่ได้จนกว่าจะเปิดอีกครั้ง`
          : `เปิดโค้ด ${reseller.code} ของ ${reseller.userName} ให้ใช้ได้อีกครั้ง?`,
      label: reseller.status === "active" ? "ปิดโค้ด" : "เปิดโค้ด",
      action: async () => {
        await updateAdminReseller(reseller.id, { status: reseller.status === "active" ? "inactive" : "active" });
        onDone(reseller.status === "active" ? "ปิดโค้ดแล้ว" : "เปิดโค้ดแล้ว");
      },
    });

  const askRemove = (reseller: ResellerStat) =>
    setConfirm({
      title: "ลบตัวแทนจำหน่าย",
      message: `ลบ ${reseller.userName} ออกจากตัวแทน? โค้ด ${reseller.code} จะใช้ไม่ได้อีก (ประวัติและค่าคอมที่ตัดยอดแล้วยังอยู่)`,
      label: "ลบตัวแทน",
      danger: true,
      action: async () => {
        await deleteAdminReseller(reseller.id);
        onDone(`ลบตัวแทน ${reseller.userName} แล้ว`);
      },
    });

  const askCut = () =>
    setConfirm({
      title: "ตัดยอดค่าคอม",
      message: `รวมค่าคอมที่เกิดก่อนรอบ${PAYOUT_CYCLE_LABEL[payoutCycle]}ปัจจุบันเป็นรายการรอโอน แยกตามตัวแทน`,
      label: "ตัดยอด",
      action: async () => {
        const result = await cutResellerPayouts();
        onDone(
          result.count
            ? `ตัดยอดแล้ว ${result.count} รายการ รวม ฿${bahtFromCents(result.totalCents)} — โอนแล้วกดอนุมัติทีละรายการ`
            : "ไม่มีค่าคอมที่ถึงรอบตัดยอด",
        );
      },
    });

  const askApprove = (payout: ResellerPayout) =>
    setConfirm({
      title: "ยืนยันการโอนค่าคอม",
      message: `โอน ฿${bahtFromCents(payout.amountCents)} ให้ ${payout.userName}${
        payout.bankName ? ` (${payout.bankName} · ${payout.bankAccountName} · ${payout.bankAccountNumber})` : ""
      } เรียบร้อยแล้ว?`,
      label: "โอนแล้ว · อนุมัติ",
      action: async () => {
        await approveResellerPayout(payout.id);
        onDone(`อนุมัติการโอนให้ ${payout.userName} แล้ว`);
      },
    });

  const askDropManager = (manager: ResellerManager) =>
    setConfirm({
      title: "ถอดยศคนดูแลตัวแทน",
      message: `ถอดยศคนดูแลตัวแทนจำหน่ายของ ${manager.name}?`,
      label: "ถอดยศ",
      danger: true,
      action: async () => {
        await removeResellerManager(manager.id);
        onDone(`ถอดยศ ${manager.name} แล้ว`);
      },
    });

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      onDone(`คัดลอก${label}แล้ว`);
    } catch {
      window.prompt(`คัดลอก${label}`, text);
    }
  }

  const editingReseller = editing && editing !== "new" ? editing : null;

  return (
    <>
      {requests.length > 0 && (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>REQUESTS</p>
              <h2>คำขอเพิ่มตัวแทน รออนุมัติ ({requests.length})</h2>
              <p className={styles.muted}>คนดูแลตัวแทนจำหน่ายเสนอมา · โค้ดจะใช้ได้หลังอนุมัติ</p>
            </div>
          </div>
          <div className={styles.table}>
            {requests.map((request) => (
              <div key={request.id}>
                <b>{request.userName}</b>
                <span>
                  {request.userEmail} · ค่าคอม ฿{bahtFromCents(request.commissionCents)}
                  {request.maxUses ? ` · จำกัด ${request.maxUses} คน` : ""} · ขอโดย {request.requestedByName ?? "-"} ·{" "}
                  {formatDate(request.createdAt)}
                </span>
                <button className={styles.primary} onClick={() => openApprove(request)} type="button">
                  อนุมัติ
                </button>
                <button className={styles.danger} onClick={() => askReject(request)} type="button">
                  ปฏิเสธ
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>RESELLERS</p>
            <h2>ตัวแทนจำหน่าย</h2>
            <p className={styles.muted}>
              ลูกค้ากรอกโค้ดตัวแทนตอนเติมเงิน ได้ส่วนลด {discountPercent}% · ลูกค้า 1 คนใช้โค้ดตัวแทนได้ครั้งเดียว และกลายเป็นลูกค้าของตัวแทนคนนั้นถาวร (ใช้โค้ดตัวแทนคนอื่นไม่ได้) ·
              ตัวแทนได้ค่าคอม (ไม่เข้า Point) เมื่อลูกค้าเติมสำเร็จ · ตัดยอด{PAYOUT_CYCLE_LABEL[payoutCycle]}
            </p>
          </div>
          <div className={styles.panelTools}>
            <button className={styles.primary} onClick={openAdd} type="button">
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
                  ดูรายละเอียด
                </button>
                <button onClick={() => openEdit(reseller)} type="button">
                  แก้ไข
                </button>
                <button onClick={() => askToggle(reseller)} type="button">
                  {reseller.status === "active" ? "ปิดโค้ด" : "เปิดโค้ด"}
                </button>
                <button className={styles.danger} onClick={() => askRemove(reseller)} type="button">
                  ลบ
                </button>
              </footer>
            </article>
          ))}
          {resellers.length === 0 && <p className={styles.emptyInline}>ยังไม่มีตัวแทนจำหน่าย</p>}
        </div>
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
            <button className={styles.primary} onClick={askCut} type="button">
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
                <button className={styles.primary} onClick={() => askApprove(payout)} type="button">
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
          <div className={styles.panelTools}>
            <button
              className={styles.primary}
              onClick={() => {
                setAppointing(true);
                setPickedManager(null);
              }}
              type="button"
            >
              แต่งตั้ง
            </button>
          </div>
        </div>
        <div className={styles.table}>
          {managers.map((manager) => (
            <div key={manager.id}>
              <b>{manager.name}</b>
              <span>{manager.email}</span>
              <button className={styles.danger} onClick={() => askDropManager(manager)} type="button">
                ถอดยศ
              </button>
            </div>
          ))}
          {managers.length === 0 && <p className={styles.emptyInline}>ยังไม่มีคนดูแลตัวแทนจำหน่าย</p>}
        </div>
      </section>

      <AnimatePresence>
        {editing && (
          <EditModal
            eyebrow={editing === "new" ? "ADD RESELLER" : "EDIT RESELLER"}
            title={editing === "new" ? "เพิ่มตัวแทนจำหน่าย" : `แก้ไข ${editingReseller?.userName}`}
            onClose={() => setEditing(null)}
          >
            <div className={styles.formRows}>
              {editing === "new" ? (
                <div className={rewardStyles.pickerField}>
                  <span>ผู้ใช้</span>
                  <UserPicker
                    search={searchResellerCandidates}
                    selected={picked}
                    onSelect={setPicked}
                    disable={(user) => (user.isReseller ? "เป็นตัวแทนอยู่แล้ว" : user.isRequested ? "มีคำขอรออนุมัติ" : null)}
                  />
                </div>
              ) : (
                <p className={styles.muted}>{editingReseller?.userEmail}</p>
              )}
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
                  disabled={busy || (editing === "new" && !picked) || form.commission.trim() === ""}
                  onClick={() => void save()}
                  type="button"
                >
                  {editing === "new" ? "เพิ่มตัวแทน" : "บันทึก"}
                </button>
                {editingReseller && (
                  <button
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => void regenerateCode(editingReseller)}
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
          </EditModal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {approving && (
          <EditModal eyebrow="APPROVE" title={`อนุมัติ ${approving.userName}`} onClose={() => setApproving(null)}>
            <div className={styles.formRows}>
              <p className={styles.muted}>
                {approving.userEmail} · ขอโดย {approving.requestedByName ?? "-"} · ปรับค่าคอมหรือจำนวนคนก่อนอนุมัติได้
              </p>
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
              <div className={styles.formActions}>
                <button
                  className={styles.primary}
                  disabled={busy || form.commission.trim() === ""}
                  onClick={() => void approve()}
                  type="button"
                >
                  อนุมัติเป็นตัวแทน
                </button>
                <button className={styles.secondary} onClick={() => setApproving(null)} type="button">
                  ยกเลิก
                </button>
              </div>
            </div>
          </EditModal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {appointing && (
          <EditModal eyebrow="RESELLER MANAGER" title="แต่งตั้งคนดูแลตัวแทนจำหน่าย" onClose={() => setAppointing(false)}>
            <div className={styles.formRows}>
              <div className={rewardStyles.pickerField}>
                <span>ผู้ใช้</span>
                <UserPicker
                  search={searchResellerCandidates}
                  selected={pickedManager}
                  onSelect={setPickedManager}
                  disable={(user) => (user.isResellerManager ? "เป็นคนดูแลอยู่แล้ว" : null)}
                />
              </div>
              <div className={styles.formActions}>
                <button className={styles.primary} disabled={busy || !pickedManager} onClick={() => void appoint()} type="button">
                  แต่งตั้ง
                </button>
                <button className={styles.secondary} onClick={() => setAppointing(false)} type="button">
                  ยกเลิก
                </button>
              </div>
            </div>
          </EditModal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {usesOf && (
          <EditModal
            eyebrow="RESELLER"
            title={`${usesOf.reseller.userName} · ${usesOf.reseller.code}`}
            onClose={() => setUsesOf(null)}
          >
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
                  <em className={use.payoutStatus === "approved" ? styles.green : styles.yellow}>
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
          </EditModal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirm && (
          <EditModal eyebrow="CONFIRM" title={confirm.title} onClose={() => !busy && setConfirm(null)}>
            <p>{confirm.message}</p>
            <div className={styles.formActions}>
              <button
                className={confirm.danger ? styles.danger : styles.primary}
                disabled={busy}
                onClick={() => void runConfirm()}
                type="button"
              >
                {busy ? "กำลังทำรายการ…" : confirm.label}
              </button>
              <button className={styles.secondary} disabled={busy} onClick={() => setConfirm(null)} type="button">
                ยกเลิก
              </button>
            </div>
          </EditModal>
        )}
      </AnimatePresence>
    </>
  );
}
