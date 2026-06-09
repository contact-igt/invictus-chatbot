import crypto from "crypto";

// ─── Master key ────────────────────────────────────────────────────────────

const getMasterKey = () => {
  const hex = process.env.ENCRYPTION_MASTER_KEY;
  if (!hex) throw new Error("ENCRYPTION_MASTER_KEY is not set in environment variables");
  return Buffer.from(hex, "hex");
};

// ─── Per-tenant key derivation ─────────────────────────────────────────────
// DB leak alone → useless. Master key alone → useless. Need both.

const deriveKey = (masterKey, tenantId) =>
  crypto.createHmac("sha256", masterKey).update(String(tenantId)).digest().slice(0, 32);

// ─── AES-256-GCM (authenticated encryption) ────────────────────────────────
// Use this for ALL new secret storage.

export const encryptSecret = (plaintext, tenantId) => {
  if (!plaintext) return null;
  const key = deriveKey(getMasterKey(), tenantId);
  const iv = crypto.randomBytes(12); // GCM standard: 96-bit nonce
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    encrypted_value: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    key_version: 1,
  };
};

export const decryptSecret = (data, tenantId) => {
  if (!data?.encrypted_value || !data?.iv || !data?.auth_tag) return null;
  const key = deriveKey(getMasterKey(), tenantId);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(data.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(data.auth_tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data.encrypted_value, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};

// ─── Legacy AES-256-CBC ─────────────────────────────────────────────────────
// Kept ONLY to read old OpenAI keys still stored in ai_settings JSON column.
// Do NOT use for new writes. Will be removed once all tenants are migrated.

export const encrypt = (plaintext) => {
  if (!plaintext) return "";
  const key = getMasterKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
};

export const decrypt = (encryptedText) => {
  if (!encryptedText || !encryptedText.includes(":")) return "";
  const key = getMasterKey();
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

// ─── Display masking ────────────────────────────────────────────────────────

export const maskApiKey = (key) => {
  if (!key || key.length < 12) return "••••••••";
  return `${key.slice(0, 7)}${"•".repeat(Math.max(4, key.length - 11))}${key.slice(-4)}`;
};
