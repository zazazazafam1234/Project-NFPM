"use client";

import { useEffect, useState } from "react";
import type { ResellerCandidate } from "../lib/api";
import styles from "./UserPicker.module.css";

/** Type a name or email, pick one account from the matches. */
export function UserPicker({
  search,
  selected,
  onSelect,
  disable,
}: {
  search: (q: string) => Promise<{ users: ResellerCandidate[] }>;
  selected: ResellerCandidate | null;
  onSelect: (user: ResellerCandidate | null) => void;
  /** Why a match cannot be picked (e.g. already a reseller), or null. */
  disable: (user: ResellerCandidate) => string | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResellerCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      queueMicrotask(() => setResults([]));
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      search(q)
        .then((data) => setResults(data.users))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  if (selected) {
    return (
      <div className={styles.pickedUser}>
        <div>
          <b>{selected.name}</b>
          <small>{selected.email}</small>
        </div>
        <button className={styles.change} onClick={() => onSelect(null)} type="button">
          เปลี่ยน
        </button>
      </div>
    );
  }

  return (
    <div className={styles.userPicker}>
      <input
        autoFocus
        placeholder="พิมพ์ชื่อหรืออีเมลเพื่อค้นหา"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() && (
        <ul>
          {results.map((user) => {
            const reason = disable(user);
            return (
              <li key={user.id}>
                <button disabled={Boolean(reason)} onClick={() => onSelect(user)} type="button">
                  <b>{user.name}</b>
                  <small>{user.email}</small>
                  {reason && <em>{reason}</em>}
                </button>
              </li>
            );
          })}
          {!loading && results.length === 0 && <li className={styles.pickerEmpty}>ไม่พบผู้ใช้</li>}
          {loading && <li className={styles.pickerEmpty}>กำลังค้นหา…</li>}
        </ul>
      )}
    </div>
  );
}
