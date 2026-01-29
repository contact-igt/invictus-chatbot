import db from "../database/index.js";

export const generateReadableIdFromLast = async (
  tableName,
  field,
  prefix,
  pad = 3,
) => {
  const [rows] = await db.sequelize.query(
    `SELECT ${field} FROM ${tableName} ORDER BY id DESC LIMIT 1`,
  );

  let nextNumber = 1;

  if (rows.length > 0 && rows[0][field]) {
    const lastNumber = parseInt(rows[0][field].replace(prefix, ""), 10);
    nextNumber = lastNumber + 1;
  }

  const paddedNumber = String(nextNumber).padStart(pad, "0");
  return `${prefix}${paddedNumber}`;
};
