import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const searchKnowledgeChunks = async (tenant_id, question) => {
  if (!tenant_id || !question) return [];

  const STOP_WORDS = [
    "who",
    "what",
    "is",
    "are",
    "the",
    "this",
    "that",
    "about",
    "tell",
    "me",
    "please",
    "explain",
  ];

  const keywords = question
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(" ")
    .filter((w) => w.length > 2 && !STOP_WORDS.includes(w));

  if (!keywords.length) return [];

  const conditions = keywords.map(() => "kc.chunk_text LIKE ?").join(" OR ");
  const values = keywords.map((k) => `%${k}%`);

  const query = `
    SELECT kc.chunk_text
    FROM ${tableNames.KNOWLEDGECHUNKS} kc
    INNER JOIN ${tableNames.KNOWLEDGESOURCE} ks
      ON ks.id = kc.source_id
    WHERE ks.status = 'active'
      AND ks.is_deleted = false
      AND ks.tenant_id IN (?)
      AND (${conditions})
    ORDER BY LENGTH(kc.chunk_text) ASC
    LIMIT 8
  `;

  const [rows] = await db.sequelize.query(query, {
    replacements: [tenant_id, ...values],
  });

  return rows.map((r) => r.chunk_text);
};
