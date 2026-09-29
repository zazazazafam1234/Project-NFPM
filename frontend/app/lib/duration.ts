export type DurationUnit = "minute" | "hour" | "day";

export const DURATION_UNITS: Array<{ unit: DurationUnit; label: string; minutes: number }> = [
  { unit: "minute", label: "นาที", minutes: 1 },
  { unit: "hour", label: "ชั่วโมง", minutes: 60 },
  { unit: "day", label: "วัน", minutes: 1440 },
];

export function toMinutes(value: number, unit: DurationUnit) {
  const found = DURATION_UNITS.find((item) => item.unit === unit);
  return Math.round(value * (found?.minutes ?? 1));
}

// Largest unit that divides the length evenly, e.g. 90 → 90 นาที, 120 → 2 ชั่วโมง.
export function splitDuration(minutes: number): { value: number; unit: DurationUnit } {
  for (const item of [...DURATION_UNITS].reverse()) {
    if (minutes >= item.minutes && minutes % item.minutes === 0) {
      return { value: minutes / item.minutes, unit: item.unit };
    }
  }
  return { value: minutes, unit: "minute" };
}

// "7 วัน", "2 ชั่วโมง", "1 วัน 6 ชั่วโมง", "30 นาที"
export function formatDuration(minutes: number) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [
    days ? `${days} วัน` : "",
    hours ? `${hours} ชั่วโมง` : "",
    mins ? `${mins} นาที` : "",
  ].filter(Boolean);
  return parts.join(" ") || "0 นาที";
}
