// import db from "../../database/index.js";
// import { tableNames } from "../../database/tableName.js";

// // export const searchKnowledgeChunks = async (question) => {
// //   if (!question) return [];

// //   // Normalize question
// //   const keywords = question
// //     .toLowerCase()
// //     .replace(/[^\w\s]/g, "")
// //     .split(" ")
// //     .filter(w => w.length > 2);

// //   if (!keywords.length) return [];

// //   const conditions = keywords.map(() => "chunk_text LIKE ?").join(" OR ");
// //   const values = keywords.map(k => `%${k}%`);

// //   const [rows] = await db.sequelize.query(
// //     `
// //     SELECT chunk_text
// //     FROM ${tableNames.KNOWLEDGECHUNKS}
// //     WHERE ${conditions}
// //     LIMIT 5
// //     `,
// //     { replacements: values }
// //   );

// //   return rows.map(r => r.chunk_text);
// // };

// // export const searchKnowledgeChunks = async (question) => {
// //   if (!question) return [];

// //   const STOP_WORDS = [
// //     "who",
// //     "what",
// //     "is",
// //     "are",
// //     "the",
// //     "this",
// //     "that",
// //     "about",
// //     "tell",
// //     "me",
// //     "please",
// //     "explain",
// //   ];

// //   const keywords = question
// //     .toLowerCase()
// //     .replace(/[^\w\s]/g, "")
// //     .split(" ")
// //     .filter((w) => w.length > 2 && !STOP_WORDS.includes(w));

// //   if (!keywords.length) return [];

// //   const conditions = keywords.map(() => "chunk_text LIKE ?").join(" OR ");
// //   const values = keywords.map((k) => `%${k}%`);

// //   // const [rows] = await db.sequelize.query(
// //   //   `
// //   //   SELECT chunk_text
// //   //   FROM ${tableNames.KNOWLEDGECHUNKS}
// //   //   WHERE ${conditions}
// //   //   ORDER BY LENGTH(chunk_text) DESC
// //   //   LIMIT 10
// //   //   `,
// //   //   { replacements: values }
// //   // );

// //   const Query = `SELECT kc.chunk_text as chunk_text FROM ${tableNames?.KNOWLEDGECHUNKS} as kc
// //   LEFT JOIN ${tableNames?.KNOWLEDGESOURCE} as ks ON ( ks.id == kc.id ) WHERE ks.status = active AND ${conditions} ORDER BY LENGTH(chunk_text) DESC LIMIT 10
// //   `;

// //   const [rows] = await db.sequelize(Query, { replacement: values });

// //   return rows.map((r) => r.chunk_text);
// // };

// export const searchKnowledgeChunks = async (tenant_id , question) => {
//   if (!question) return [];

//   const STOP_WORDS = [
//     "who",
//     "what",
//     "is",
//     "are",
//     "the",
//     "this",
//     "that",
//     "about",
//     "tell",
//     "me",
//     "please",
//     "explain",
//   ];

//   const keywords = question
//     .toLowerCase()
//     .replace(/[^\w\s]/g, "")
//     .split(" ")
//     .filter((w) => w.length > 2 && !STOP_WORDS.includes(w));

//   if (!keywords.length) return [];

//   const conditions = keywords.map(() => "kc.chunk_text LIKE ?").join(" OR ");

//   const values = keywords.map((k) => `%${k}%`);

//   const query = `
//     SELECT kc.chunk_text
//     FROM ${tableNames?.KNOWLEDGECHUNKS} As kc
//     INNER JOIN  ${tableNames?.KNOWLEDGESOURCE} As ks
//       ON ks.id = kc.source_id
//     WHERE ks.status = 'active'
//       AND (${conditions})
//     ORDER BY LENGTH(kc.chunk_text) DESC
//     LIMIT 10
//   `;

//   const [rows] = await db.sequelize.query(query, {
//     replacements: values,
//   });

//   return rows.map((r) => r.chunk_text);
// };

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
