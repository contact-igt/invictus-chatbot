-- 2026-04-08: Feature audit fixes migration
-- MySQL compatible DDL

-- 1) Campaign status enum update
ALTER TABLE whatsapp_campaigns
  MODIFY COLUMN status ENUM('draft','scheduled','active','completed','failed','paused','cancelled')
  NOT NULL DEFAULT 'draft';

-- 2) Campaign recipient retry/tracking fields + status enum update
ALTER TABLE whatsapp_campaign_recipients
  MODIFY COLUMN status ENUM('pending','sent','delivered','read','replied','failed','permanently_failed')
  NOT NULL DEFAULT 'pending',
  ADD COLUMN retry_count INT NOT NULL DEFAULT 0 AFTER dynamic_variables,
  ADD COLUMN next_retry_at DATETIME NULL AFTER retry_count,
  ADD COLUMN last_error TEXT NULL AFTER next_retry_at,
  ADD COLUMN opened_at DATETIME NULL AFTER last_error,
  ADD COLUMN clicked_at DATETIME NULL AFTER opened_at;

CREATE INDEX idx_recipient_retry
  ON whatsapp_campaign_recipients (status, retry_count, next_retry_at);

-- 3) Campaign events table for open/click tracking
CREATE TABLE IF NOT EXISTS campaign_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id VARCHAR(255) NOT NULL,
  recipient_id INT NOT NULL,
  event_type ENUM('open','click') NOT NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_campaign_events_campaign (campaign_id),
  INDEX idx_campaign_events_recipient (recipient_id),
  INDEX idx_campaign_events_type (event_type)
);

-- 4) Foreign keys for critical relations (tenant_id model uses tenant_id key)
ALTER TABLE whatsapp_templates
  ADD CONSTRAINT fk_templates_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE whatsapp_campaigns
  ADD CONSTRAINT fk_campaigns_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE whatsapp_campaigns
  ADD CONSTRAINT fk_campaigns_template
  FOREIGN KEY (template_id) REFERENCES whatsapp_templates(template_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE whatsapp_campaign_recipients
  ADD CONSTRAINT fk_campaign_recipients_campaign
  FOREIGN KEY (campaign_id) REFERENCES whatsapp_campaigns(campaign_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE media_assets
  ADD CONSTRAINT fk_media_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE media_assets
  ADD CONSTRAINT fk_media_uploaded_by
  FOREIGN KEY (uploaded_by) REFERENCES tenant_users(tenant_user_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE campaign_events
  ADD CONSTRAINT fk_campaign_events_campaign
  FOREIGN KEY (campaign_id) REFERENCES whatsapp_campaigns(campaign_id)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE campaign_events
  ADD CONSTRAINT fk_campaign_events_recipient
  FOREIGN KEY (recipient_id) REFERENCES whatsapp_campaign_recipients(id)
  ON UPDATE CASCADE ON DELETE CASCADE;

