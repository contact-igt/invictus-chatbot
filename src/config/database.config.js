import dotenv from "dotenv";

dotenv.config();

const DatabaseEnvironmentConfig = {
  live: {
    host: process.env.DATABASE_PRO_HOST,
    user: process.env.DATABASE_PRO_USER,
    password: process.env.DATABASE_PRO_PASSWORD,
    databse: process.env.DATABASE_PRO_DB,
  },

  development: {
    host: process.env.DATABASE_DEV_HOST,
    user: process.env.DATABASE_DEV_USER,
    password: process.env.DATABASE_DEV_PASSWORD,
    databse: process.env.DATABASE_DEV_DB,
  },

  local: {
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    databse: process.env.DATABASE_DB,
  },
};

export default DatabaseEnvironmentConfig;
