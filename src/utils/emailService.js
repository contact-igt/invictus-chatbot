import ServerEnvironmentConfig from "../config/server.config.js";
import transporter from "./mailer.js";

export const sendEmail = async ({ to, subject, html }) => {
  if (!to || !subject || !html) {
    throw new Error("Missing email parameters");
  }

  const mailOptions = {
    from: ServerEnvironmentConfig.auth.user,
    to,
    subject,
    html,
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
};
