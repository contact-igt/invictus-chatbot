/**
 * Backfill Migration: Embed existing FAQs + Cluster & Merge Duplicates
 *
 * Purpose:
 *   1. Generate embeddings for all FAQ rows that are missing them
 *   2. Cluster semantically similar FAQs per tenant (threshold ≥ 0.88)
 *   3. Merge clusters: keep oldest as canonical, sum ask_counts, collect variants, delete dupes
 *
 * Usage:
 *   node migrations/20260505_backfill_faq_embeddings.js           # live run
 *   node migrations/20260505_backfill_faq_embeddings.js --dry-run  # preview only (no DB changes)
 *
 * Notes:
 *   - Embedding calls are batched (20 per batch, 1s delay) to respect OpenAI rate limits
 *   - Cluster threshold 0.88 is intentionally tighter than runtime (0.80) to avoid false merges on historical data
 *   - Destructive: deletes duplicate rows. Use --dry-run first!
 */

import db from "../src/database/index.js";
import { tableNames } from "../src/database/tableName.js";
import { generateTextEmbedding } from "../src/utils/ai/embedding.js";
import { cosineSimilarity, parseEmbedding } from "../src/utils/ai/embedding.js";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1000;
const CLUSTER_THRESHOLD = Number(process.env.FAQ_DEDUPE_THRESHOLD || 0.75);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Phase 1: Embed all FAQs missing embeddings ──────────────────────────
async function embedMissingFaqs() {
  const [rows] = await db.sequelize.query(
    `SELECT id, tenant_id, question FROM ${tableNames.FAQ_REVIEWS}
     WHERE embedding IS NULL AND status != 'deleted'
     ORDER BY id ASC`,
  );

  console.log(`[BACKFILL] Phase 1: ${rows.length} FAQs need embeddings`);
  if (rows.length === 0) return;

  let embedded = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      try {
        const embedding = await generateTextEmbedding(row.question, row.tenant_id);
        if (embedding && !DRY_RUN) {
          await db.sequelize.query(
            `UPDATE ${tableNames.FAQ_REVIEWS} SET embedding = ? WHERE id = ?`,
            { replacements: [JSON.stringify(embedding), row.id] },
          );
        }
        embedded++;
      } catch (err) {
        console.error(`  [FAIL] id=${row.id}: ${err.message}`);
        failed++;
      }
    }

    if (i + BATCH_SIZE < rows.length) {
      console.log(`  [BATCH] Embedded ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}... waiting ${BATCH_DELAY_MS}ms`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`[BACKFILL] Phase 1 done: embedded=${embedded}, failed=${failed}`);
}

// ─── Phase 2: Cluster & Merge per tenant ─────────────────────────────────
async function clusterAndMerge() {
  const [tenants] = await db.sequelize.query(
    `SELECT DISTINCT tenant_id FROM ${tableNames.FAQ_REVIEWS}
     WHERE status != 'deleted' AND embedding IS NOT NULL`,
  );

  console.log(`[BACKFILL] Phase 2: Processing ${tenants.length} tenants`);

  let totalMerged = 0;
  let totalDeleted = 0;

  for (const { tenant_id } of tenants) {
    const [faqs] = await db.sequelize.query(
      `SELECT id, question, ask_count, embedding, similar_questions
       FROM ${tableNames.FAQ_REVIEWS}
       WHERE tenant_id = ? AND status != 'deleted' AND embedding IS NOT NULL
       ORDER BY id ASC`,
      { replacements: [tenant_id] },
    );

    if (faqs.length < 2) continue;

    // Parse embeddings
    const items = faqs.map((f) => ({
      ...f,
      vec: parseEmbedding(f.embedding),
    })).filter((f) => f.vec !== null);

    // Build clusters using union-find approach
    const parent = new Map();
    const find = (id) => {
      if (!parent.has(id)) parent.set(id, id);
      if (parent.get(id) !== id) parent.set(id, find(parent.get(id)));
      return parent.get(id);
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };

    // Compare all pairs — O(n²) but fine for typical FAQ counts (<500/tenant)
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const sim = cosineSimilarity(items[i].vec, items[j].vec);
        if (sim >= CLUSTER_THRESHOLD) {
          union(items[i].id, items[j].id);
        }
      }
    }

    // Group into clusters
    const clusters = new Map();
    for (const item of items) {
      const root = find(item.id);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(item);
    }

    // Process clusters with 2+ members
    for (const [, members] of clusters) {
      if (members.length < 2) continue;

      // Keep oldest (first created = lowest id) as canonical
      members.sort((a, b) => a.id - b.id);
      const canonical = members[0];
      const dupes = members.slice(1);

      // Sum ask_counts
      const totalCount = members.reduce((sum, m) => sum + (Number(m.ask_count) || 1), 0);

      // Collect all variant questions
      const existingVariants = [];
      for (const m of members) {
        // Parse existing similar_questions from each member
        try {
          const parsed = JSON.parse(m.similar_questions || "[]");
          if (Array.isArray(parsed)) {
            for (const v of parsed) {
              if (typeof v === "string") {
                existingVariants.push({ question: v, similarity: 1.0, merged_at: new Date().toISOString() });
              } else if (v && typeof v === "object" && v.question) {
                existingVariants.push(v);
              }
            }
          }
        } catch {}
      }

      // Add each dupe's question as a variant (with similarity to canonical)
      for (const dupe of dupes) {
        const sim = cosineSimilarity(canonical.vec, dupe.vec);
        existingVariants.push({
          question: dupe.question,
          similarity: Math.round(sim * 100) / 100,
          merged_at: new Date().toISOString(),
        });
      }

      const dupeIds = dupes.map((d) => d.id);

      console.log(`  [CLUSTER] tenant=${tenant_id} canonical_id=${canonical.id} "${canonical.question.substring(0, 60)}" ← merging ${dupeIds.length} dupes (total count=${totalCount})`);
      for (const d of dupes) {
        console.log(`    [DUPE] id=${d.id} "${d.question.substring(0, 60)}"`);
      }

      if (!DRY_RUN) {
        // Update canonical with merged data
        await db.sequelize.query(
          `UPDATE ${tableNames.FAQ_REVIEWS}
           SET ask_count = ?,
               similar_questions = ?,
               updated_at = NOW()
           WHERE id = ?`,
          { replacements: [totalCount, JSON.stringify(existingVariants), canonical.id] },
        );

        // Delete duplicates
        await db.sequelize.query(
          `UPDATE ${tableNames.FAQ_REVIEWS}
           SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
           WHERE id IN (?)`,
          { replacements: [dupeIds] },
        );
      }

      totalMerged++;
      totalDeleted += dupeIds.length;
    }

    console.log(`  [TENANT] ${tenant_id}: done`);
  }

  console.log(`[BACKFILL] Phase 2 done: clusters_merged=${totalMerged}, rows_deleted=${totalDeleted}`);
}

// ─── Main ────────────────────────────────────────────────────────────────
async function run() {
  console.log(`[BACKFILL] Starting... ${DRY_RUN ? "(DRY RUN — no DB changes)" : "(LIVE RUN)"}`);
  console.log(`[BACKFILL] Cluster threshold: ${CLUSTER_THRESHOLD}`);

  try {
    await embedMissingFaqs();
    await clusterAndMerge();
    console.log("[BACKFILL] All done.");
  } catch (err) {
    console.error("[BACKFILL] FATAL:", err.message, err.stack);
    process.exit(1);
  } finally {
    await db.sequelize.close();
  }
}

run();
