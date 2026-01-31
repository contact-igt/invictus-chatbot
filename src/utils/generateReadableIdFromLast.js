import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";

export const generateReadableIdFromLast = async (
  tableName,
  field,
  prefix,
  pad = 3,
) => {
  const transaction = await db.sequelize.transaction();

  try {
    // 1. Try to find the sequence record and lock it
    const sequenceName = tableName; // Use table name as sequence identifier

    const sequence = await db.Sequences.findOne({
      where: { name: sequenceName },
      lock: true,
      transaction,
    });

    let nextNumber = 1;

    if (sequence) {
      // 2. If sequence exists, increment it
      nextNumber = sequence.value + 1;
      await sequence.update({ value: nextNumber }, { transaction });
    } else {
      // 3. If sequence doesn't exist, initialize it from existing table data (Migration path)
      const [rows] = await db.sequelize.query(
        `SELECT ${field} FROM ${tableName} ORDER BY id DESC LIMIT 1`,
        { transaction },
      );

      if (rows.length > 0 && rows[0][field]) {
        // Extract number from existing ID (e.g., "MG005" -> 5)
        const lastId = rows[0][field];
        // Handle cases where prefix might be different or complex
        // Assuming format is PREFIX + Number
        const numericPart = lastId.replace(prefix, "");
        const lastNumber = parseInt(numericPart, 10);

        if (!isNaN(lastNumber)) {
          nextNumber = lastNumber + 1;
        }
      }

      // Create new sequence record
      await db.Sequences.create(
        {
          name: sequenceName,
          value: nextNumber,
          prefix: prefix,
        },
        { transaction },
      );
    }

    await transaction.commit();

    // 4. Format and return the ID
    const paddedNumber = String(nextNumber).padStart(pad, "0");
    return `${prefix}${paddedNumber}`;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
