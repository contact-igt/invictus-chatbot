/**
 * Migration: 20260422_create_tenant_secrets
 *
 * 1. Creates tenant_secrets table — stores AES-256-GCM encrypted secrets
 *    (OpenAI API keys, WhatsApp access tokens) with per-tenant key derivation.
 * 2. Makes whatsapp_accounts.access_token nullable so plaintext can be cleared
 *    once the secret is migrated to tenant_secrets.
 *
 * Run: node migrations/20260422_create_tenant_secrets.js
 */

import db from "../src/database/index.js";

const up = async () => {
  // 1. Create tenant_secrets table
  await db.sequelize.query(`
    CREATE TABLE IF NOT EXISTS tenant_secrets (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id       VARCHAR(255) NOT NULL,
      type            ENUM('openai', 'whatsapp') NOT NULL,
      encrypted_value TEXT NOT NULL,
      iv              VARCHAR(64) NOT NULL,
      auth_tag        VARCHAR(64) NOT NULL,
      key_version     INT NOT NULL DEFAULT 1,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_tenant_secret_type (tenant_id, type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("[migration] tenant_secrets table created");

  // 2. Make whatsapp_accounts.access_token nullable
  //    Plaintext will be cleared after secrets are moved to tenant_secrets.
  await db.sequelize.query(`
    ALTER TABLE whatsapp_accounts
    MODIFY COLUMN access_token TEXT NULL;
  `);
  console.log("[migration] whatsapp_accounts.access_token is now nullable");

  console.log("[migration] 20260422_create_tenant_secrets complete");
  await db.sequelize.close();
};

up().catch((err) => {
  console.error("[migration] failed:", err.message);
  process.exit(1);
});
