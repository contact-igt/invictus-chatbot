import nodemailer from "nodemailer";
import ServerEnvironmentConfig from "../config/server.config.js";

const transporter = nodemailer.createTransport({
  service: ServerEnvironmentConfig.service,
  auth: {
    user: ServerEnvironmentConfig.auth.user,
    pass: ServerEnvironmentConfig.auth.pass,
  },
});

export default transporter;
