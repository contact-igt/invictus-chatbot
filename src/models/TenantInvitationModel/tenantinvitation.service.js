import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import handlebars from "handlebars";
import { fileURLToPath } from "url";
import { generateInviteToken } from "../../middlewares/auth/authMiddlewares.js";
import { generateReadableIdFromLast } from "../../utils/generateReadableIdFromLast.js";
import { sendEmail } from "../../utils/emailService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const createTenantInvitationService = async (
  invitation_id,
  tenant_id,
  tenant_user_id,
  email,
  token_hash,
  invited_by,
) => {
  try {
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const query = `
    INSERT INTO ${tableNames.TENANT_INVITATIONS} (
      invitation_id,
      tenant_id,
      tenant_user_id,
      email,
      token_hash,
      expires_at,
      invited_at,
      invited_by
    )
    VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
  `;

    const values = [
      invitation_id,
      tenant_id,
      tenant_user_id,
      email,
      token_hash,
      expiresAt,
      invited_by,
    ];

    const [result] = await db.sequelize.query(query, {
      replacements: values,
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getInvitationByTokenHashService = async (token_hash) => {
  const query = `
    SELECT *
    FROM ${tableNames.TENANT_INVITATIONS}
    WHERE token_hash = ?
    LIMIT 1
  `;

  try {
    const [rows] = await db.sequelize.query(query, {
      replacements: [token_hash],
    });

    return rows[0];
  } catch (err) {
    throw err;
  }
};

export const updateInvitationStatusService = async (invitation_id, status) => {
  try {
    const query = `
    UPDATE ${tableNames.TENANT_INVITATIONS}
    SET status = ?, updated_at = NOW()
    WHERE invitation_id = ?
  `;

    const [result] = await db.sequelize.query(query, {
      replacements: [status, invitation_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getLastTenantInvitationService = async (tenant_user_id) => {
  const Query = `SELECT * FROM ${tableNames?.TENANT_INVITATIONS} WHERE tenant_user_id = ? ORDER BY created_at DESC LIMIT 1`;

  try {
    const values = [tenant_user_id];

    const [result] = await db.sequelize.query(Query, { replacements: values });
    return result[0];
  } catch (err) {
    throw err;
  }
};


export const sendTenantInvitationService = async (
  tenant_id,
  tenant_user_id,
  email,
  name,
  company_name,
  invited_by,
) => {
  const invitation_id = await generateReadableIdFromLast(
    tableNames.TENANT_INVITATIONS,
    "invitation_id",
    "INV",
  );

  const inviteToken = generateInviteToken({
    tenant_id,
    tenant_user_id,
    email,
  });

  const tokenHash = crypto.createHash("sha256").update(inviteToken).digest("hex");

  await createTenantInvitationService(
    invitation_id,
    tenant_id,
    tenant_user_id,
    email,
    tokenHash,
    invited_by,
  );

  const inviteUrl = `${process.env.FRONTEND_URL}/account/activate?token=${inviteToken}`;

  const templatePath = path.join(
    __dirname,
    "../../../public/html/tenantInvite/index.html",
  );

  const source = fs.readFileSync(templatePath, "utf8");
  const template = handlebars.compile(source);

  const emailHtml = template({
    name,
    company_name,
    invite_url: inviteUrl,
    expiry_hours: 48,
  });

  await sendEmail({
    to: email,
    subject: `You're invited to manage ${company_name} on WhatsNexus`,
    html: emailHtml,
  });

  return { invitation_id, inviteToken };
};
