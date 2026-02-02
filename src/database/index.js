import Sequelize from "sequelize";
import DatabaseEnvironmentConfig from "../config/database.config.js";
import ServerEnvironmentConfig from "../config/server.config.js";
import { MessagesTable } from "./tables/MessagesTable/index.js";
import { KnowledgeSourcesTable } from "./tables/KnowledgeSourceTable/index.js";
import { KnowledgeChunksTable } from "./tables/KnowledgeChunksTable/index.js";
import { AiPromptTable } from "./tables/AiPropmtTable/index.js";
import { ManagementTable } from "./tables/ManagementTable/index.js";
import { ProcessedMessagesTable } from "./tables/ProcessedMessagesTable/index.js";
import { ChatLocksTable } from "./tables/ChatLocksTable/index.js";
import { TenantsTable } from "./tables/TenantsTable/index.js";
import { LeadsTable } from "./tables/LeadsTable/index.js";
import { ContactsTable } from "./tables/ContactsTable/index.js";
import { LiveChatTable } from "./tables/LiveChatTable/index.js";
import { TenantUsersTable } from "./tables/TenantUsersTable/index.js";
import { TenantInvitationsTable } from "./tables/TenantInvitationsTable/index.js";
import { WhatsappTemplateTable } from "./tables/WhatsappTemplateTable/index.js";
import { WhatsappTemplateComponentTable } from "./tables/WhatsappTemplateComponentTable/index.js";
import { WhatsappTemplateVariableTable } from "./tables/WhatsappTemplateVariablesTable/index.js";
import { WhatsappTemplateSyncLogTable } from "./tables/WhatsappTemplateSyncLogsTable/index.js";
import { WhatsappAccountTable } from "./tables/WhatsappAccountTable/index.js";
import { WhatsappCampaignTable } from "./tables/WhatsappCampaignTable/index.js";
import { WhatsappCampaignRecipientTable } from "./tables/WhatsappCampaignRecipientTable/index.js";
import { SequencesTable } from "./tables/SequencesTable/index.js";


const dbconfig =
  ServerEnvironmentConfig?.server?.line === "production"
    ? DatabaseEnvironmentConfig?.live
    : ServerEnvironmentConfig?.server?.line === "development"
      ? DatabaseEnvironmentConfig?.development
      : DatabaseEnvironmentConfig?.local;

const sequelize = new Sequelize(
  dbconfig?.databse,
  dbconfig?.user,
  dbconfig?.password,
  {
    host: dbconfig?.host,
    dialect: "mysql",
    timezone: "+05:30",

    dialectOptions: {
      charset: "utf8mb4",
    },

    define: {
      charset: "utf8mb4",
      collate: "utf8mb4_unicode_ci",
    },

    // logging: false,
  },
);

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.Management = ManagementTable(sequelize, Sequelize);
db.Tenants = TenantsTable(sequelize, Sequelize);
db.TenantUsers = TenantUsersTable(sequelize, Sequelize);
db.TenantInvitations = TenantInvitationsTable(sequelize, Sequelize);
db.WhatsappTemplates = WhatsappTemplateTable(sequelize, Sequelize);
db.WhatsappTemplateComponents = WhatsappTemplateComponentTable(
  sequelize,
  Sequelize,
);
db.WhatsappTemplateVariables = WhatsappTemplateVariableTable(
  sequelize,
  Sequelize,
);
db.WhatsappTemplateSyncLogs = WhatsappTemplateSyncLogTable(
  sequelize,
  Sequelize,
);

db.WhatsappCampaigns = WhatsappCampaignTable(sequelize, Sequelize);
db.WhatsappCampaignRecipients = WhatsappCampaignRecipientTable(
  sequelize,
  Sequelize,
);

db.Whatsappaccount = WhatsappAccountTable(sequelize, Sequelize);
db.KnowledgeSources = KnowledgeSourcesTable(sequelize, Sequelize);
db.KnowledgeChunks = KnowledgeChunksTable(sequelize, Sequelize);
db.AiPrompt = AiPromptTable(sequelize, Sequelize);
db.Contacts = ContactsTable(sequelize, Sequelize);
db.Messages = MessagesTable(sequelize, Sequelize);
db.ProcessedMessage = ProcessedMessagesTable(sequelize, Sequelize);
db.ChatLocks = ChatLocksTable(sequelize, Sequelize);
db.Leads = LeadsTable(sequelize, Sequelize);
db.LiveChat = LiveChatTable(sequelize, Sequelize);
db.Sequences = SequencesTable(sequelize, Sequelize);

