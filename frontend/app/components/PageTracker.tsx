"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackPageView } from "../lib/api";

const VISITOR_KEY = "fm_visitor_id";

function visitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

// Sends one page view per route change so the admin dashboard can count visitors.
export function PageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    const id = visitorId();
    if (!id) return;
    void trackPageView({
      visitorId: id,
      path: pathname,
      referrer: document.referrer || undefined,
    });
  }, [pathname]);

  return null;
}
