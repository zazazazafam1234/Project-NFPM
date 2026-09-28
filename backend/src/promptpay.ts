function formatValue(id: string, value: string) {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

function crc16Ccitt(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function normalizePromptPayTarget(target: string) {
  const digits = target.replace(/\D/g, "");

  if (digits.length === 10 && digits.startsWith("0")) {
    return { tag: "01", value: `0066${digits.slice(1)}` };
  }
  if (digits.length === 13) {
    return { tag: "02", value: digits };
  }
  if (digits.length >= 11 && digits.length <= 15) {
    return { tag: "01", value: digits };
  }

  throw new Error("PROMPTPAY_ID ต้องเป็นเบอร์มือถือหรือเลขบัตร/นิติบุคคลที่ถูกต้อง");
}

export function buildPromptPayPayload(target: string, amount: number) {
  const proxy = normalizePromptPayTarget(target);
  const merchantInfo = [
    formatValue("00", "A000000677010111"),
    formatValue(proxy.tag, proxy.value),
  ].join("");
  const withoutCrc = [
    formatValue("00", "01"),
    formatValue("01", "12"),
    formatValue("29", merchantInfo),
    formatValue("53", "764"),
    formatValue("54", amount.toFixed(2)),
    formatValue("58", "TH"),
    "6304",
  ].join("");

  return `${withoutCrc}${crc16Ccitt(withoutCrc)}`;
}
