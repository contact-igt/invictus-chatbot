import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { calculateHeatState } from "../../utils/calculateHeatState.js";
import cron from "node-cron";

export const createChatStateService = async (
  tenant_id,
  phone_number_id,
  phone,
  name,
) => {
  const Query = `INSERT INTO ${tableNames?.CHATSTATE} (tenant_id, phone_number_id, phone, name) VALUES (?,?,?,?)`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, phone_number_id, phone, name],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getChatStateByPhoneService = async (
  tenant_id,
  phone_number_id,
  phone,
) => {
  const Query = `SELECT * FROM ${tableNames?.CHATSTATE} WHERE tenant_id = ? AND phone_number_id = ? AND phone = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, phone_number_id, phone],
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const updateChatStateToNeedAdminService = async (phone) => {
  const Query = `UPDATE  ${tableNames?.CHATSTATE} SET state = ? WHERE phone = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: ["need_admin", phone],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const updateChatStateHeatOnUserMessageService = async (
  tenant_id,
  phone_number_id,
  phone,
) => {
  const { heat_state, heat_score } = calculateHeatState(new Date());
  const currentDate = new Date();

  const Query = `UPDATE ${tableNames?.CHATSTATE} SET  last_user_message_at = ? , heat_state = ?, heat_score = ? WHERE tenant_id = ? AND phone_number_id = ? AND phone = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [
        currentDate,
        heat_state,
        heat_score,
        tenant_id,
        phone_number_id,
        phone,
      ],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const startChatStateHeatDecayCronService = () => {
  cron.schedule("*/30 * * * *", async () => {
    try {
      console.log("🔥 Heat decay cron started");

      await db.sequelize.query(`
        UPDATE ${tableNames?.CHATSTATE}
        SET
          heat_state = CASE
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 4 THEN 'hot'
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 24 THEN 'warm'
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 72 THEN 'cold'
            ELSE 'super_cold'
          END,
          heat_score = CASE
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 4 THEN 90
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 24 THEN 60
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 72 THEN 30
            ELSE 10
          END
    `);

      console.log("✅ Heat decay cron finished");
    } catch (err) {
      console.error("❌ Heat decay cron error:", err.message);
      throw err;
    }
  });
};

export const getChatStateListService = async (tenant_id) => {
  const Query = `SELECT * FROM ${tableNames?.CHATSTATE} WHERE tenant_id IN (?) ORDER BY id DESC`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};
