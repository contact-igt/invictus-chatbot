import Sequelize from "sequelize";
import DatabaseEnvironmentConfig from "../config/database.config.js";
import ServerEnvironmentConfig from "../config/server.config.js";
import { whatsappAccountTable } from "./tables/WhatsappAccountTable/index.js";
import { MessagesTable } from "./tables/MessagesTable/index.js";
import { KnowledgeSourcesTable } from "./tables/KnowledgeSourceTable/index.js";
import { KnowledgeChunksTable } from "./tables/KnowledgeChunksTable/index.js";
import { AiPromptTable} from "./tables/AiPropmtTable/index.js";

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

export default db;
