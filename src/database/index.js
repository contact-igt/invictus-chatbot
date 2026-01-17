import Sequelize from "sequelize";
import DatabaseEnvironmentConfig from "../config/database.config.js";
import ServerEnvironmentConfig from "../config/server.config.js";
import { whatsappAccountTable } from "./tables/WhatsappAccountTable/index.js";
import { MessagesTable } from "./tables/MessagesTable/index.js";
import { KnowledgeSourcesTable } from "./tables/KnowledgeSourceTable/index.js";
import { KnowledgeChunksTable } from "./tables/KnowledgeChunksTable/index.js";
import { AiPromptTable } from "./tables/AiPropmtTable/index.js";
import { ConversationsTable } from "./tables/ConversationTable/index.js";
import { ContactTable } from "./tables/ContactTable/index.js";
import { AppSettingTable } from "./tables/AppSettingsTable/index.js";
import { ManagementTable } from "./tables/ManagementTable/index.js";
import { AdminAlertTable } from "./tables/AdminAlertTable/index.js";
import { ChatStateTable } from "./tables/ChatStateTable/index.js";
import { ProcessedMessagesTable } from "./tables/ProcessedMessagesTable/index.js";
import { ChatLocksTable } from "./tables/ChatLocksTable/index.js";
import { TenantsTable } from "./tables/TenantsTable/index.js";

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
  }
);

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.Whatsappaccount = whatsappAccountTable(sequelize, Sequelize);
db.Messages = MessagesTable(sequelize, Sequelize);
db.KnowledgeSources = KnowledgeSourcesTable(sequelize, Sequelize);
db.KnowledgeChunks = KnowledgeChunksTable(sequelize, Sequelize);
db.AiPrompt = AiPromptTable(sequelize, Sequelize);
db.Conversation = ConversationsTable(sequelize, Sequelize);
db.Contact = ContactTable(sequelize, Sequelize);
db.AppSettings = AppSettingTable(sequelize, Sequelize);
db.Management = ManagementTable(sequelize, Sequelize);
db.AdminAlert = AdminAlertTable(sequelize, Sequelize);
db.ChatState = ChatStateTable(sequelize, Sequelize);
db.ProcessedMessage = ProcessedMessagesTable(sequelize , Sequelize)
db.ChatLocks = ChatLocksTable(sequelize , Sequelize)
db.Tenants = TenantsTable(sequelize , Sequelize)


export default db;


