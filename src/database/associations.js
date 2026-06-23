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

  // Tenant → FaqReviews (One-to-Many)
  db.Tenants.hasMany(db.FaqReviews, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "faqReviews",
    constraints: false,
  });
  db.FaqReviews.belongsTo(db.Tenants, {
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

  // Tenant → Branches (One-to-Many)
  db.Tenants.hasMany(db.Branches, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "branches",
    constraints: false,
  });
  db.Branches.belongsTo(db.Tenants, {
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

  // Tenant -> TenantFeatureAccess (One-to-Many)
  db.Tenants.hasMany(db.TenantFeatureAccess, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "featureAccessOverrides",
    constraints: false,
  });
  db.TenantFeatureAccess.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Industries -> Tenants (One-to-Many via business key)
  db.Industries.hasMany(db.Tenants, {
    foreignKey: "industry_id",
    sourceKey: "industry_id",
    as: "tenants",
    constraints: false,
  });
  db.Tenants.belongsTo(db.Industries, {
    foreignKey: "industry_id",
    targetKey: "industry_id",
    as: "industry",
    constraints: false,
  });

  // Plans -> Tenants (One-to-Many via business key)
  db.Plans.hasMany(db.Tenants, {
    foreignKey: "plan_id",
    sourceKey: "plan_id",
    as: "tenants",
    constraints: false,
  });
  db.Tenants.belongsTo(db.Plans, {
    foreignKey: "plan_id",
    targetKey: "plan_id",
    as: "plan",
    constraints: false,
  });

  // Industries -> IndustrySaaSModules (One-to-Many)
  db.Industries.hasMany(db.IndustrySaaSModules, {
    foreignKey: "industry_id",
    sourceKey: "industry_id",
    as: "saasModuleMappings",
    constraints: false,
  });
  db.IndustrySaaSModules.belongsTo(db.Industries, {
    foreignKey: "industry_id",
    targetKey: "industry_id",
    as: "industry",
    constraints: false,
  });

  // SaaSModules -> IndustrySaaSModules (One-to-Many)
  db.SaaSModules.hasMany(db.IndustrySaaSModules, {
    foreignKey: "module_id",
    sourceKey: "module_id",
    as: "industryMappings",
    constraints: false,
  });
  db.IndustrySaaSModules.belongsTo(db.SaaSModules, {
    foreignKey: "module_id",
    targetKey: "module_id",
    as: "saasModule",
    constraints: false,
  });

  // Plans -> PlanSaaSModules (One-to-Many)
  db.Plans.hasMany(db.PlanSaaSModules, {
    foreignKey: "plan_id",
    sourceKey: "plan_id",
    as: "saasModuleMappings",
    constraints: false,
  });
  db.PlanSaaSModules.belongsTo(db.Plans, {
    foreignKey: "plan_id",
    targetKey: "plan_id",
    as: "plan",
    constraints: false,
  });

  // SaaSModules -> PlanSaaSModules (One-to-Many)
  db.SaaSModules.hasMany(db.PlanSaaSModules, {
    foreignKey: "module_id",
    sourceKey: "module_id",
    as: "planMappings",
    constraints: false,
  });
  db.PlanSaaSModules.belongsTo(db.SaaSModules, {
    foreignKey: "module_id",
    targetKey: "module_id",
    as: "saasModule",
    constraints: false,
  });

  // Tenants -> TenantSaaSModuleOverrides (One-to-Many)
  db.Tenants.hasMany(db.TenantSaaSModuleOverrides, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "saasModuleOverrides",
    constraints: false,
  });
  db.TenantSaaSModuleOverrides.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // SaaSModules -> TenantSaaSModuleOverrides (One-to-Many)
  db.SaaSModules.hasMany(db.TenantSaaSModuleOverrides, {
    foreignKey: "module_id",
    sourceKey: "module_id",
    as: "tenantOverrides",
    constraints: false,
  });
  db.TenantSaaSModuleOverrides.belongsTo(db.SaaSModules, {
    foreignKey: "module_id",
    targetKey: "module_id",
    as: "saasModule",
    constraints: false,
  });

  // SaaSModules -> NavigationItems (One-to-Many)
  db.SaaSModules.hasMany(db.NavigationItems, {
    foreignKey: "module_id",
    sourceKey: "module_id",
    as: "navigationItems",
    constraints: false,
  });
  db.NavigationItems.belongsTo(db.SaaSModules, {
    foreignKey: "module_id",
    targetKey: "module_id",
    as: "saasModule",
    constraints: false,
  });

  // SidebarSections -> NavigationItems (One-to-Many via business key)
  db.SidebarSections.hasMany(db.NavigationItems, {
    foreignKey: "sidebar_section_id",
    sourceKey: "sidebar_section_id",
    as: "navigationItems",
    constraints: false,
  });
  db.NavigationItems.belongsTo(db.SidebarSections, {
    foreignKey: "sidebar_section_id",
    targetKey: "sidebar_section_id",
    as: "sidebarSection",
    constraints: false,
  });

  // SidebarSections -> SidebarSectionIndustries (One-to-Many)
  db.SidebarSections.hasMany(db.SidebarSectionIndustries, {
    foreignKey: "sidebar_section_id",
    sourceKey: "sidebar_section_id",
    as: "industryMappings",
    constraints: false,
  });
  db.SidebarSectionIndustries.belongsTo(db.SidebarSections, {
    foreignKey: "sidebar_section_id",
    targetKey: "sidebar_section_id",
    as: "sidebarSection",
    constraints: false,
  });
  db.SidebarSectionIndustries.belongsTo(db.Industries, {
    foreignKey: "industry_id",
    targetKey: "industry_id",
    as: "industry",
    constraints: false,
  });

  // SidebarSections -> SidebarSectionPlans (One-to-Many)
  db.SidebarSections.hasMany(db.SidebarSectionPlans, {
    foreignKey: "sidebar_section_id",
    sourceKey: "sidebar_section_id",
    as: "planMappings",
    constraints: false,
  });
  db.SidebarSectionPlans.belongsTo(db.SidebarSections, {
    foreignKey: "sidebar_section_id",
    targetKey: "sidebar_section_id",
    as: "sidebarSection",
    constraints: false,
  });
  db.SidebarSectionPlans.belongsTo(db.Plans, {
    foreignKey: "plan_id",
    targetKey: "plan_id",
    as: "plan",
    constraints: false,
  });

  // SidebarSections -> SidebarSectionTenants (One-to-Many)
  db.SidebarSections.hasMany(db.SidebarSectionTenants, {
    foreignKey: "sidebar_section_id",
    sourceKey: "sidebar_section_id",
    as: "tenantMappings",
    constraints: false,
  });
  db.SidebarSectionTenants.belongsTo(db.SidebarSections, {
    foreignKey: "sidebar_section_id",
    targetKey: "sidebar_section_id",
    as: "sidebarSection",
    constraints: false,
  });
  db.SidebarSectionTenants.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // NavigationItems -> NavigationItems (Self relation)
  db.NavigationItems.hasMany(db.NavigationItems, {
    foreignKey: "parent_item_id",
    sourceKey: "navigation_item_id",
    as: "children",
    constraints: false,
  });
  db.NavigationItems.belongsTo(db.NavigationItems, {
    foreignKey: "parent_item_id",
    targetKey: "navigation_item_id",
    as: "parent",
    constraints: false,
  });

  // ========================================
  // CONTACT RELATIONSHIPS
  // ========================================

  // Contacts → Leads (One-to-Many)
  db.Contacts.hasMany(db.Leads, {
    foreignKey: "contact_id",
    sourceKey: "contact_id",
    as: "leads",
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

  db.WhatsappCampaigns.hasMany(db.CampaignEvents, {
    foreignKey: "campaign_id",
    sourceKey: "campaign_id",
    as: "events",
    constraints: false,
  });
  db.CampaignEvents.belongsTo(db.WhatsappCampaigns, {
    foreignKey: "campaign_id",
    targetKey: "campaign_id",
    as: "campaign",
    constraints: false,
  });
  db.WhatsappCampaignRecipients.hasMany(db.CampaignEvents, {
    foreignKey: "recipient_id",
    sourceKey: "id",
    as: "events",
    constraints: false,
  });
  db.CampaignEvents.belongsTo(db.WhatsappCampaignRecipients, {
    foreignKey: "recipient_id",
    targetKey: "id",
    as: "recipient",
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

  // Doctor ↔ Branches (Many-to-Many via DoctorBranches)
  db.Doctors.belongsToMany(db.Branches, {
    through: db.DoctorBranches,
    foreignKey: "doctor_id",
    otherKey: "branch_id",
    sourceKey: "doctor_id",
    targetKey: "branch_id",
    as: "branches",
    constraints: false,
  });
  db.Branches.belongsToMany(db.Doctors, {
    through: db.DoctorBranches,
    foreignKey: "branch_id",
    otherKey: "doctor_id",
    sourceKey: "branch_id",
    targetKey: "doctor_id",
    as: "doctors",
    constraints: false,
  });

  // Helper direct associations for mapping
  db.Doctors.hasMany(db.DoctorBranches, {
    foreignKey: "doctor_id",
    sourceKey: "doctor_id",
    as: "branchMappings",
    constraints: false,
  });
  db.DoctorBranches.belongsTo(db.Doctors, {
    foreignKey: "doctor_id",
    targetKey: "doctor_id",
    as: "doctor",
    constraints: false,
  });

  db.Branches.hasMany(db.DoctorBranches, {
    foreignKey: "branch_id",
    sourceKey: "branch_id",
    as: "doctorMappings",
    constraints: false,
  });
  db.DoctorBranches.belongsTo(db.Branches, {
    foreignKey: "branch_id",
    targetKey: "branch_id",
    as: "branch",
    constraints: false,
  });

  // Lead → Appointments (One-to-Many)
  db.Leads.hasMany(db.Appointments, {
    foreignKey: "lead_id",
    sourceKey: "lead_id",
    as: "appointments",
    constraints: false,
  });
  db.Appointments.belongsTo(db.Leads, {
    foreignKey: "lead_id",
    targetKey: "lead_id",
    as: "lead",
    constraints: false,
  });

  // Appointment -> Outcome (One-to-One: unique index on appointment_id enforces one outcome per appointment)
  db.Appointments.hasOne(db.AppointmentOutcomes, {
    foreignKey: "appointment_id",
    sourceKey: "appointment_id",
    as: "outcome",
    constraints: false,
  });
  db.AppointmentOutcomes.belongsTo(db.Appointments, {
    foreignKey: "appointment_id",
    targetKey: "appointment_id",
    as: "appointment",
    constraints: false,
  });

  // Appointment -> ScheduledMessages (One-to-Many)
  db.Appointments.hasMany(db.ScheduledMessages, {
    foreignKey: "appointment_id",
    sourceKey: "appointment_id",
    as: "scheduledMessages",
    constraints: false,
  });
  db.ScheduledMessages.belongsTo(db.Appointments, {
    foreignKey: "appointment_id",
    targetKey: "appointment_id",
    as: "appointment",
    constraints: false,
  });

  // ScheduledMessages -> Contact (Belongs-to)
  db.ScheduledMessages.belongsTo(db.Contacts, {
    foreignKey: "contact_id",
    targetKey: "contact_id",
    as: "contact",
    constraints: false,
  });

  // ScheduledMessages -> WhatsappTemplate (Belongs-to via business key)
  db.ScheduledMessages.belongsTo(db.WhatsappTemplates, {
    foreignKey: "template_id",
    targetKey: "template_id",
    as: "template",
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

  // AiTokenUsage → BillingLedger (One-to-One)
  db.AiTokenUsage.hasOne(db.BillingLedger, {
    foreignKey: "ai_token_usage_id",
    sourceKey: "id",
    as: "billingLedger",
    constraints: false,
  });
  db.BillingLedger.belongsTo(db.AiTokenUsage, {
    foreignKey: "ai_token_usage_id",
    targetKey: "id",
    as: "aiTokenUsage",
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

  // ========================================
  // MEDIA ASSET RELATIONSHIPS
  // ========================================

  // Tenant → MediaAsset (One-to-Many)
  db.Tenants.hasMany(db.MediaAsset, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "mediaAssets",
    constraints: false,
  });
  db.MediaAsset.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // TenantUser → MediaAsset (One-to-Many)
  db.TenantUsers.hasMany(db.MediaAsset, {
    foreignKey: "uploaded_by",
    sourceKey: "tenant_user_id",
    as: "uploadedMedia",
    constraints: false,
  });
  db.MediaAsset.belongsTo(db.TenantUsers, {
    foreignKey: "uploaded_by",
    targetKey: "tenant_user_id",
    as: "uploader",
    constraints: false,
  });

  // WhatsappTemplate → MediaAsset (Belongs-to)
  db.WhatsappTemplates.belongsTo(db.MediaAsset, {
    foreignKey: "media_asset_id",
    targetKey: "media_asset_id",
    as: "mediaAsset",
    constraints: false,
  });
  db.MediaAsset.hasMany(db.WhatsappTemplates, {
    foreignKey: "media_asset_id",
    sourceKey: "media_asset_id",
    as: "templates",
    constraints: false,
  });

  // WhatsappCampaign → MediaAsset (Belongs-to)
  db.WhatsappCampaigns.belongsTo(db.MediaAsset, {
    foreignKey: "media_asset_id",
    targetKey: "media_asset_id",
    as: "mediaAsset",
    constraints: false,
  });
  db.MediaAsset.hasMany(db.WhatsappCampaigns, {
    foreignKey: "media_asset_id",
    sourceKey: "media_asset_id",
    as: "campaigns",
    constraints: false,
  });

  // ========================================
  // APPOINTMENT MODULE RELATIONSHIPS
  // ========================================

  // Appointment → Doctor (Many-to-One)
  db.Appointments.belongsTo(db.Doctors, {
    foreignKey: "doctor_id",
    targetKey: "doctor_id",
    as: "doctor",
    constraints: false,
  });
  db.Doctors.hasMany(db.Appointments, {
    foreignKey: "doctor_id",
    sourceKey: "doctor_id",
    as: "appointments",
    constraints: false,
  });

  // Appointment → Contact (Many-to-One)
  db.Appointments.belongsTo(db.Contacts, {
    foreignKey: "contact_id",
    targetKey: "contact_id",
    as: "contact",
    constraints: false,
  });
  db.Contacts.hasMany(db.Appointments, {
    foreignKey: "contact_id",
    sourceKey: "contact_id",
    as: "appointments",
    constraints: false,
  });

  // BookingSession → Contact (Many-to-One)
  db.BookingSessions.belongsTo(db.Contacts, {
    foreignKey: "contact_id",
    targetKey: "contact_id",
    as: "contact",
    constraints: false,
  });

  // ========================================
  // BILLING CYCLES RELATIONSHIPS
  // ========================================

  // Tenant → BillingCycles (One-to-Many)
  db.Tenants.hasMany(db.BillingCycles, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "billingCycles",
    constraints: false,
  });
  db.BillingCycles.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // BillingCycles → BillingLedger (One-to-Many)
  db.BillingCycles.hasMany(db.BillingLedger, {
    foreignKey: "billing_cycle_id",
    sourceKey: "id",
    as: "ledgerEntries",
    constraints: false,
  });
  db.BillingLedger.belongsTo(db.BillingCycles, {
    foreignKey: "billing_cycle_id",
    targetKey: "id",
    as: "billingCycle",
    constraints: false,
  });

  // BillingCycles → AiTokenUsage (One-to-Many)
  db.BillingCycles.hasMany(db.AiTokenUsage, {
    foreignKey: "billing_cycle_id",
    sourceKey: "id",
    as: "aiTokenUsages",
    constraints: false,
  });
  db.AiTokenUsage.belongsTo(db.BillingCycles, {
    foreignKey: "billing_cycle_id",
    targetKey: "id",
    as: "billingCycle",
    constraints: false,
  });

  // ========================================
  // COURSES & MENTORS RELATIONSHIPS
  // ========================================

  // Tenant → Mentors (One-to-Many)
  db.Tenants.hasMany(db.Mentors, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "mentors",
    constraints: false,
  });
  db.Mentors.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Tenant → Courses (One-to-Many)
  db.Tenants.hasMany(db.Courses, {
    foreignKey: "tenant_id",
    sourceKey: "tenant_id",
    as: "tenantCourses",
    constraints: false,
  });
  db.Courses.belongsTo(db.Tenants, {
    foreignKey: "tenant_id",
    targetKey: "tenant_id",
    as: "tenant",
    constraints: false,
  });

  // Mentor → Courses (One-to-Many)
  db.Mentors.hasMany(db.Courses, {
    foreignKey: "mentor_id",
    sourceKey: "mentor_id",
    as: "courses",
    constraints: false,
  });
  db.Courses.belongsTo(db.Mentors, {
    foreignKey: "mentor_id",
    targetKey: "mentor_id",
    as: "Mentor",
    constraints: false,
  });

  return db;
};
