import dotenv from "dotenv";

dotenv.config();

const currentServerLine = String(process.env.INVICTUS_SERVER_LINE || "")
  .replace(/^\s*"|"\s*$/g, "")
  .trim();

const getEnvUrlForCurrentLine = (targets = {}) => {
  if (currentServerLine === "production") {
    return targets.production || targets.defaultValue || "";
  }

  if (currentServerLine === "stage") {
    return targets.stage || targets.defaultValue || "";
  }

  return targets.local || targets.development || targets.defaultValue || "";
};

const ServerEnvironmentConfig = {
  jwt_key: process.env.JWT_SECRET_KEY,
  server: {
    line: currentServerLine,
    live: process.env.INVICTUS_SERVER_START_LIVE,
    development: process.env.INVICTUS_SERVER_START_DEVELOPMENT,
    local: process.env.INVICTUS_SERVER_START_LOCAL,
    stage: process.env.INVICTUS_SERVER_START_STAGE,
  },
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  urls: {
    frontend: getEnvUrlForCurrentLine({
      production: process.env.FRONTEND_URL_PRODUCTION,
      stage: process.env.FRONTEND_URL_STAGE,
      development: process.env.FRONTEND_URL_DEVELOPMENT,
      local: process.env.FRONTEND_URL_LOCAL,
      defaultValue: process.env.FRONTEND_URL,
    }),
    backend: getEnvUrlForCurrentLine({
      production: process.env.BACKEND_URL_PRODUCTION,
      stage: process.env.BACKEND_URL_STAGE,
      development: process.env.BACKEND_URL_DEVELOPMENT,
      local: process.env.BACKEND_URL_LOCAL,
      defaultValue: process.env.BACKEND_URL,
    }),
  },
};

export default ServerEnvironmentConfig;