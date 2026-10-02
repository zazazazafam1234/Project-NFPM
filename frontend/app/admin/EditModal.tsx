"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import styles from "./page.module.css";

export function EditModal({
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
