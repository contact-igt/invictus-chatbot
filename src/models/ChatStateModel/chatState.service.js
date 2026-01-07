import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const createChatStateService = async (name, phone) => {
  const Query = `INSERT INTO ${tableNames?.CHATSTATE} (name , phone) VALUES (?,?)`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [name, phone],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getChatStateByPhoneService = async (phone) => {
  const Query = `SELECT * FROM ${tableNames?.CHATSTATE} WHERE phone = ?`;

  try {
    const [result] = await db.sequelize.query(Query, { replacements: [phone] });
    return result;
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
