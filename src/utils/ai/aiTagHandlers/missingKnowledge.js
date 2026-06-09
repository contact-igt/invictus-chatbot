import db from "../../../database/index.js";
import { tableNames } from "../../../database/tableName.js";
import { classifyForFaq } from "../questionUnderstandingAgent.js";
import { getIO } from "../../../middlewares/socket/socket.js";
import { generateTextEmbedding } from "../embedding.js";
import { findSemanticDuplicateFaq } from "../faqDeduplication.js";
import fs from "fs";

const faqTrace = (label, data) => {
  const line = `[${new Date().toISOString()}] ${label} ${JSON.stringify(data)}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync("/tmp/faq_trace.log", line); } catch {}
};
/**
 * MISSING_KNOWLEDGE Tag Handler
 *
 * Fires AFTER the AI reply has already been sent to the patient.
 * This handler is the entry point for the FAQ pipeline.
 *
 * Flow:
 *   1. Extract topic from tag payload
 *   2. Run dedupe guard — skip if same question is already pending (24h window)
 *   3. Classify with questionUnderstandingAgent (cheap 80-token input model)
 *   4. If valid_faq → insert pending_review row
 *   5. If out_of_scope or noise → discard silently
 *
 * Context fields expected:
 *   context.tenant_id
 *   context.userMessage    (original patient message)
 *   context.phone          (whatsapp number)
 *   context.contact_id     (optional)
 */

// How recently (in hours) the same question must have been asked to skip insert
const DEDUPE_WINDOW_HOURS = 24;

// Valid ENUM values for agent_category column — must match DB schema
const VALID_CATEGORIES = new Set(["valid_faq", "out_of_scope", "noise"]);

/** Clamp category to a valid ENUM value; default to valid_faq so nothing is lost */
const sanitizeCategory = (raw) => {
  const val = String(raw || "").trim().toLowerCase();
  return VALID_CATEGORIES.has(val) ? val : "valid_faq";
};

const emitFaqRealtimeUpdate = ({
  tenant_id,
  action,
  faq_id = null,
  status = null,
  is_active = null,
}) => {
  try {
    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("faq-updated", {
      tenant_id,
      action,
      faq_id,
      status,
      is_active,
      emitted_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(`[FAQ-SOCKET] Failed to emit ${action}:`, err.message);
  }
};

export const execute = async (tagPayload, context, cleanMessage) => {
  const tenantId = context?.tenant_id;
  const userMessage = context?.userMessage || cleanMessage || "";
  const phone = context?.phone || null;
  const messageId = context?.messageId || null; // WhatsApp Message ID (wamid)
  const message_db_id = context?.message_db_id || null; // Local database message ID

  if (!tenantId || !userMessage) {
    console.log("[MISSING-KNOWLEDGE] Skipping — missing tenant_id or userMessage");
    return;
  }

  // Topic is whatever came after [MISSING_KNOWLEDGE: ...]
  // tagPayload may be the raw string like "heart surgery prerequisites"
  const topic = (tagPayload || userMessage).trim().substring(0, 500);

  faqTrace("[MISSING-KNOWLEDGE] handler invoked", { tenantId, userMessage: userMessage.substring(0, 80), phone, messageId, message_db_id, topic: topic.substring(0, 80) });

  try {
    // ── Step 1: Classify the question ──────────────────────────────────────
    let classification;
    try {
      faqTrace("[MISSING-KNOWLEDGE] Step 1 — classifying", { msg: userMessage.substring(0, 80) });
      classification = await classifyForFaq(userMessage, topic, tenantId);
      faqTrace("[MISSING-KNOWLEDGE] Step 1 done", { category: classification.category, normalizedQ: String(classification.normalized_question || "").substring(0, 80) });
    } catch (classifyErr) {
      faqTrace("[MISSING-KNOWLEDGE] Classifier FAILED — defaulting", { error: classifyErr.message });
      classification = {
        category: "valid_faq",
        reason: "Classifier unavailable — defaulted to valid_faq",
        normalized_question: topic || userMessage.substring(0, 500),
      };
    }

    // Strict product rule: every missing-knowledge question should enter FAQ review.
    if (classification.category !== "valid_faq") {
      console.log(
        `[FAQ-PIPELINE] Non-valid category (${classification.category}) — still queuing per strict policy`,
      );
    }

    // Sanitize category to valid DB ENUM value
    const safeCategory = sanitizeCategory(classification.category);

    // ── Step 2: Semantic dedupe — merge similar FAQs ─────────────────────
    const normalizedQ = classification.normalized_question || topic || userMessage.substring(0, 500);
    faqTrace("[MISSING-KNOWLEDGE] Step 2 — generating embedding for incoming question", { normalizedQ: String(normalizedQ || "").substring(0, 80) });

    let questionEmbedding = null;
    try {
      questionEmbedding = await generateTextEmbedding(userMessage, tenantId);
      faqTrace("[MISSING-KNOWLEDGE] Embedding generated", { vectorLength: questionEmbedding?.length ?? 0 });
    } catch (embErr) {
      // Embedding failed — log as real error, do NOT silently skip to text-dedupe.
      // Without an embedding we cannot do semantic matching, so fall through to new-card creation.
      console.error(`[MISSING-KNOWLEDGE] ✗ Embedding generation FAILED:`, embErr.message);
      faqTrace("[MISSING-KNOWLEDGE] ✗ Embedding FAILED — will create new card (no vector to compare)", { error: embErr.message });
    }

    // Guard: if embedding is null/empty, we CANNOT do semantic dedup
    if (questionEmbedding && (!Array.isArray(questionEmbedding) || questionEmbedding.length === 0)) {
      console.error(`[MISSING-KNOWLEDGE] ✗ Embedding returned non-null but invalid — treating as missing`);
      questionEmbedding = null;
    }

    if (questionEmbedding) {
      faqTrace("[MISSING-KNOWLEDGE] Running semantic similarity search", { vectorLength: questionEmbedding.length });

      let dedupeResult;
      try {
        dedupeResult = await findSemanticDuplicateFaq(tenantId, questionEmbedding);
      } catch (dedupeErr) {
        console.error(`[MISSING-KNOWLEDGE] ✗ Semantic dedupe FAILED:`, dedupeErr.message);
        faqTrace("[MISSING-KNOWLEDGE] ✗ Semantic dedupe threw error — will create new card", { error: dedupeErr.message });
        dedupeResult = { match: null };
      }

      const { match } = dedupeResult;

      if (match) {
        // ═══ MATCH FOUND: same FAQ, increment count, do NOT create new card ═══
        faqTrace("[MISSING-KNOWLEDGE] ✓ Semantic match — incrementing count", {
          existingId: match.id,
          similarity: match.similarity,
          currentCount: match.ask_count,
          question: match.question.substring(0, 80),
        });

        const variantQuestion = userMessage.substring(0, 500);
        const variantSimilarity = Math.round(match.similarity * 100) / 100;
        const variantMergedAt = new Date().toISOString();

        // Safety: convert empty strings to null for wamid/phone
        const safeWamid = messageId && messageId.trim() !== '' ? messageId : null;
        const safePhone = phone && phone.trim() !== '' ? phone : null;

        if (!safeWamid) {
          console.warn('[FAQ Dedup] Merging duplicate without wamid:', {
            question: userMessage.substring(0, 50),
            match_id: match.id,
            phone: safePhone || 'unknown'
          });
        }

        faqTrace("[MISSING-KNOWLEDGE] Incrementing count for FAQ id", { id: match.id, newCount: match.ask_count + 1 });

        const [, updateMeta] = await db.sequelize.query(
          `UPDATE ${tableNames.FAQ_REVIEWS}
           SET ask_count = ask_count + 1,
               similar_questions = JSON_ARRAY_APPEND(
                 COALESCE(similar_questions, JSON_ARRAY()),
                 '$',
                 JSON_OBJECT('question', ?, 'similarity', ?, 'merged_at', ?, 'wamid', ?, 'phone', ?)
               ),
               updated_at = NOW()
           WHERE id = ? AND tenant_id = ?`,
          { replacements: [variantQuestion, variantSimilarity, variantMergedAt, safeWamid, safePhone, match.id, tenantId] },
        );

        // Verify the update actually worked
        const affectedRows = Number(updateMeta?.affectedRows ?? updateMeta ?? 0);
        if (affectedRows === 0) {
          const errMsg = `[MISSING-KNOWLEDGE] ✗ COUNT UPDATE FAILED — 0 rows affected for FAQ id ${match.id}, tenant ${tenantId}`;
          console.error(errMsg);
          faqTrace(errMsg, { id: match.id, tenantId });
          throw new Error(errMsg);
        }

        faqTrace("[MISSING-KNOWLEDGE] ✓ Count incremented successfully", {
          faqId: match.id,
          affectedRows,
          previousCount: match.ask_count,
          newCount: match.ask_count + 1,
        });

        emitFaqRealtimeUpdate({
          tenant_id: tenantId,
          action: "faq-count-incremented",
          faq_id: match.id,
          status: "pending_review",
          is_active: true,
        });
        return; // ← EXIT — merged into existing card, no new insert
      }

      // No match — fall through to normal insert below
      faqTrace("[MISSING-KNOWLEDGE] No semantic match found — will create new card", {});
    } else {
      // Fallback: text-based dedupe when embedding unavailable
      faqTrace("[MISSING-KNOWLEDGE] No embedding available — trying exact text-based dedupe", { normalizedQ: normalizedQ.substring(0, 60) });
      const [existing] = await db.sequelize.query(
        `SELECT id FROM ${tableNames.FAQ_REVIEWS}
         WHERE tenant_id = ?
           AND normalized_question = ?
           AND status != 'deleted'
         LIMIT 1`,
        { replacements: [tenantId, normalizedQ] },
      );
      if (existing.length > 0) {
        faqTrace("[MISSING-KNOWLEDGE] ✓ Text dedupe hit — incrementing count (exact text match)", { existingId: existing[0].id });

        // Even for text-based dedupe, increment the count instead of just skipping
        const textVariantMergedAt = new Date().toISOString();

        // Safety: convert empty strings to null for wamid/phone
        const safeWamid = messageId && messageId.trim() !== '' ? messageId : null;
        const safePhone = phone && phone.trim() !== '' ? phone : null;

        if (!safeWamid) {
          console.warn('[FAQ Dedup] Text dedupe without wamid:', {
            question: userMessage.substring(0, 50),
            existing_id: existing[0].id,
            phone: safePhone || 'unknown'
          });
        }

        const [, textUpdateMeta] = await db.sequelize.query(
          `UPDATE ${tableNames.FAQ_REVIEWS}
           SET ask_count = ask_count + 1,
               similar_questions = JSON_ARRAY_APPEND(
                 COALESCE(similar_questions, JSON_ARRAY()),
                 '$',
                 JSON_OBJECT('question', ?, 'similarity', 1.0, 'merged_at', ?, 'match_type', 'exact_text', 'wamid', ?, 'phone', ?)
               ),
               updated_at = NOW()
           WHERE id = ? AND tenant_id = ?`,
          { replacements: [userMessage.substring(0, 500), textVariantMergedAt, safeWamid, safePhone, existing[0].id, tenantId] },
        );

        const textAffected = Number(textUpdateMeta?.affectedRows ?? textUpdateMeta ?? 0);
        faqTrace("[MISSING-KNOWLEDGE] ✓ Text dedupe count incremented", { faqId: existing[0].id, affectedRows: textAffected });

        emitFaqRealtimeUpdate({
          tenant_id: tenantId,
          action: "faq-count-incremented",
          faq_id: existing[0].id,
          status: "pending_review",
          is_active: true,
        });
        return;
      }
      faqTrace("[MISSING-KNOWLEDGE] No text dedupe match either — will create new card", {});
    }

    // ── Step 3: Insert pending_review row ─────────────────────────────────
    faqTrace("[MISSING-KNOWLEDGE] Step 3 — INSERT", { tenantId, safeCategory, normalizedQ: normalizedQ.substring(0, 80), phone, messageId });
    const [insertResult] = await db.sequelize.query(
      `INSERT INTO ${tableNames.FAQ_REVIEWS}
         (tenant_id, question, normalized_question, agent_category, agent_reason,
          whatsapp_number, wamid, message_id, embedding, ask_count,
          status, add_to_kb, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending_review', false, true, NOW(), NOW())`,
      {
        replacements: [
          tenantId,
          userMessage.substring(0, 1000),
          normalizedQ,
          safeCategory,
          classification.reason,
          phone,
          messageId,
          message_db_id,
          questionEmbedding ? JSON.stringify(questionEmbedding) : null,
        ],
      },
    );

    const faqId =
      insertResult && (typeof insertResult.insertId === "number" || typeof insertResult.insertId === "bigint")
        ? Number(insertResult.insertId)
        : (insertResult?.insertId ?? null);

    faqTrace("[MISSING-KNOWLEDGE] Step 3 done — INSERT result", { insertId: insertResult?.insertId, faqId });

    emitFaqRealtimeUpdate({
      tenant_id: tenantId,
      action: "faq-created",
      faq_id: faqId,
      status: "pending_review",
      is_active: true,
    });

    faqTrace("[MISSING-KNOWLEDGE] ✓ FAQ CREATED + socket emitted", { tenantId, faqId, normalizedQ: normalizedQ.substring(0, 80) });
  } catch (err) {
    // Re-throw so the controller's catch block sees it as "Background AI error"
    faqTrace("[MISSING-KNOWLEDGE] ✗ FATAL ERROR", { tenantId, error: err.message, stack: err.stack?.substring(0, 300) });
    throw err;
  }
};
