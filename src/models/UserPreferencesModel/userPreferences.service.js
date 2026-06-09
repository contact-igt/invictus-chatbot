import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const getUserPreferencesService = async (
  user_id,
  user_type = "tenant",
) => {
  const idColumn =
    user_type === "management" ? "management_id" : "tenant_user_id";

  const result = await db.sequelize.query(
    `SELECT theme FROM ${tableNames.USER_PREFERENCES} WHERE ${idColumn} = ? LIMIT 1`,
    { replacements: [user_id], type: db.Sequelize.QueryTypes.SELECT }
  );
  return result[0] || null;
};

export const upsertUserPreferencesService = async (
  user_id,
  tenant_id,
  preferences,
  user_type = "tenant",
) => {
  const theme = preferences?.theme || "light";
  const idColumn =
    user_type === "management" ? "management_id" : "tenant_user_id";
  const otherIdColumn =
    user_type === "management" ? "tenant_user_id" : "management_id";

  await db.sequelize.query(
    `INSERT INTO ${tableNames.USER_PREFERENCES} (${idColumn}, ${otherIdColumn}, user_type, tenant_id, theme, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE user_type = VALUES(user_type), tenant_id = VALUES(tenant_id), theme = VALUES(theme), updated_at = NOW()`,
    { replacements: [user_id, user_type, tenant_id ?? null, theme] }
  );
};
