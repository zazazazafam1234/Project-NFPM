"use client";

import { usePathname } from "next/navigation";
import styles from "./SupportButton.module.css";

export const SUPPORT_DISCORD_URL = "https://discord.gg/9guggS5EXD";

// Floating "having a problem?" button on customer pages, opening our Discord.
export function SupportButton() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return (
    <a
      className={styles.button}
      href={SUPPORT_DISCORD_URL}
      rel="noopener noreferrer"
      target="_blank"
      aria-label="มีปัญหา? ติดต่อเราทาง Discord"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
        <path
          fill="currentColor"
          d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.7.1 18.2a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.8-3.6-13.8ZM8 15.5c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.7 8 10.7s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"
        />
      </svg>
      <span>มีปัญหา? ติดต่อเรา</span>
    </a>
  );
}
