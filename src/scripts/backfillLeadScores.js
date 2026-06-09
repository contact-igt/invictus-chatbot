/**
 * Backfill script: recompute lead_score_final for all existing leads
 * using business-type-aware scoring profiles.
 *
 * Each tenant's business type determines weights, decay rate, and hot threshold.
 * Safe to re-run — uses UPDATE with explicit values, never deletes data.
 *
 * Usage:
 *   node src/scripts/backfillLeadScores.js
 */

import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";
import { calculateHeatState } from "../utils/helpers/calculateHeatState.js";

// ── Scoring Profiles (mirrors leads.service.js) ──
const SCORING_PROFILES = {
  hospital: {
    weights: { recency: 0.40, conversation: 0.38, interest: 0.22 },
    decayLambda: 0.018,
    hotThreshold: 75,
  },
  clinic: {
    weights: { recency: 0.40, conversation: 0.38, interest: 0.22 },
    decayLambda: 0.018,
    hotThreshold: 75,
  },
  education: {
    weights: { recency: 0.25, conversation: 0.48, interest: 0.27 },
    decayLambda: 0.010,
    hotThreshold: 72,
  },
  academy: {
    weights: { recency: 0.25, conversation: 0.48, interest: 0.27 },
    decayLambda: 0.010,
    hotThreshold: 72,
  },
  law: {
    weights: { recency: 0.25, conversation: 0.45, interest: 0.30 },
    decayLambda: 0.008,
    hotThreshold: 70,
  },
  organization: {
    weights: { recency: 0.30, conversation: 0.42, interest: 0.28 },
    decayLambda: 0.012,
    hotThreshold: 73,
  },
  default: {
    weights: { recency: 0.35, conversation: 0.40, interest: 0.25 },
    decayLambda: 0.015,
    hotThreshold: 75,
  },
};

const INTENT_NEUTRAL_SCORE = 50;
const INTENT_INTEREST_NEUTRAL = 50;

const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0));
const toNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const getScoringProfile = (businessType) => {
  if (!businessType) return SCORING_PROFILES.default;
  const key = String(businessType).toLowerCase().trim();
  return SCORING_PROFILES[key] || SCORING_PROFILES.default;
};

const deriveFinalStatus = (score, hotThreshold = 75) => {
  if (score >= hotThreshold) return "hot";
  if (score >= hotThreshold - 25) return "warm";
  if (score >= hotThreshold - 50) return "cold";
  return "supercold";
};

const run = async () => {
  await db.sequelize.authenticate();
  console.log("[BACKFILL] DB connection OK");

  // 1. Load all tenant settings to get business types
  const [tenants] = await db.sequelize.query(
    `SELECT tenant_id, type, ai_settings FROM ${tableNames.TENANTS} WHERE is_deleted = false`,
  );

  const tenantProfileMap = new Map();
  for (const tenant of tenants) {
    let aiSettings = {};
    if (tenant.ai_settings) {
      try {
        aiSettings = typeof tenant.ai_settings === "string"
          ? JSON.parse(tenant.ai_settings)
          : tenant.ai_settings;
      } catch (e) { /* ignore */ }
    }
    const businessType = aiSettings?.business_type || tenant.type;
    const profile = getScoringProfile(businessType);
    tenantProfileMap.set(tenant.tenant_id, { profile, businessType: businessType || "default" });
    console.log(`[BACKFILL] Tenant ${tenant.tenant_id}: type="${businessType || "default"}" → weights=${JSON.stringify(profile.weights)}`);
  }

  // 2. Load all active leads
  const [leads] = await db.sequelize.query(
    `SELECT lead_id, contact_id, tenant_id,
            last_user_message_at, score,
            lead_score_recency_component,
            lead_score_conversation_component,
            lead_score_intent_interest_component,
            lead_score_confidence,
            lead_score_reason_codes
     FROM ${tableNames.LEADS}
     WHERE is_deleted = false`,
  );

  console.log(`[BACKFILL] Found ${leads.length} active leads to recompute`);

  let updated = 0;
  let skipped = 0;

  for (const lead of leads) {
    try {
      const tenantProfile = tenantProfileMap.get(lead.tenant_id) || {
        profile: SCORING_PROFILES.default,
        businessType: "default",
      };
      const { profile, businessType } = tenantProfile;

      const recencyAnchor = lead.last_user_message_at
        ? new Date(lead.last_user_message_at)
        : new Date();
      const { heat_state, heat_score } = calculateHeatState(recencyAnchor, profile.decayLambda);

      // Use stored components where available, fall back to neutral
      const conversationComponent = toNum(
        lead.lead_score_conversation_component,
        INTENT_NEUTRAL_SCORE,
      );
      const intentInterestComponent = toNum(
        lead.lead_score_intent_interest_component,
        INTENT_INTEREST_NEUTRAL,
      );

      const w = profile.weights;
      const rawScore =
        clamp(heat_score) * w.recency +
        clamp(conversationComponent) * w.conversation +
        clamp(intentInterestComponent) * w.interest;

      const finalScore = Math.round(clamp(rawScore));
      const finalStatus = deriveFinalStatus(finalScore, profile.hotThreshold);

      await db.sequelize.query(
        `UPDATE ${tableNames.LEADS}
         SET lead_score_recency_component = ?,
             lead_score_conversation_component = ?,
             lead_score_intent_interest_component = ?,
             lead_score_raw = ?,
             lead_score_final = ?,
             lead_status_final = ?,
             heat_state = ?,
             score = ?,
             lead_score_updated_at = NOW()
         WHERE lead_id = ? AND tenant_id = ?`,
        {
          replacements: [
            Math.round(clamp(heat_score)),
            Math.round(clamp(conversationComponent)),
            Math.round(clamp(intentInterestComponent)),
            Number(rawScore.toFixed(2)),
            finalScore,
            finalStatus,
            heat_state,
            Math.round(clamp(heat_score)),
            lead.lead_id,
            lead.tenant_id,
          ],
        },
      );

      updated++;
    } catch (err) {
      console.error(`[BACKFILL] Error on lead ${lead.lead_id}:`, err.message);
      skipped++;
    }
  }

  console.log(`[BACKFILL] Done — ${updated} updated, ${skipped} skipped`);
  await db.sequelize.close();
  process.exit(0);
};

run().catch((err) => {
  console.error("[BACKFILL] Fatal error:", err);
  process.exit(1);
});
