import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { encryptSecret, decryptSecret } from "../../utils/encryption.js";

/**
 * Encrypt and upsert a secret for a tenant.
 * Each (tenant_id, type) pair stores exactly one secret — updates in place.
 */
export const storeSecret = async (tenant_id, type, plaintext) => {
  const encrypted = encryptSecret(plaintext, tenant_id);
  if (!encrypted) throw new Error("Encryption failed: empty plaintext");

  await db.sequelize.query(
    `INSERT INTO ${tableNames.TENANT_SECRETS}
       (tenant_id, type, encrypted_value, iv, auth_tag, key_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       encrypted_value = VALUES(encrypted_value),
       iv              = VALUES(iv),
       auth_tag        = VALUES(auth_tag),
       key_version     = VALUES(key_version),
       updated_at      = NOW()`,
    {
      replacements: [
        tenant_id,
        type,
        encrypted.encrypted_value,
        encrypted.iv,
        encrypted.auth_tag,
        encrypted.key_version,
      ],
    },
  );
};

/**
 * Fetch and decrypt a secret. Returns null if not found.
 * Decrypt only at the point of use — do not cache the raw value.
 */
export const getSecret = async (tenant_id, type) => {
  const [rows] = await db.sequelize.query(
    `SELECT encrypted_value, iv, auth_tag, key_version
     FROM ${tableNames.TENANT_SECRETS}
     WHERE tenant_id = ? AND type = ?
     LIMIT 1`,
    { replacements: [tenant_id, type] },
  );
  if (!rows.length) return null;
  return decryptSecret(rows[0], tenant_id);
};

/**
 * Returns true if a secret of the given type exists for this tenant.
 */
export const hasSecret = async (tenant_id, type) => {
  const [rows] = await db.sequelize.query(
    `SELECT 1 FROM ${tableNames.TENANT_SECRETS}
     WHERE tenant_id = ? AND type = ?
     LIMIT 1`,
    { replacements: [tenant_id, type] },
  );
  return rows.length > 0;
};

/**
 * Delete a secret — use when tenant removes their key.
 */
export const deleteSecret = async (tenant_id, type) => {
  await db.sequelize.query(
    `DELETE FROM ${tableNames.TENANT_SECRETS} WHERE tenant_id = ? AND type = ?`,
    { replacements: [tenant_id, type] },
  );
};
