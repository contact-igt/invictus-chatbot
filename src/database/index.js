import Sequelize from "sequelize";
import DatabaseEnvironmentConfig from "../config/database.config.js";
import ServerEnvironmentConfig from "../config/server.config.js";
import { MessagesTable } from "./tables/MessagesTable/index.js";
import { KnowledgeSourcesTable } from "./tables/KnowledgeSourceTable/index.js";
import { KnowledgeChunksTable } from "./tables/KnowledgeChunksTable/index.js";
import { AiPromptTable } from "./tables/AiPromptTable/index.js";
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
import { ContactGroupTable } from "./tables/ContactGroupTable/index.js";
import { ContactGroupMemberTable } from "./tables/ContactGroupMemberTable/index.js";
import { SequencesTable } from "./tables/SequencesTable/index.js";
import { AiAnalysisLogTable } from "./tables/AiAnalysisLogTable/index.js";
import { OtpVerificationTable } from "./tables/OtpVerificationTable/index.js";
import { DoctorsTable } from "./tables/DoctorsTable/index.js";
import { DoctorAvailabilityTable } from "./tables/DoctorAvailabilityTable/index.js";
import { SpecializationsTable } from "./tables/SpecializationsTable/index.js";
import { DoctorSpecializationsTable } from "./tables/DoctorSpecializationsTable/index.js";
import { AppointmentTable } from "./tables/AppointmentTable/index.js";
import { PricingTable } from "./tables/PricingTableTable/index.js";
import { MessageUsageTable } from "./tables/MessageUsageTable/index.js";
import { BillingLedgerTable } from "./tables/BillingLedgerTable/index.js";

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
db.ContactGroups = ContactGroupTable(sequelize, Sequelize);
db.ContactGroupMembers = ContactGroupMemberTable(sequelize, Sequelize);
db.Messages = MessagesTable(sequelize, Sequelize);
db.ProcessedMessage = ProcessedMessagesTable(sequelize, Sequelize);
db.ChatLocks = ChatLocksTable(sequelize, Sequelize);
db.Leads = LeadsTable(sequelize, Sequelize);
db.LiveChat = LiveChatTable(sequelize, Sequelize);
db.Sequences = SequencesTable(sequelize, Sequelize);
db.AiAnalysisLog = AiAnalysisLogTable(sequelize, Sequelize);
db.OtpVerification = OtpVerificationTable(sequelize, Sequelize);
db.Doctors = DoctorsTable(sequelize, Sequelize);
db.DoctorAvailability = DoctorAvailabilityTable(sequelize, Sequelize);
db.Specializations = SpecializationsTable(sequelize, Sequelize);
db.DoctorSpecializations = DoctorSpecializationsTable(sequelize, Sequelize);
db.Appointments = AppointmentTable(sequelize, Sequelize);
db.PricingTable = PricingTable(sequelize, Sequelize);
db.MessageUsage = MessageUsageTable(sequelize, Sequelize);
db.BillingLedger = BillingLedgerTable(sequelize, Sequelize);

// ========================================
// IMPORT AND DEFINE ASSOCIATIONS
// ========================================
import { defineAssociations } from "./associations.js";
defineAssociations(db);

export default db;



