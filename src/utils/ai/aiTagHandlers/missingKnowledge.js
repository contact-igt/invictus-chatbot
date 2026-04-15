import db from "../../../database/index.js";
import { tableNames } from "../../../database/tableName.js";
import { classifyForFaq } from "../questionUnderstandingAgent.js";

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


export const execute = async (tagPayload, context, cleanMessage) => {
  const tenantId = context?.tenant_id;
  const userMessage = context?.userMessage || cleanMessage || "";
  const phone = context?.phone || null;

  if (!tenantId || !userMessage) {
    console.log("[MISSING-KNOWLEDGE] Skipping — missing tenant_id or userMessage");
    return;
  }

  // Topic is whatever came after [MISSING_KNOWLEDGE: ...]
  // tagPayload may be the raw string like "heart surgery prerequisites"
  const topic = (tagPayload || userMessage).trim().substring(0, 500);

  console.log(`[MISSING-KNOWLEDGE] Received topic: "${topic}" | tenant: ${tenantId}`);

  try {
    // ── Step 1: Classify the question ──────────────────────────────────────
    const classification = await classifyForFaq(userMessage, topic, tenantId);

    console.log(
      `[MISSING-KNOWLEDGE] Classification: ${classification.category} — ${classification.reason}`,
    );

    // Strict product rule: every missing-knowledge question should enter FAQ review.
    if (classification.category !== "valid_faq") {
      console.log(
        `[MISSING-KNOWLEDGE] Non-valid category (${classification.category}) is still queued due strict missing-info policy`,
      );
    }

    // ── Step 2: Dedupe guard ───────────────────────────────────────────────
    const normalizedQ = classification.normalized_question;

    const [existing] = await db.sequelize.query(
      `SELECT id FROM ${tableNames.FAQ_REVIEWS}
       WHERE tenant_id = ?
         AND normalized_question = ?
         AND status = 'pending_review'
       LIMIT 1`,
      { replacements: [tenantId, normalizedQ] },
    );

    if (existing.length > 0) {
      console.log(
        `[MISSING-KNOWLEDGE] Dedupe hit — pending entry already exists for "${normalizedQ}"`,
      );
      return;
    }

    // ── Step 3: Insert pending_review row ─────────────────────────────────
    await db.sequelize.query(
      `INSERT INTO ${tableNames.FAQ_REVIEWS}
         (tenant_id, question, normalized_question, agent_category, agent_reason,
          whatsapp_number, status, add_to_kb, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending_review', false, true, NOW(), NOW())`,
      {
        replacements: [
          tenantId,
          userMessage.substring(0, 1000),
          normalizedQ,
          classification.category,
          classification.reason,
          phone,
        ],
      },
    );

    console.log(
      `[MISSING-KNOWLEDGE] ✓ FAQ pending_review created for tenant ${tenantId}: "${normalizedQ}"`,
    );
  } catch (err) {
    // Handler errors must never crash the main message flow
    console.error("[MISSING-KNOWLEDGE] Handler error:", err.message, err.stack);
  }
};
