/**
 * Database Table Associations
 *
 * This file defines all Sequelize associations between database tables.
 * Associations enable eager loading and navigation between related records.
 *
 * Note: All associations use `constraints: false` to prevent automatic
 * foreign key constraint creation in the database, allowing for more
 * flexible schema management while maintaining Sequelize relationships.
 */

export const defineAssociations = (db) => {
  // ========================================
  // TENANT RELATIONSHIPS
  // ========================================

  // Tenant → TenantUsers (One-to-Many)
  db.Tenants.hasMany(db.TenantUsers, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "users",
    constraints: false,
  });
  db.TenantUsers.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → TenantInvitations (One-to-Many)
  db.Tenants.hasMany(db.TenantInvitations, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "invitations",
    constraints: false,
  });
  db.TenantInvitations.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → WhatsappAccount (One-to-One)
  db.Tenants.hasOne(db.Whatsappaccount, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "whatsappAccount",
    constraints: false,
  });
  db.Whatsappaccount.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → Contacts (One-to-Many)
  db.Tenants.hasMany(db.Contacts, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "contacts",
    constraints: false,
  });
  db.Contacts.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → WhatsappTemplates (One-to-Many)
  db.Tenants.hasMany(db.WhatsappTemplates, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "templates",
    constraints: false,
  });
  db.WhatsappTemplates.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → KnowledgeSources (One-to-Many)
  db.Tenants.hasMany(db.KnowledgeSources, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "knowledgeSources",
    constraints: false,
  });
  db.KnowledgeSources.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → AiPrompt (One-to-Many)
  db.Tenants.hasMany(db.AiPrompt, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "aiPrompts",
    constraints: false,
  });
  db.AiPrompt.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → Leads (One-to-Many)
  db.Tenants.hasMany(db.Leads, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "leads",
    constraints: false,
  });
  db.Leads.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → Messages (One-to-Many)
  db.Tenants.hasMany(db.Messages, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "messages",
    constraints: false,
  });
  db.Messages.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → LiveChat (One-to-Many)
  db.Tenants.hasMany(db.LiveChat, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "liveChats",
    constraints: false,
  });
  db.LiveChat.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → WhatsappCampaigns (One-to-Many)
  db.Tenants.hasMany(db.WhatsappCampaigns, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "campaigns",
    constraints: false,
  });
  db.WhatsappCampaigns.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → ContactGroups (One-to-Many)
  db.Tenants.hasMany(db.ContactGroups, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "contactGroups",
    constraints: false,
  });
  db.ContactGroups.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → AiAnalysisLogs (One-to-Many)
  db.Tenants.hasMany(db.AiAnalysisLog, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "aiAnalysisLogs",
    constraints: false,
  });
  db.AiAnalysisLog.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → Doctors (One-to-Many)
  db.Tenants.hasMany(db.Doctors, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "doctors",
    constraints: false,
  });
  db.Doctors.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → Specializations (One-to-Many)
  db.Tenants.hasMany(db.Specializations, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "specializations",
    constraints: false,
  });
  db.Specializations.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // ========================================
  // CONTACT RELATIONSHIPS
  // ========================================

  // Contacts → Leads (One-to-One)
  db.Contacts.hasOne(db.Leads, {
    foreignKey: "contact_id",
    sourceKey: "contact_id",
    as: "lead",
    constraints: false,
  });
  db.Leads.belongsTo(db.Contacts, {
    foreignKey: "contact_id",
    targetKey: "contact_id",
    as: "contact",
    constraints: false,
  });

  // Contacts → Messages (One-to-Many)
  db.Contacts.hasMany(db.Messages, {
    foreignKey: "contact_id",
    sourceKey: "contact_id",
    as: "messages",
    constraints: false,
  });
  db.Messages.belongsTo(db.Contacts, {
    foreignKey: "contact_id",
    targetKey: "contact_id",
    as: "contact",
    constraints: false,
  });

  // Contacts → LiveChat (One-to-One)
  db.Contacts.hasOne(db.LiveChat, {
    foreignKey: "contact_id",
    sourceKey: "contact_id",
    as: "liveChat",
    constraints: false,
  });
  db.LiveChat.belongsTo(db.Contacts, {
    foreignKey: "contact_id",
    targetKey: "contact_id",
    as: "contact",
    constraints: false,
  });

  // Contact → ContactGroupMembers (One-to-Many)
  db.Contacts.hasMany(db.ContactGroupMembers, {
    foreignKey: "contact_id",
    sourceKey: "contact_id",
    as: "groupMemberships",
    constraints: false,
  });
  db.ContactGroupMembers.belongsTo(db.Contacts, {
    foreignKey: "contact_id",
    targetKey: "contact_id",
    as: "contact",
    constraints: false,
  });

  // ========================================
  // KNOWLEDGE BASE RELATIONSHIPS
  // ========================================

  // KnowledgeSources → KnowledgeChunks (One-to-Many)
  db.KnowledgeSources.hasMany(db.KnowledgeChunks, {
    foreignKey: "source_id",
    sourceKey: "id",
    as: "chunks",
    constraints: false,
  });
  db.KnowledgeChunks.belongsTo(db.KnowledgeSources, {
    foreignKey: "source_id",
    targetKey: "id",
    as: "source",
    constraints: false,
  });

  // ========================================
  // WHATSAPP TEMPLATE RELATIONSHIPS
  // ========================================

  // WhatsappTemplate → WhatsappTemplateComponents (One-to-Many)
  db.WhatsappTemplates.hasMany(db.WhatsappTemplateComponents, {
    foreignKey: "template_id",
    sourceKey: "template_id",
    as: "components",
    constraints: false,
  });
  db.WhatsappTemplateComponents.belongsTo(db.WhatsappTemplates, {
    foreignKey: "template_id",
    targetKey: "template_id",
    as: "template",
    constraints: false,
  });

  // WhatsappTemplate → WhatsappTemplateVariables (One-to-Many)
  db.WhatsappTemplates.hasMany(db.WhatsappTemplateVariables, {
    foreignKey: "template_id",
    sourceKey: "template_id",
    as: "variables",
    constraints: false,
  });
  db.WhatsappTemplateVariables.belongsTo(db.WhatsappTemplates, {
    foreignKey: "template_id",
    targetKey: "template_id",
    as: "template",
    constraints: false,
  });

  // WhatsappTemplate → WhatsappTemplateSyncLogs (One-to-Many)
  db.WhatsappTemplates.hasMany(db.WhatsappTemplateSyncLogs, {
    foreignKey: "template_id",
    sourceKey: "template_id",
    as: "syncLogs",
    constraints: false,
  });
  db.WhatsappTemplateSyncLogs.belongsTo(db.WhatsappTemplates, {
    foreignKey: "template_id",
    targetKey: "template_id",
    as: "template",
    constraints: false,
  });

  // ========================================
  // CAMPAIGN RELATIONSHIPS
  // ========================================

  // WhatsappCampaign → WhatsappCampaignRecipients (One-to-Many)
  db.WhatsappCampaigns.hasMany(db.WhatsappCampaignRecipients, {
    foreignKey: "campaign_id",
    sourceKey: "campaign_id",
    as: "recipients",
    constraints: false,
  });
  db.WhatsappCampaignRecipients.belongsTo(db.WhatsappCampaigns, {
    foreignKey: "campaign_id",
    targetKey: "campaign_id",
    as: "campaign",
    constraints: false,
  });

  // WhatsappCampaign → WhatsappTemplate (Belongs-to)
  db.WhatsappCampaigns.belongsTo(db.WhatsappTemplates, {
    foreignKey: "template_id",
    targetKey: "template_id",
    as: "template",
    constraints: false,
  });

  // ========================================
  // CONTACT GROUP RELATIONSHIPS
  // ========================================

  // ContactGroup → ContactGroupMembers (One-to-Many)
  db.ContactGroups.hasMany(db.ContactGroupMembers, {
    foreignKey: "group_id",
    sourceKey: "group_id",
    as: "members",
    constraints: false,
  });
  db.ContactGroupMembers.belongsTo(db.ContactGroups, {
    foreignKey: "group_id",
    targetKey: "group_id",
    as: "group",
    constraints: false,
  });

  // ========================================
  // DOCTOR MODULE RELATIONSHIPS
  // ========================================

  // Doctor → DoctorAvailability (One-to-Many)
  db.Doctors.hasMany(db.DoctorAvailability, {
    foreignKey: "doctor_id",
    sourceKey: "doctor_id",
    as: "availability",
    constraints: false,
  });
  db.DoctorAvailability.belongsTo(db.Doctors, {
    foreignKey: "doctor_id",
    targetKey: "doctor_id",
    as: "doctor",
    constraints: false,
  });

  // Doctor ↔ Specializations (Many-to-Many via DoctorSpecializations)
  db.Doctors.belongsToMany(db.Specializations, {
    through: db.DoctorSpecializations,
    foreignKey: "doctor_id",
    otherKey: "specialization_id",
    sourceKey: "doctor_id",
    targetKey: "specialization_id",
    as: "specializations",
    constraints: false,
  });
  db.Specializations.belongsToMany(db.Doctors, {
    through: db.DoctorSpecializations,
    foreignKey: "specialization_id",
    otherKey: "doctor_id",
    sourceKey: "specialization_id",
    targetKey: "doctor_id",
    as: "doctors",
    constraints: false,
  });

  // ========================================
  // APPOINTMENT MODULE RELATIONSHIPS
  // ========================================

  // Tenant → Appointments (One-to-Many)
  db.Tenants.hasMany(db.Appointments, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "appointments",
    constraints: false,
  });
  db.Appointments.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Doctor → Appointments (One-to-Many)
  db.Doctors.hasMany(db.Appointments, {
    foreignKey: "doctor_id",
    sourceKey: "doctor_id",
    as: "appointments",
    constraints: false,
  });
  db.Appointments.belongsTo(db.Doctors, {
    foreignKey: "doctor_id",
    targetKey: "doctor_id",
    as: "doctor",
    constraints: false,
  });

  // Contact → Appointments (One-to-Many)
  db.Contacts.hasMany(db.Appointments, {
    foreignKey: "contact_id",
    sourceKey: "contact_id",
    as: "appointments",
    constraints: false,
  });
  db.Appointments.belongsTo(db.Contacts, {
    foreignKey: "contact_id",
    targetKey: "contact_id",
    as: "contact",
    constraints: false,
  });

  // ========================================
  // BILLING MODULE RELATIONSHIPS
  // ========================================

  // Tenant → MessageUsage (One-to-Many)
  db.Tenants.hasMany(db.MessageUsage, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "messageUsages",
    constraints: false,
  });
  db.MessageUsage.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → BillingLedger (One-to-Many)
  db.Tenants.hasMany(db.BillingLedger, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "billingLedgers",
    constraints: false,
  });
  db.BillingLedger.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // MessageUsage → BillingLedger (One-to-One)
  db.MessageUsage.hasOne(db.BillingLedger, {
    foreignKey: "message_usage_id",
    sourceKey: "id",
    as: "billingLedger",
    constraints: false,
  });
  db.BillingLedger.belongsTo(db.MessageUsage, {
    foreignKey: "message_usage_id",
    targetKey: "id",
    as: "messageUsage",
    constraints: false,
  });

  // MessageUsage → Messages (One-to-One via WAMID)
  db.MessageUsage.belongsTo(db.Messages, {
    foreignKey: "message_id",
    targetKey: "wamid",
    as: "messageDetails",
    constraints: false,
  });

  // ========================================
  // WALLET MODULE RELATIONSHIPS
  // ========================================

  // Tenant → Wallet (One-to-One)
  db.Tenants.hasOne(db.Wallets, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "wallet",
    constraints: false,
  });
  db.Wallets.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → WalletTransactions (One-to-Many)
  db.Tenants.hasMany(db.WalletTransactions, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "walletTransactions",
    constraints: false,
  });
  db.WalletTransactions.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  return db;
};
