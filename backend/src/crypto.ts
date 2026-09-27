import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function getCredentialKey() {
  const configured = process.env.CREDENTIAL_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
  if (!configured) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured");
  }

  const raw = Buffer.from(configured, "base64");
  if (raw.length === KEY_BYTES) return raw;

  const utf8 = Buffer.from(configured, "utf8");
  if (utf8.length >= KEY_BYTES) return utf8.subarray(0, KEY_BYTES);

  throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 32 bytes or a base64 encoded 32-byte key");
}

export function encryptSecret(value: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getCredentialKey(), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

export function decryptSecret(ciphertext: string | null) {
  if (!ciphertext) return null;
  const [version, payload] = ciphertext.split(":", 2);
  if (version !== "v1" || !payload) {
    throw new Error("Unsupported ciphertext version");
  }

  const data = Buffer.from(payload, "base64");
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const encrypted = data.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, getCredentialKey(), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
