import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";

/**
 * Get the master encryption key from environment.
 * Must be a 64-character hex string (32 bytes).
 */
const getMasterKey = () => {
  const masterKeyHex = process.env.ENCRYPTION_MASTER_KEY;
  if (!masterKeyHex) {
    throw new Error(
      "ENCRYPTION_MASTER_KEY is not set in environment variables",
    );
  }
  return Buffer.from(masterKeyHex, "hex");
};

/**
 * Encrypt a plaintext string using AES-256-CBC.
 * Returns format: "iv_hex:encrypted_hex"
 *
 * @param {string} plaintext - The string to encrypt
 * @returns {string} The encrypted string in "iv:ciphertext" format
 */
export const encrypt = (plaintext) => {
  if (!plaintext) return "";
  const key = getMasterKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
};

/**
 * Decrypt an encrypted string produced by encrypt().
 * Expects format: "iv_hex:encrypted_hex"
 *
 * @param {string} encryptedText - The encrypted string
 * @returns {string} The original plaintext
 */
export const decrypt = (encryptedText) => {
  if (!encryptedText || !encryptedText.includes(":")) return "";
  const key = getMasterKey();
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

/**
 * Mask an API key for safe display: shows first 7 and last 4 characters.
 * e.g. "sk-proj-abc...wxyz"
 *
 * @param {string} key - The raw API key
 * @returns {string} Masked key
 */
export const maskApiKey = (key) => {
  if (!key || key.length < 12) return "••••••••";
  return `${key.slice(0, 7)}${"•".repeat(Math.max(4, key.length - 11))}${key.slice(-4)}`;
};
