-- Migration: 001_create_tax_settings.sql
-- Purpose : Create tax_settings table and seed the default 18% GST rate.
-- Run once against the target database before deploying the dynamic GST feature.
-- Safe to re-run: CREATE TABLE ... IF NOT EXISTS + INSERT IGNORE prevent duplicates.

CREATE TABLE IF NOT EXISTS `tax_settings` (
  `id`             INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `gst_rate`       DECIMAL(5,2) NOT NULL COMMENT 'GST percentage, e.g. 18.00',
  `effective_from` DATETIME     NOT NULL COMMENT 'Rate is effective from this timestamp',
  `is_active`      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = currently active rate',
  `created_by`     VARCHAR(255) NOT NULL COMMENT 'Management admin ID',
  `notes`          VARCHAR(500)     NULL COMMENT 'Optional reason / reference',
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_tax_settings_is_active`      (`is_active`),
  INDEX `idx_tax_settings_effective_from` (`effective_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the initial 18% GST rate (active immediately).
-- INSERT IGNORE skips silently if a row with the same PK already exists.
INSERT IGNORE INTO `tax_settings`
  (`id`, `gst_rate`, `effective_from`, `is_active`, `created_by`, `notes`)
VALUES
  (1, 18.00, NOW(), 1, 'system', 'Default GST rate — seeded at migration time');

-- Add gst_rate snapshot column to monthly_invoices (stores rate at generation time).
-- Column is nullable so existing rows without a rate remain valid.
ALTER TABLE `monthly_invoices`
  ADD COLUMN IF NOT EXISTS `gst_rate` DECIMAL(5,2) NULL
  COMMENT 'GST % rate used at invoice generation time (immutable snapshot)'
  AFTER `tenant_gstin`;