// ========================================
// ASSOCIATIONS
// ========================================
// NOTE: Using constraints: false to prevent FK creation
// This allows associations for eager loading without requiring matching column types in DB

// Tenant → TenantUsers (One-to-Many)
db.Tenants.hasMany(db.TenantUsers, {
  foreignKey: "tenant_id",
  sourceKey: "tenant_id",
  as: "users",
  constraints: false
});
db.TenantUsers.belongsTo(db.Tenants, {
  foreignKey: "tenant_id",
  targetKey: "tenant_id",
  as: "tenant",
  constraints: false
});

// Tenant → TenantInvitations (One-to-Many)
db.Tenants.hasMany(db.TenantInvitations, {
  foreignKey: "tenant_id",
  sourceKey: "tenant_id",
  as: "invitations",
  constraints: false
});
db.TenantInvitations.belongsTo(db.Tenants, {
  foreignKey: "tenant_id",
  targetKey: "tenant_id",
  as: "tenant",
  constraints: false
});

// Tenant → WhatsappAccount (One-to-One)
db.Tenants.hasOne(db.Whatsappaccount, {
  foreignKey: "tenant_id",
  sourceKey: "tenant_id",
  as: "whatsappAccount",
  constraints: false
});
db.Whatsappaccount.belongsTo(db.Tenants, {
  foreignKey: "tenant_id",
  targetKey: "tenant_id",
  as: "tenant",
  constraints: false
});

// Tenant → Contacts (One-to-Many)
db.Tenants.hasMany(db.Contacts, {
  foreignKey: "tenant_id",
  sourceKey: "tenant_id",
  as: "contacts",
  constraints: false
});
db.Contacts.belongsTo(db.Tenants, {
  foreignKey: "tenant_id",
  targetKey: "tenant_id",
  as: "tenant",
  constraints: false
});

// Contacts → Leads (One-to-One)
db.Contacts.hasOne(db.Leads, {
  foreignKey: "contact_id",
  sourceKey: "id",
  as: "lead",
  constraints: false
});
db.Leads.belongsTo(db.Contacts, {
  foreignKey: "contact_id",
  targetKey: "id",
  as: "contact",
  constraints: false
});

// Contacts → Messages (One-to-Many)
db.Contacts.hasMany(db.Messages, {
  foreignKey: "contact_id",
  sourceKey: "id",
  as: "messages",
  constraints: false
});
db.Messages.belongsTo(db.Contacts, {
  foreignKey: "contact_id",
  targetKey: "id",
  as: "contact",
  constraints: false
});

// Contacts → LiveChat (One-to-One)
db.Contacts.hasOne(db.LiveChat, {
  foreignKey: "contact_id",
  sourceKey: "id",
  as: "liveChat",
  constraints: false
});
db.LiveChat.belongsTo(db.Contacts, {
  foreignKey: "contact_id",
  targetKey: "id",
  as: "contact",
  constraints: false
});

// KnowledgeSources → KnowledgeChunks (One-to-Many)
db.KnowledgeSources.hasMany(db.KnowledgeChunks, {
  foreignKey: "source_id",
  sourceKey: "id",
  as: "chunks",
  constraints: false
});
db.KnowledgeChunks.belongsTo(db.KnowledgeSources, {
  foreignKey: "source_id",
  targetKey: "id",
  as: "source",
  constraints: false
});

// WhatsappTemplate → WhatsappTemplateComponents (One-to-Many)
db.WhatsappTemplates.hasMany(db.WhatsappTemplateComponents, {
  foreignKey: "template_id",
  sourceKey: "template_id",
  as: "components",
  constraints: false
});
db.WhatsappTemplateComponents.belongsTo(db.WhatsappTemplates, {
  foreignKey: "template_id",
  targetKey: "template_id",
  as: "template",
  constraints: false
});

// WhatsappTemplate → WhatsappTemplateVariables (One-to-Many)
db.WhatsappTemplates.hasMany(db.WhatsappTemplateVariables, {
  foreignKey: "template_id",
  sourceKey: "template_id",
  as: "variables",
  constraints: false
});
db.WhatsappTemplateVariables.belongsTo(db.WhatsappTemplates, {
  foreignKey: "template_id",
  targetKey: "template_id",
  as: "template",
  constraints: false
});

