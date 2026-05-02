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
import { MessageUnderstandingTable } from "./tables/MessageUnderstandingTable/index.js";
import { LeadScoreHistoryTable } from "./tables/LeadScoreHistoryTable/index.js";
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
import { CampaignEventsTable } from "./tables/CampaignEventsTable/index.js";
import { ContactGroupTable } from "./tables/ContactGroupTable/index.js";
import { ContactGroupMemberTable } from "./tables/ContactGroupMemberTable/index.js";
import { SequencesTable } from "./tables/SequencesTable/index.js";
import { OtpVerificationTable } from "./tables/OtpVerificationTable/index.js";
import { DoctorsTable } from "./tables/DoctorsTable/index.js";
import { DoctorAvailabilityTable } from "./tables/DoctorAvailabilityTable/index.js";
import { SpecializationsTable } from "./tables/SpecializationsTable/index.js";
import { DoctorSpecializationsTable } from "./tables/DoctorSpecializationsTable/index.js";
import { PricingTable } from "./tables/PricingTableTable/index.js";
import { MessageUsageTable } from "./tables/MessageUsageTable/index.js";
import { BillingLedgerTable } from "./tables/BillingLedgerTable/index.js";
import { WalletTable } from "./tables/WalletTable/index.js";
import { WalletTransactionTable } from "./tables/WalletTransactionTable/index.js";
import { AiTokenUsageTable } from "./tables/AiTokenUsageTable/index.js";
import { AiPricingTable } from "./tables/AiPricingTable/index.js";
import { PaymentHistoryTable } from "./tables/PaymentHistoryTable/index.js";
import { BookingSessionTable } from "./tables/BookingSessionTable/index.js";
import { BillingCycleTable } from "./tables/BillingCycleTable/index.js";
import { MonthlyInvoiceTable } from "./tables/MonthlyInvoiceTable/index.js";
import { AdminAuditLogTable } from "./tables/AdminAuditLogTable/index.js";
import { CurrencyRateTable } from "./tables/CurrencyRateTable/index.js";
import { BillingSystemHealthTable } from "./tables/BillingSystemHealthTable/index.js";
import { DailyUsageSummaryTable } from "./tables/DailyUsageSummaryTable/index.js";
import { MonthlyUsageSummaryTable } from "./tables/MonthlyUsageSummaryTable/index.js";
import { CronExecutionLogTable } from "./tables/CronExecutionLogTable/index.js";
import { FaqReviewsTable } from "./tables/FaqTable/index.js";
import { FaqKnowledgeSourceTable } from "./tables/FaqKnowledgeSourceTable/index.js";
import { defineAssociations } from "./associations.js";
import { MediaAssetTable } from "./tables/MediaAssetTable/index.js";
import { AppointmentTable } from "./tables/AppointmentTable/index.js";
import { SavedPaymentMethodTable } from "./tables/SavedPaymentMethod/SavedPaymentMethod.js";
import { TaxSettingsTable } from "./tables/TaxSettingsTable/index.js";
import { TenantSecretsTable } from "./tables/TenantSecretsTable/index.js";
import { UserPreferencesTable } from "./tables/UserPreferencesTable/index.js";

const dbconfig =
  ServerEnvironmentConfig?.server?.line === "production"
    ? DatabaseEnvironmentConfig?.live
    : ServerEnvironmentConfig?.server?.line === "development"
      ? DatabaseEnvironmentConfig?.development
      : ServerEnvironmentConfig?.server?.line === "stage"
        ? DatabaseEnvironmentConfig?.stage
        : DatabaseEnvironmentConfig?.local;

const sequelize = new Sequelize(
  dbconfig?.database,
  dbconfig?.user,
  dbconfig?.password,
  {
    host: dbconfig?.host,
    port: dbconfig?.port ?? 3306,
    dialect: "mysql",
    timezone: "+05:30",

    dialectOptions: {
      charset: "utf8mb4",
      connectTimeout: 60000,
    },

    pool: {
      max: 10,
      min: 0,
      acquire: 60000,
      idle: 10000,
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
db.CampaignEvents = CampaignEventsTable(sequelize, Sequelize);

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
db.MessageUnderstanding = MessageUnderstandingTable(sequelize, Sequelize);
db.LeadScoreHistory = LeadScoreHistoryTable(sequelize, Sequelize);
db.LiveChat = LiveChatTable(sequelize, Sequelize);
db.Sequences = SequencesTable(sequelize, Sequelize);
db.OtpVerification = OtpVerificationTable(sequelize, Sequelize);
db.Doctors = DoctorsTable(sequelize, Sequelize);
db.DoctorAvailability = DoctorAvailabilityTable(sequelize, Sequelize);
db.Specializations = SpecializationsTable(sequelize, Sequelize);
db.DoctorSpecializations = DoctorSpecializationsTable(sequelize, Sequelize);
db.PricingTable = PricingTable(sequelize, Sequelize);
db.MessageUsage = MessageUsageTable(sequelize, Sequelize);
db.BillingLedger = BillingLedgerTable(sequelize, Sequelize);
db.Wallets = WalletTable(sequelize, Sequelize);
db.WalletTransactions = WalletTransactionTable(sequelize, Sequelize);
db.AiTokenUsage = AiTokenUsageTable(sequelize, Sequelize);
db.AiPricing = AiPricingTable(sequelize, Sequelize);
db.PaymentHistory = PaymentHistoryTable(sequelize, Sequelize);
db.BillingCycles = BillingCycleTable(sequelize, Sequelize);
db.MonthlyInvoices = MonthlyInvoiceTable(sequelize, Sequelize);
db.AdminAuditLog = AdminAuditLogTable(sequelize, Sequelize);
db.CurrencyRates = CurrencyRateTable(sequelize, Sequelize);
db.BillingSystemHealth = BillingSystemHealthTable(sequelize, Sequelize);
db.DailyUsageSummary = DailyUsageSummaryTable(sequelize, Sequelize);
db.MonthlyUsageSummary = MonthlyUsageSummaryTable(sequelize, Sequelize);
db.CronExecutionLog = CronExecutionLogTable(sequelize, Sequelize);
db.FaqReviews = FaqReviewsTable(sequelize, Sequelize);
db.FaqKnowledgeSource = FaqKnowledgeSourceTable(sequelize, Sequelize);
db.MediaAsset = MediaAssetTable(sequelize, Sequelize);
db.Appointments = AppointmentTable(sequelize, Sequelize);
db.BookingSessions = BookingSessionTable(sequelize, Sequelize); // NEW
db.SavedPaymentMethod = SavedPaymentMethodTable(sequelize, Sequelize);
db.TaxSettings = TaxSettingsTable(sequelize, Sequelize);
db.TenantSecrets = TenantSecretsTable(sequelize, Sequelize);
db.UserPreferences = UserPreferencesTable(sequelize, Sequelize);

defineAssociations(db);

export default db;
