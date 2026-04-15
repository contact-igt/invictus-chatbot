-- Migration: 002_alter_admin_audit_log_for_global_gst.sql
-- Purpose : Allow global admin audit events and add explicit GST action types.
-- Run once against the target database before removing GST audit compatibility fallbacks.

ALTER TABLE `admin_audit_log`
  MODIFY COLUMN `tenant_id` VARCHAR(255) NULL COMMENT 'Target tenant, or NULL for global admin actions',
  MODIFY COLUMN `action_type` ENUM(
    'force_unlock',
    'manual_credit',
    'manual_invoice_close',
    'billing_mode_change',
    'pricing_update',
    'currency_rate_update',
    'tenant_limit_change',
    'credit_limit_change',
    'gst_rate_change',
    'gst_rate_deactivate',
    'gst_rate_delete'
  ) NOT NULL;

-- Backfill GST audit rows that were stored through the compatibility fallback.
UPDATE `admin_audit_log`
SET
  `tenant_id` = NULL,
  `action_type` = CASE JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.event'))
    WHEN 'activated' THEN 'gst_rate_change'
    WHEN 'deactivated' THEN 'gst_rate_deactivate'
    WHEN 'deleted' THEN 'gst_rate_delete'
    ELSE `action_type`
  END
WHERE `tenant_id` = 'GLOBAL_GST'
  AND `action_type` = 'pricing_update'
  AND JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.scope')) = 'gst_rate';
