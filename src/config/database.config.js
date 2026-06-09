import dotenv from "dotenv";

dotenv.config();

const DatabaseEnvironmentConfig = {
  live: {
    host: process.env.DATABASE_PRO_HOST,
    port: parseInt(process.env.DATABASE_PRO_PORT) || 3306,
    user: process.env.DATABASE_PRO_USER,
    password: process.env.DATABASE_PRO_PASSWORD,
    database: process.env.DATABASE_PRO_DB,
  },

  development: {
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT) || 3306,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_DB,
  },

  local: {
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT) || 3306,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_DB,
  },

  stage: {
    host: process.env.DATABASE_STAGE_HOST,
    port: parseInt(process.env.DATABASE_STAGE_PORT) || 3306,
    user: process.env.DATABASE_STAGE_USER,
    password: process.env.DATABASE_STAGE_PASSWORD,
    database: process.env.DATABASE_STAGE_DB,
  },
};

export default DatabaseEnvironmentConfig;
