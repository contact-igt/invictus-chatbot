import db from "../../../database/index.js";
import { tableNames } from "../../../database/tableName.js";
import { classifyForFaq } from "../questionUnderstandingAgent.js";
import { getIO } from "../../../middlewares/socket/socket.js";

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
         AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
       LIMIT 1`,
      { replacements: [tenantId, normalizedQ, DEDUPE_WINDOW_HOURS] },
    );

    if (existing.length > 0) {
      console.log(
        `[MISSING-KNOWLEDGE] Dedupe hit — pending entry already exists for "${normalizedQ}"`,
      );
      return;
    }

    // ── Step 3: Insert pending_review row ─────────────────────────────────
    const [insertResult] = await db.sequelize.query(
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

    const faqId =
      insertResult && typeof insertResult.insertId === "number"
        ? insertResult.insertId
        : null;

    emitFaqRealtimeUpdate({
      tenant_id: tenantId,
      action: "faq-created",
      faq_id: faqId,
      status: "pending_review",
      is_active: true,
    });

    console.log(
      `[MISSING-KNOWLEDGE] ✓ FAQ pending_review created for tenant ${tenantId}: "${normalizedQ}" (faq_id: ${faqId ?? "unknown"})`,
    );
  } catch (err) {
    // Handler errors must never crash the main message flow
    console.error("[MISSING-KNOWLEDGE] Handler error:", err.message, err.stack);
  }
};