// WhatsappTemplate → WhatsappTemplateSyncLogs (One-to-Many)
db.WhatsappTemplates.hasMany(db.WhatsappTemplateSyncLogs, {
  foreignKey: "template_id",
  sourceKey: "template_id",
  as: "syncLogs",
  constraints: false
});
db.WhatsappTemplateSyncLogs.belongsTo(db.WhatsappTemplates, {
  foreignKey: "template_id",
  targetKey: "template_id",
  as: "template",
  constraints: false
});

// Tenant → WhatsappTemplates (One-to-Many)
db.Tenants.hasMany(db.WhatsappTemplates, {
  foreignKey: "tenant_id",
  sourceKey: "tenant_id",
  as: "templates",
  constraints: false
});
db.WhatsappTemplates.belongsTo(db.Tenants, {
  foreignKey: "tenant_id",
  targetKey: "tenant_id",
  as: "tenant",
  constraints: false
});

// Tenant → KnowledgeSources (One-to-Many)
db.Tenants.hasMany(db.KnowledgeSources, {
  foreignKey: "tenant_id",
  sourceKey: "tenant_id",
  as: "knowledgeSources",
  constraints: false
});
db.KnowledgeSources.belongsTo(db.Tenants, {
  foreignKey: "tenant_id",
  targetKey: "tenant_id",
  as: "tenant",
  constraints: false
});

// Tenant → AiPrompt (One-to-Many)
db.Tenants.hasMany(db.AiPrompt, {
  foreignKey: "tenant_id",
  sourceKey: "tenant_id",
  as: "aiPrompts",
  constraints: false
});
db.AiPrompt.belongsTo(db.Tenants, {
  foreignKey: "tenant_id",
  targetKey: "tenant_id",
  as: "tenant",
  constraints: false
});

// Tenant → Leads (One-to-Many)
db.Tenants.hasMany(db.Leads, {
  foreignKey: "tenant_id",
  sourceKey: "tenant_id",
  as: "leads",
  constraints: false
});
db.Leads.belongsTo(db.Tenants, {
  foreignKey: "tenant_id",
  targetKey: "tenant_id",
  as: "tenant",
  constraints: false
});

// Tenant → Messages (One-to-Many)
db.Tenants.hasMany(db.Messages, {
  foreignKey: "tenant_id",
  sourceKey: "tenant_id",
  as: "messages",
  constraints: false
});
db.Messages.belongsTo(db.Tenants, {
  foreignKey: "tenant_id",
  targetKey: "tenant_id",
  as: "tenant",
  constraints: false
});

// Tenant → LiveChat (One-to-Many)
db.Tenants.hasMany(db.LiveChat, {
  foreignKey: "tenant_id",
  sourceKey: "tenant_id",
  as: "liveChats",
  constraints: false
});
db.LiveChat.belongsTo(db.Tenants, {
  foreignKey: "tenant_id",
  targetKey: "tenant_id",
  as: "tenant",
  constraints: false
});

// Tenant -> WhatsappCampaigns (One-to-Many)
db.Tenants.hasMany(db.WhatsappCampaigns, {
  foreignKey: "tenant_id",
  sourceKey: "tenant_id",
  as: "campaigns",
  constraints: false
});
db.WhatsappCampaigns.belongsTo(db.Tenants, {
  foreignKey: "tenant_id",
  targetKey: "tenant_id",
  as: "tenant",
  constraints: false
});

// WhatsappCampaign -> WhatsappCampaignRecipients (One-to-Many)
db.WhatsappCampaigns.hasMany(db.WhatsappCampaignRecipients, {
  foreignKey: "campaign_id",
  sourceKey: "campaign_id",
  as: "recipients",
  constraints: false
});
db.WhatsappCampaignRecipients.belongsTo(db.WhatsappCampaigns, {
  foreignKey: "campaign_id",
  targetKey: "campaign_id",
  as: "campaign",
  constraints: false
});

// WhatsappCampaign -> WhatsappTemplate (Belongs-to)
db.WhatsappCampaigns.belongsTo(db.WhatsappTemplates, {
  foreignKey: "template_id",
  targetKey: "template_id",
  as: "template",
  constraints: false
});

export default db;


