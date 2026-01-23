import Sequelize from "sequelize";
import DatabaseEnvironmentConfig from "../config/database.config.js";
import ServerEnvironmentConfig from "../config/server.config.js";
import { whatsappAccountTable } from "./tables/WhatsappAccountTable/index.js";
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

db.Tenants = TenantsTable(sequelize, Sequelize);
db.Whatsappaccount = whatsappAccountTable(sequelize, Sequelize);
db.Management = ManagementTable(sequelize, Sequelize);
db.KnowledgeSources = KnowledgeSourcesTable(sequelize, Sequelize);
db.KnowledgeChunks = KnowledgeChunksTable(sequelize, Sequelize);
db.AiPrompt = AiPromptTable(sequelize, Sequelize);
db.Contacts = ContactsTable(sequelize, Sequelize);
db.Messages = MessagesTable(sequelize, Sequelize);
db.ProcessedMessage = ProcessedMessagesTable(sequelize, Sequelize);
db.ChatLocks = ChatLocksTable(sequelize, Sequelize);
db.Leads = LeadsTable(sequelize, Sequelize);
db.LiveChat = LiveChatTable(sequelize, Sequelize);

export default db;
