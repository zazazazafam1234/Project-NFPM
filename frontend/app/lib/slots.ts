const SLOT_STATUS_LABELS: Record<string, string> = {
  rented: "มีคนเช่าแล้ว",
  reserved: "ติดจองอยู่",
  inactive: "ปิดใช้งาน",
  expired: "หมดอายุ",
  available: "ไม่พร้อมใช้งาน",
};

// Label for a slot that cannot be chosen, based on the status the catalog reports.
export function unavailableSlotLabel(status: string) {
  return SLOT_STATUS_LABELS[status] ?? status;
}
