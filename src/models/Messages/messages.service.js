import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const createUserMessageService = async (
  wa_id,
  phone,
  sender,
  message
) => {
  const Query = `INSERT INTO ${tableNames?.MESSAGES} (wa_id , phone , sender , message ) VALUES (?,?,?,?) `;

  try {
    const values = [wa_id, phone, sender, message];

    const [result] = await db.sequelize.query(Query, { replacements: values });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getChatListService = async () => {
  try {
    const Query = ` 
  SELECT phone , message , seen , created_at 
  FROM messages as m1
  WHERE id = (
  SELECT MAX(id) FROM messages as m2
  WHERE m2.phone = m1.phone 
  ) 
  ORDER BY m1.created_at DESC
  
  `;

    const [result] = await db.sequelize.query(Query);
    return result;
  } catch (err) {
    throw err;
  }
};

export const getChatByPhoneService = async (phone) => {
  try {
    const Query = `
    SELECT sender, message, seen , created_at
    FROM  ${tableNames?.MESSAGES}
    WHERE phone = ?
    ORDER BY created_at ASC
  `;
    const [result] = await db.sequelize.query(Query, {
      replacements: [phone],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const markSeenMessageService = async (phone) => {
  const Query = `UPDATE ${tableNames?.MESSAGES} SET seen = "true" WHERE phone = ? AND seen = "false"`;
  try {
    const [result] = await db.sequelize.query(Query, { replacements: [phone] });
    return result;
  } catch (err) {
    throw err;
  }
};
