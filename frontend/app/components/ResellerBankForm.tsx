"use client";

import { useEffect, useState } from "react";
import { fetchMyReseller, saveMyResellerBank, type ResellerBank } from "../lib/api";
import { useSession } from "../providers";
import styles from "./ResellerBankForm.module.css";

/** Bank, account name and number a reseller's commission is transferred to. */
export function ResellerBankForm({
  banks,
  current,
  onSaved,
}: {
  banks: string[];
  current?: ResellerBank | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ResellerBank>({
    bankName: current?.bankName ?? "",
    accountName: current?.accountName ?? "",
    accountNumber: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await saveMyResellerBank(form);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.form}>
      <label>
        ธนาคาร
        <select value={form.bankName} onChange={(event) => setForm({ ...form, bankName: event.target.value })}>
          <option value="">เลือกธนาคาร</option>
          {banks.map((bank) => (
            <option key={bank} value={bank}>
              {bank}
            </option>
          ))}
        </select>
      </label>
      <label>
        ชื่อบัญชี
        <input
          placeholder="ชื่อ-นามสกุล ตามบัญชี"
          value={form.accountName}
          onChange={(event) => setForm({ ...form, accountName: event.target.value })}
        />
      </label>
      <label>
        หมายเลขบัญชี{current ? ` (ปัจจุบัน ${current.accountNumber})` : ""}
        <input
          inputMode="numeric"
          placeholder="ตัวเลขเท่านั้น"
          value={form.accountNumber}
          onChange={(event) => setForm({ ...form, accountNumber: event.target.value.replace(/\D/g, "") })}
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button
        disabled={saving || !form.bankName || !form.accountName.trim() || form.accountNumber.length < 10}
        onClick={() => void save()}
        type="button"
      >
        {saving ? "กำลังบันทึก…" : "บันทึกบัญชีรับค่าคอม"}
      </button>
    </div>
  );
}

/** Pops up on any page for a newly appointed reseller until their bank account is saved. */
export function ResellerBankPrompt() {
  const { user, refreshSession } = useSession();
  const [banks, setBanks] = useState<string[] | null>(null);

  useEffect(() => {
    if (!user?.resellerNeedsBank) return;
    fetchMyReseller()
      .then((data) => setBanks(data.banks))
      .catch(() => setBanks(null));
  }, [user?.resellerNeedsBank]);

  if (!user?.resellerNeedsBank || !banks) return null;

  return (
    <div className={styles.backdrop} role="presentation">
      <section aria-labelledby="reseller-bank-title" aria-modal="true" className={styles.modal} role="dialog">
        <p className={styles.eyebrow}>RESELLER</p>
        <h2 id="reseller-bank-title">คุณได้รับแต่งตั้งเป็นตัวแทนจำหน่าย</h2>
        <p className={styles.muted}>กรอกบัญชีธนาคารสำหรับรับค่าคอมมิชชัน (แก้ไขภายหลังได้ที่หน้าตัวแทนจำหน่าย)</p>
        <ResellerBankForm banks={banks} onSaved={() => void refreshSession()} />
      </section>
    </div>
  );
}
