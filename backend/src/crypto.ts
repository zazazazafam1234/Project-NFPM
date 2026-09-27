import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function parseCredentialKey(configured: string, label: string) {
  const raw = Buffer.from(configured, "base64");
  if (raw.length === KEY_BYTES) return raw;

  const utf8 = Buffer.from(configured, "utf8");
  if (utf8.length >= KEY_BYTES) return utf8.subarray(0, KEY_BYTES);

  throw new Error(`${label} must be 32 bytes or a base64 encoded 32-byte key`);
}

function getCredentialKey() {
  const configured = process.env.CREDENTIAL_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
  if (!configured) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured");
  }

  return parseCredentialKey(configured, "CREDENTIAL_ENCRYPTION_KEY");
}

function getCredentialDecryptKeys() {
  const candidates = [
    ["CREDENTIAL_ENCRYPTION_KEY", process.env.CREDENTIAL_ENCRYPTION_KEY],
    ["JWT_SECRET", process.env.JWT_SECRET],
  ] as const;
  const keys: Buffer[] = [];
  const seen = new Set<string>();

  for (const [label, value] of candidates) {
    if (!value) continue;
    const key = parseCredentialKey(value, label);
    const fingerprint = key.toString("base64");
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      keys.push(key);
    }
  }

  if (keys.length === 0) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured");
  }

  return keys;
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

  let lastError: unknown;
  for (const key of getCredentialDecryptKeys()) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to decrypt secret");
}
