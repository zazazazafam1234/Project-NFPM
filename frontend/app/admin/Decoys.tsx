"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteAllDecoyRooms,
  deleteDecoyRoom,
  fetchDecoyRooms,
  generateDecoyRooms,
  type DecoyRoom,
} from "../lib/api";
import styles from "./page.module.css";
import rewardStyles from "./rewards.module.css";

// Decoy rooms only decorate the storefront: they are always full and are
// stored apart from real master accounts and profiles.
export function DecoyRoomsPanel({ services, onDone }: { services: string[]; onDone: (message: string) => void }) {
  const [rooms, setRooms] = useState<DecoyRoom[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [form, setForm] = useState({ rooms: "3", slotsPerRoom: "5", service: services[0] ?? "netflix", replace: true });

  const load = useCallback(() => {
    fetchDecoyRooms()
      .then((data) => setRooms(data.rooms))
      .catch((err) => window.alert(err instanceof Error ? err.message : "โหลดห้องหลอกไม่สำเร็จ"));
  }, []);
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function act(action: () => Promise<unknown>, message: string) {
    setIsWorking(true);
    try {
      await action();
      onDone(message);
      window.alert(message);
      load();
      return true;
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
      return false;
    } finally {
      setIsWorking(false);
    }
  }

  async function generate() {
    const roomCount = Number(form.rooms);
    const ok = await act(
      () =>
        generateDecoyRooms({
          rooms: roomCount,
          slotsPerRoom: Number(form.slotsPerRoom),
          service: form.service,
          replace: form.replace,
        }),
      `สุ่มห้องหลอก ${roomCount} บัญชีแม่แล้ว (Slot ไม่ว่างทั้งหมด)`,
    );
    if (ok) setIsOpen(false);
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>DECOY ROOMS</p>
          <h2>ห้องหลอก</h2>
          <p className={styles.muted}>
            ห้องที่แสดงหน้าร้านเป็น “เต็มแล้ว” เท่านั้น ไม่เกี่ยวกับบัญชีจริง ซื้อไม่ได้ และไม่นับในสต็อก/รายงาน
          </p>
        </div>
        <div className={styles.panelTools}>
          {rooms.length > 0 && (
            <button
              className={styles.danger}
              disabled={isWorking}
              onClick={() => {
                if (window.confirm(`ลบห้องหลอกทั้งหมด ${rooms.length} ห้องใช่ไหม?`)) {
                  void act(deleteAllDecoyRooms, "ลบห้องหลอกทั้งหมดแล้ว");
                }
              }}
              type="button"
            >
              ลบทั้งหมด
            </button>
          )}
          <button className={styles.primary} onClick={() => setIsOpen(true)} type="button">
            สุ่มใหม่
          </button>
        </div>
      </div>

      {isOpen && (
        <div className={`${styles.formRows} ${rewardStyles.inlineForm}`}>
          <label>
            สุ่มกี่บัญชีแม่ (ห้อง)
            <input
              inputMode="numeric"
              value={form.rooms}
              onChange={(event) => setForm({ ...form, rooms: event.target.value.replace(/\D/g, "") })}
            />
          </label>
          <label>
            Slot ต่อห้อง (ไม่ว่างทั้งหมด)
            <input
              inputMode="numeric"
              value={form.slotsPerRoom}
              onChange={(event) => setForm({ ...form, slotsPerRoom: event.target.value.replace(/\D/g, "") })}
            />
          </label>
          <label>
            Service
            <select value={form.service} onChange={(event) => setForm({ ...form, service: event.target.value })}>
              {[...new Set([...services, "netflix"])].map((service) => (
                <option key={service} value={service}>
                  {service}
                </option>
              ))}
            </select>
          </label>
          <label className={rewardStyles.checkRow}>
            <input
              checked={form.replace}
              onChange={(event) => setForm({ ...form, replace: event.target.checked })}
              type="checkbox"
            />
            ลบห้องหลอกเดิมทั้งหมดก่อนสุ่ม
          </label>
          <div className={styles.formActions}>
            <button
              className={styles.primary}
              disabled={isWorking || !Number(form.rooms) || !Number(form.slotsPerRoom)}
              onClick={() => void generate()}
              type="button"
            >
              {isWorking ? "กำลังสุ่ม…" : `สุ่ม ${form.rooms || 0} บัญชีแม่`}
            </button>
            <button className={styles.secondary} onClick={() => setIsOpen(false)} type="button">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      <div className={styles.table}>
        {rooms.map((room) => (
          <div key={room.id}>
            <b>{room.service.toUpperCase()} · หลอก</b>
            <span>
              {room.slots.join(", ")} · ไม่ว่าง {room.slots.length}/{room.slots.length} · หมดอายุ{" "}
              {new Date(room.expiresAt).toLocaleDateString("th-TH")}
            </span>
            <button
              className={styles.danger}
              disabled={isWorking}
              onClick={() => void act(() => deleteDecoyRoom(room.id), "ลบห้องหลอกแล้ว")}
              type="button"
            >
              ลบ
            </button>
          </div>
        ))}
        {rooms.length === 0 && <p className={styles.emptyInline}>ยังไม่มีห้องหลอก · กด “สุ่มใหม่” เพื่อสร้าง</p>}
      </div>
    </section>
  );
}
