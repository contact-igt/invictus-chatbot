import dotenv from "dotenv";

dotenv.config();

const ServerEnvironmentConfig = {
  jwt_key: process.env.JWT_SECRET_KEY,
  server: {
    line: process.env.INVICTUS_SERVER_LINE,
    live: process.env.INVICTUS_SERVER_START_LIVE,
    development: process.env.INVICTUS_SERVER_START_DEVELOPMENT,
    local: process.env.INVICTUS_SERVER_START_LOCAL,
  },
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
};

export default ServerEnvironmentConfig;

