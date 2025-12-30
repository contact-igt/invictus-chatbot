import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const searchKnowledgeChunks = async (question) => {
  if (!question) return [];

  // Normalize question
  const keywords = question
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(" ")
    .filter(w => w.length > 2);

  if (!keywords.length) return [];

  const conditions = keywords.map(() => "chunk_text LIKE ?").join(" OR ");
  const values = keywords.map(k => `%${k}%`);

  const [rows] = await db.sequelize.query(
    `
    SELECT chunk_text
    FROM ${tableNames.KNOWLEDGECHUNKS}
    WHERE ${conditions}
    LIMIT 5
    `,
    { replacements: values }
  );

  return rows.map(r => r.chunk_text);
};
