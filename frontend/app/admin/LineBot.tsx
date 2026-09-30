"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchLineBot, removeLineBotGroup, saveLineBot, testLineBot, type LineBotStatus } from "../lib/api";
import styles from "./page.module.css";
import rewardStyles from "./rewards.module.css";

// LINE Messaging API bot that posts admin alerts into LINE groups.
export function LineBotPanel({ onDone }: { onDone: (message: string) => void }) {
  const [status, setStatus] = useState<LineBotStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchLineBot()
      .then(setStatus)
      .catch((err) => window.alert(err instanceof Error ? err.message : "โหลดสถานะบอทไม่สำเร็จ"));
  }, []);
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      onDone(success);
      window.alert(success);
      load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>LINE ALERT BOT</p>
          <h2>บอท LINE แจ้งเตือนแอดมิน</h2>
          <p className={styles.muted}>
            แจ้งในกลุ่ม LINE เมื่อลูกค้ากด “ฉันจ่ายเงินแล้ว ยังไม่เข้า” ·{" "}
            {status?.configured
              ? `เชื่อมต่อแล้ว${status.source === "env" ? " (ค่าจาก .env)" : ""}`
              : "ยังไม่ได้ตั้งค่า"}
          </p>
        </div>
        <div className={styles.panelTools}>
          <button
            className={styles.primary}
            disabled={busy || !status?.configured}
            onClick={() => void act(testLineBot, "ส่งข้อความทดสอบเข้ากลุ่มแล้ว")}
            type="button"
          >
            ส่งข้อความทดสอบ
          </button>
        </div>
      </div>

      <ol className={rewardStyles.steps}>
        <li>
          สร้าง Messaging API channel ที่ <a href="https://developers.line.biz/console/" rel="noreferrer" target="_blank">LINE Developers</a> แล้วเปิด “Allow bot to join group chats”
        </li>
        <li>
          ตั้ง Webhook URL เป็น <code>{status?.webhookUrl ?? "…"}</code> เปิด Use webhook และปิด Auto-reply
        </li>
        <li>ใส่ Channel secret และ Channel access token ด้านล่าง แล้วเชิญบอทเข้ากลุ่ม LINE</li>
      </ol>

      <div className={`${styles.formRows} ${rewardStyles.inlineForm}`}>
        <label>
          Channel secret {status?.hasSecret ? "(ตั้งแล้ว · เว้นว่าง = ไม่เปลี่ยน)" : ""}
          <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} />
        </label>
        <label>
          Channel access token {status?.hasToken ? "(ตั้งแล้ว · เว้นว่าง = ไม่เปลี่ยน)" : ""}
          <input type="password" value={token} onChange={(event) => setToken(event.target.value)} />
        </label>
        <div className={styles.formActions}>
          <button
            className={styles.primary}
            disabled={busy || (!secret.trim() && !token.trim())}
            onClick={() =>
              void act(async () => {
                await saveLineBot({ secret: secret.trim() || undefined, token: token.trim() || undefined });
                setSecret("");
                setToken("");
              }, "บันทึกค่าบอท LINE แล้ว")
            }
            type="button"
          >
            บันทึก
          </button>
        </div>
      </div>

      <div className={styles.table}>
        {(status?.groups ?? []).map((group) => (
          <div key={group.groupId}>
            <b>{group.name ?? "กลุ่ม LINE"}</b>
            <span>
              {group.groupId} · เข้ากลุ่ม {new Date(group.joinedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
            </span>
            <button
              className={styles.danger}
              disabled={busy}
              onClick={() => {
                if (window.confirm(`หยุดส่งแจ้งเตือนเข้ากลุ่ม ${group.name ?? group.groupId}?`)) {
                  void act(() => removeLineBotGroup(group.groupId), "หยุดแจ้งเตือนกลุ่มนี้แล้ว");
                }
              }}
              type="button"
            >
              ลบกลุ่ม
            </button>
          </div>
        ))}
        {status && status.groups.length === 0 && (
          <p className={styles.emptyInline}>ยังไม่มีกลุ่ม · เชิญบอทเข้ากลุ่ม LINE แล้วกลุ่มจะขึ้นที่นี่อัตโนมัติ</p>
        )}
      </div>
    </section>
  );
}
