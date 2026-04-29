import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { buildChatHistory } from "../../utils/chat/buildChatHistory.js";
import { calculateHeatState } from "../../utils/helpers/calculateHeatState.js";
import cron from "node-cron";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { AiService } from "../../utils/ai/coreAi.js";
import {
  getLeadSummarizePrompt,
  getLeadSummaryModeInstruction,
} from "../../utils/ai/prompts/index.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import { classifyIntent } from "../../utils/ai/intentClassifier.js";
import { getTenantSettingsService } from "../TenantModel/tenant.service.js";

const SCORE_MIN = 0;
const SCORE_MAX = 100;
const INTENT_NEUTRAL_SCORE = 50;
const INTENT_INTEREST_NEUTRAL = 50;
const INTENT_INTERESTED_SCORE = 80;
const INTENT_NOT_INTERESTED_SCORE = 20;
const INTENT_LOW_CONFIDENCE_THRESHOLD = 0.5;
const INTENT_LOW_CONFIDENCE_PULL_FACTOR = 0.75;
const INTENT_NEGATIVE_PENALTY = 30;
const APPOINTMENT_INTENT_BONUS = 15;

// ── Business-Type Scoring Profiles ──────────────────────────────────────────
// Each business type gets tuned weights, decay rate, signal boost floors,
// and hot threshold. Profiles are looked up via:
//   ai_settings.business_type → tenant.type → "default"
//
// weights: { recency, conversation, interest } — must sum to 1.0
// decayLambda: passed to calculateHeatState exponential decay
// hotThreshold: final score >= this = "hot" status
// signalBoosts: floor values applied when hard evidence exists, to prevent
//               AI model score compression from under-scoring strong leads

const SCORING_PROFILES = {
  // Healthcare: urgency matters, smooth decay, balanced AI weight
  hospital: {
    weights: { recency: 0.40, conversation: 0.38, interest: 0.22 },
    decayLambda: 0.018,      // half-life ~38h
    hotThreshold: 80,
    signalBoosts: { budget: 78, timeline: 80, booking: 90 },
  },
  clinic: {
    weights: { recency: 0.40, conversation: 0.38, interest: 0.22 },
    decayLambda: 0.018,
    hotThreshold: 80,
    signalBoosts: { budget: 78, timeline: 80, booking: 90 },
  },

  // Education/Academy: students research for days, conversation depth matters most
  education: {
    weights: { recency: 0.25, conversation: 0.48, interest: 0.27 },
    decayLambda: 0.010,      // half-life ~69h (slower decay)
    hotThreshold: 80,
    signalBoosts: { budget: 75, timeline: 78, booking: 88 },
  },
  academy: {
    weights: { recency: 0.25, conversation: 0.48, interest: 0.27 },
    decayLambda: 0.010,
    hotThreshold: 80,
    signalBoosts: { budget: 75, timeline: 78, booking: 88 },
  },

  // Law: clients do heavy research, long consideration period
  law: {
    weights: { recency: 0.25, conversation: 0.45, interest: 0.30 },
    decayLambda: 0.008,      // half-life ~87h (slowest decay)
    hotThreshold: 80,
    signalBoosts: { budget: 75, timeline: 78, booking: 85 },
  },

  // Organization (B2B): long sales cycles, interest matters most
  organization: {
    weights: { recency: 0.30, conversation: 0.42, interest: 0.28 },
    decayLambda: 0.012,      // half-life ~58h
    hotThreshold: 80,
    signalBoosts: { budget: 76, timeline: 78, booking: 88 },
  },

  // Default fallback for any unknown business type
  default: {
    weights: { recency: 0.35, conversation: 0.40, interest: 0.25 },
    decayLambda: 0.015,      // half-life ~46h
    hotThreshold: 80,
    signalBoosts: { budget: 78, timeline: 78, booking: 88 },
  },
};

const getScoringProfile = (businessType) => {
  if (!businessType) return SCORING_PROFILES.default;
  const key = String(businessType).toLowerCase().trim();
  return SCORING_PROFILES[key] || SCORING_PROFILES.default;
};

// ── Tenant Scoring Profile Cache (30-min TTL) ───────────────────────────────
const TENANT_SCORING_CACHE = new Map();
const TENANT_SCORING_TTL_MS = 30 * 60 * 1000;

const getTenantScoringProfile = async (tenant_id) => {
  if (!tenant_id) return SCORING_PROFILES.default;
  const cached = TENANT_SCORING_CACHE.get(tenant_id);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  try {
    const settings = await getTenantSettingsService(tenant_id);
    const businessType = settings?.ai_settings?.business_type || settings?.type;
    const profile = getScoringProfile(businessType);
    TENANT_SCORING_CACHE.set(tenant_id, {
      profile,
      businessType: businessType || "default",
      expiresAt: Date.now() + TENANT_SCORING_TTL_MS,
    });
    return profile;
  } catch (err) {
    console.error("[LEAD-SCORE] Failed to load tenant scoring profile:", err.message);
    return SCORING_PROFILES.default;
  }
};

const getTenantBusinessType = (tenant_id) => {
  const cached = TENANT_SCORING_CACHE.get(tenant_id);
  return cached?.businessType || "default";
};

const clampScore = (value) =>
  Math.max(SCORE_MIN, Math.min(SCORE_MAX, Number(value) || 0));

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toOptionalScore = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(clampScore(parsed));
};

const parseReasonCodes = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }
  return [];
};

const normalizeLeadScoreFields = (lead) => ({
  ...lead,
  lead_score_reason_codes: parseReasonCodes(lead?.lead_score_reason_codes),
  lead_score_confidence: Number(
    toNumber(lead?.lead_score_confidence, INTENT_NEUTRAL_SCORE / 100).toFixed(2),
  ),
  lead_score_final: Math.round(toNumber(lead?.lead_score_final, lead?.score || 0)),
  lead_score_recency_component: Math.round(
    toNumber(lead?.lead_score_recency_component, lead?.score || 0),
  ),
  lead_score_conversation_component: Math.round(
    toNumber(lead?.lead_score_conversation_component, INTENT_NEUTRAL_SCORE),
  ),
  lead_score_intent_interest_component: Math.round(
    toNumber(lead?.lead_score_intent_interest_component, INTENT_INTEREST_NEUTRAL),
  ),
  // legacy field — kept for backward compat; mirrors conversation component
  lead_score_intent_component: Math.round(
    toNumber(
      lead?.lead_score_intent_component,
      toNumber(lead?.lead_score_conversation_component, INTENT_NEUTRAL_SCORE),
    ),
  ),
  lead_score_raw: Number(toNumber(lead?.lead_score_raw, 0).toFixed(2)),
});

const deriveFinalStatus = (finalScore, hotThreshold = 80) => {
  if (finalScore >= hotThreshold) return "hot";
  if (finalScore >= hotThreshold - 25) return "warm";
  if (finalScore >= hotThreshold - 50) return "cold";
  return "supercold";
};

const isNegativeIntent = (message = "") =>
  /(not interested|dont need|don't need|stop|unsubscribe|no thanks|not now|not looking)/i.test(
    message,
  );

const normalizeIntentSignals = (intentResult = {}, messageText = "") => {
  const leadIntelligence = intentResult?.lead_intelligence || {};
  const entities =
    leadIntelligence?.entities && typeof leadIntelligence.entities === "object"
      ? leadIntelligence.entities
      : {};

  const timeline =
    typeof leadIntelligence.timeline === "string"
      ? leadIntelligence.timeline
      : typeof entities.timeline === "string"
        ? entities.timeline
        : null;

  const budget =
    typeof leadIntelligence.budget === "string"
      ? leadIntelligence.budget
      : typeof entities.budget === "string"
        ? entities.budget
        : null;

  const useCase =
    typeof leadIntelligence.use_case === "string"
      ? leadIntelligence.use_case
      : typeof entities.use_case === "string"
        ? entities.use_case
        : null;

  const negativeNotInterested =
    leadIntelligence.negative_not_interested === true ||
    isNegativeIntent(messageText);

  const conversationLeadScore = toOptionalScore(
    leadIntelligence.conversation_lead_score,
  );

  // intent_interest_score: 0-100 from AI or fallback mapping
  const rawInterest = leadIntelligence.intent_interest_score;
  let intentInterestScore;
  if (rawInterest !== null && rawInterest !== undefined && Number.isFinite(Number(rawInterest))) {
    intentInterestScore = Math.round(clampScore(Number(rawInterest)));
  } else if (typeof leadIntelligence.intent_interest === "string") {
    const label = leadIntelligence.intent_interest.toUpperCase();
    intentInterestScore = label === "INTERESTED" ? INTENT_INTERESTED_SCORE
      : label === "NOT_INTERESTED" ? INTENT_NOT_INTERESTED_SCORE
        : INTENT_INTEREST_NEUTRAL;
  } else {
    intentInterestScore = negativeNotInterested ? INTENT_NOT_INTERESTED_SCORE : INTENT_INTEREST_NEUTRAL;
  }

  return {
    summary:
      typeof leadIntelligence.summary === "string"
        ? leadIntelligence.summary
        : negativeNotInterested
          ? "User appears not interested right now."
          : "Intent appears exploratory with limited buying signal.",
    primary_intent:
      leadIntelligence.primary_intent ||
      intentResult.intent ||
      "GENERAL_QUESTION",
    buying_signal_score: Math.round(
      clampScore(
        toNumber(
          leadIntelligence.buying_signal_score,
          negativeNotInterested
            ? 10
            : intentResult.intent === "APPOINTMENT_ACTION"
              ? 75
              : 45,
        ),
      ),
    ),
    clarity_score: Math.round(
      clampScore(
        toNumber(
          leadIntelligence.clarity_score,
          messageText?.trim()?.length > 24 ? 55 : 35,
        ),
      ),
    ),
    conversation_lead_score: conversationLeadScore,
    intent_interest_score: intentInterestScore,
    timeline_mentioned:
      leadIntelligence.timeline_mentioned === true || Boolean(timeline),
    budget_mentioned:
      leadIntelligence.budget_mentioned === true || Boolean(budget),
    authority_mentioned: leadIntelligence.authority_mentioned === true,
    negative_not_interested: negativeNotInterested,
    negative_irrelevant: leadIntelligence.negative_irrelevant === true,
    confidence: Number(
      clampScore(toNumber(leadIntelligence.confidence, 0.5) * 100) / 100,
    ),
    entities: {
      timeline,
      budget,
      use_case: useCase,
    },
  };
};

const computeIntentComponentScore = (
  intentSignals,
  intentCategory = "GENERAL_QUESTION",
) => {
  if (!intentSignals) return INTENT_NEUTRAL_SCORE;

  const directConversationScore = toOptionalScore(
    intentSignals.conversation_lead_score,
  );

  let score = directConversationScore;
  if (score === null) {
    const qualifierCount = [
      intentSignals.timeline_mentioned,
      intentSignals.budget_mentioned,
      intentSignals.authority_mentioned,
    ].filter(Boolean).length;

    const qualifierScore = (qualifierCount / 3) * 100;

    score =
      toNumber(intentSignals.buying_signal_score, 0) * 0.45 +
      toNumber(intentSignals.clarity_score, 0) * 0.25 +
      qualifierScore * 0.3;
  }

  if (intentSignals.negative_not_interested) {
    score -= INTENT_NEGATIVE_PENALTY;
  }

  if (intentCategory === "APPOINTMENT_ACTION") {
    score += APPOINTMENT_INTENT_BONUS;
  }

  return Math.round(clampScore(score));
};

const applyConfidenceGating = (
  intentScore,
  confidence,
  { isNegativeIntent = false } = {},
) => {
  const boundedConfidence = Math.max(0, Math.min(1, toNumber(confidence, 0.5)));

  if (boundedConfidence >= INTENT_LOW_CONFIDENCE_THRESHOLD) {
    return {
      adjustedScore: Math.round(clampScore(intentScore)),
      wasGated: false,
      gateSkippedForNegative: false,
    };
  }

  if (isNegativeIntent) {
    return {
      adjustedScore: Math.round(clampScore(intentScore)),
      wasGated: false,
      gateSkippedForNegative: true,
    };
  }

  const centeredDelta = intentScore - INTENT_NEUTRAL_SCORE;
  const gatedScore =
    INTENT_NEUTRAL_SCORE + centeredDelta * INTENT_LOW_CONFIDENCE_PULL_FACTOR;

  return {
    adjustedScore: Math.round(clampScore(gatedScore)),
    wasGated: true,
    gateSkippedForNegative: false,
  };
};

// Business-type-aware composite score: uses profile weights
const computeFinalCompositeScore = (recencyComponent, conversationComponent, intentInterestComponent, profile = SCORING_PROFILES.default) => {
  const w = profile.weights;
  const r = clampScore(recencyComponent);
  const c = clampScore(conversationComponent);
  const ii = clampScore(intentInterestComponent);
  const rawScore =
    r * w.recency +
    c * w.conversation +
    ii * w.interest;

  return {
    rawScore: Number(rawScore.toFixed(2)),
    finalScore: Math.round(clampScore(rawScore)),
  };
};

const fetchMessageForIntentScoring = async (
  tenant_id,
  contact_id,
  message_id = null,
  message_text = null,
) => {
  if (typeof message_text === "string" && message_text.trim().length > 0) {
    return {
      message_id,
      message_text: message_text.trim(),
    };
  }

  let query = `
    SELECT id, message
    FROM ${tableNames.MESSAGES}
    WHERE tenant_id = ? AND contact_id = ? AND sender = 'user' AND is_deleted = false
  `;
  const replacements = [tenant_id, contact_id];

  if (message_id) {
    query += " AND id = ?";
    replacements.push(message_id);
  }

  query += " ORDER BY created_at DESC LIMIT 1";

  const [rows] = await db.sequelize.query(query, {
    replacements,
  });

  if (!rows?.length || !rows[0]?.message) {
    return null;
  }

  return {
    message_id: rows[0].id,
    message_text: rows[0].message,
  };
};

const extractIntentSignalsForLead = async (
  tenant_id,
  contact_id,
  message_id = null,
  message_text = null,
) => {
  try {
    const messageContext = await fetchMessageForIntentScoring(
      tenant_id,
      contact_id,
      message_id,
      message_text,
    );

    if (!messageContext?.message_text) {
      return null;
    }

    const memory = await getConversationMemory(tenant_id, null, contact_id);
    const chatHistory = buildChatHistory(memory).slice(-8);

    const intentResult = await classifyIntent(
      messageContext.message_text,
      chatHistory,
      tenant_id,
    );

    return {
      message_id: messageContext.message_id,
      message_text: messageContext.message_text,
      intentResult,
      intentSignals: normalizeIntentSignals(
        intentResult,
        messageContext.message_text,
      ),
    };
  } catch (err) {
    console.error("[LEAD-SCORE] Failed to extract intent signals:", err.message);
    return null;
  }
};

const persistMessageUnderstanding = async (
  tenant_id,
  contact_id,
  lead_id,
  intentExtraction,
) => {
  if (!intentExtraction?.message_id) {
    return;
  }

  const signals = intentExtraction.intentSignals;

  try {
    await db.MessageUnderstanding.upsert({
      tenant_id,
      contact_id,
      lead_id,
      message_id: intentExtraction.message_id,
      source: "classifier",
      summary: signals.summary,
      primary_intent: signals.primary_intent,
      buying_signal_score: signals.buying_signal_score,
      clarity_score: signals.clarity_score,
      conversation_lead_score: signals.conversation_lead_score,
      intent_interest_score: signals.intent_interest_score ?? null,
      timeline_mentioned: signals.timeline_mentioned,
      budget_mentioned: signals.budget_mentioned,
      authority_mentioned: signals.authority_mentioned,
      use_case: signals.entities?.use_case || null,
      timeline: signals.entities?.timeline || null,
      budget: signals.entities?.budget || null,
      confidence: Number(toNumber(signals.confidence, 0.5).toFixed(2)),
      negative_not_interested: signals.negative_not_interested,
      negative_irrelevant: signals.negative_irrelevant,
      raw_payload: {
        intent: intentExtraction.intentResult?.intent,
        requires: intentExtraction.intentResult?.requires,
        lead_intelligence: intentExtraction.intentResult?.lead_intelligence,
      },
    });
  } catch (err) {
    console.error(
      "[LEAD-SCORE] Failed to persist message understanding:",
      err.message,
    );
  }
};

const persistLeadScoreHistory = async ({
  tenant_id,
  contact_id,
  lead_id,
  previousFinal,
  rawScore,
  recencyComponent,
  conversationComponent,
  intentInterestComponent,
  confidence,
  finalScore,
  finalStatus,
  reasonCodes,
  sourceEvent,
}) => {
  try {
    await db.LeadScoreHistory.create({
      tenant_id,
      contact_id,
      lead_id,
      previous_final_score: Math.round(clampScore(previousFinal)),
      raw_score: Number(rawScore.toFixed(2)),
      recency_component: Math.round(clampScore(recencyComponent)),
      // legacy intent_component mirrors conversation for backward compat
      intent_component: Math.round(clampScore(conversationComponent)),
      conversation_component: Math.round(clampScore(conversationComponent)),
      intent_interest_component: Math.round(clampScore(intentInterestComponent)),
      confidence: Number(toNumber(confidence, 0.5).toFixed(2)),
      final_score: Math.round(clampScore(finalScore)),
      final_status: finalStatus,
      reason_codes: reasonCodes,
      source_event: sourceEvent,
    });
  } catch (err) {
    console.error("[LEAD-SCORE] Failed to persist score history:", err.message);
  }
};

const applyCompositeLeadScoreUpdate = async (
  tenant_id,
  contact_id,
  {
    sourceEvent,
    markUserMessageAt = false,
    markAdminReplyAt = false,
    summaryStatus = "new",
    message_id = null,
    message_text = null,
    intentResult = null,
    skipIntentAi = false,
  } = {},
) => {
  const lead = await getLeadByContactIdService(tenant_id, contact_id);

  if (!lead) {
    return null;
  }

  // ── Load business-type scoring profile (cached 30 min) ──
  const profile = await getTenantScoringProfile(tenant_id);
  const businessType = getTenantBusinessType(tenant_id);

  const now = new Date();
  // Recency anchor: prefer last_user_message_at → lead.created_at → now
  const recencyAnchor = markUserMessageAt
    ? now
    : lead.last_user_message_at || lead.created_at || now;
  // Use profile-specific decay rate
  const { heat_state, heat_score } = calculateHeatState(recencyAnchor, profile.decayLambda);

  const previousFinalScore = toNumber(
    lead.lead_score_final,
    toNumber(lead.score, heat_score),
  );
  const previousConversationComponent = toNumber(
    lead.lead_score_conversation_component,
    INTENT_NEUTRAL_SCORE,
  );
  const previousIntentInterestComponent = toNumber(
    lead.lead_score_intent_interest_component,
    INTENT_INTEREST_NEUTRAL,
  );
  const previousConfidence = toNumber(lead.lead_score_confidence, 0.5);

  let conversationComponent = previousConversationComponent;
  let intentInterestComponent = previousIntentInterestComponent;
  let confidence = previousConfidence;
  const reasonCodes = [];

  let intentExtraction = null;
  let intentCategory = "GENERAL_QUESTION";

  if (sourceEvent === "user_message") {
    if (intentResult) {
      intentExtraction = {
        message_id,
        message_text,
        intentResult,
        intentSignals: normalizeIntentSignals(intentResult, message_text || ""),
      };
    } else if (!skipIntentAi) {
      intentExtraction = await extractIntentSignalsForLead(
        tenant_id,
        contact_id,
        message_id,
        message_text,
      );
    }

    if (intentExtraction?.intentSignals) {
      const intentSignals = intentExtraction.intentSignals;
      intentCategory = intentExtraction.intentResult?.intent || "GENERAL_QUESTION";

      // --- Conversation leadscore component ---
      const directConversationScore = toOptionalScore(intentSignals.conversation_lead_score);
      if (directConversationScore !== null) {
        conversationComponent = directConversationScore;
        reasonCodes.push(`intent_conversation_direct_${directConversationScore}`);
      } else {
        reasonCodes.push("intent_conversation_fallback");
      }

      // --- Intent-interest score component ---
      const directInterestScore = toOptionalScore(intentSignals.intent_interest_score);
      if (directInterestScore !== null) {
        intentInterestComponent = directInterestScore;
        reasonCodes.push(`intent_interest_score_${directInterestScore}`);
      } else if (intentSignals.negative_not_interested) {
        intentInterestComponent = INTENT_NOT_INTERESTED_SCORE;
        reasonCodes.push("intent_interest_not_interested_fallback");
      } else {
        reasonCodes.push("intent_interest_neutral_fallback");
      }

      // ── Signal Boost Floors (business-type-aware) ──
      // Prevents AI model score compression from under-scoring strong leads.
      // Only applied when hard evidence exists (budget/timeline/booking intent).
      if (intentSignals.budget_mentioned && conversationComponent < profile.signalBoosts.budget) {
        conversationComponent = profile.signalBoosts.budget;
        reasonCodes.push(`boost_budget_floor_${profile.signalBoosts.budget}`);
      }
      if (intentSignals.timeline_mentioned && conversationComponent < profile.signalBoosts.timeline) {
        conversationComponent = profile.signalBoosts.timeline;
        reasonCodes.push(`boost_timeline_floor_${profile.signalBoosts.timeline}`);
      }
      if (intentCategory === "APPOINTMENT_ACTION") {
        conversationComponent = Math.max(conversationComponent, profile.signalBoosts.booking);
        intentInterestComponent = Math.max(intentInterestComponent, profile.signalBoosts.booking);
        reasonCodes.push(`boost_booking_floor_${profile.signalBoosts.booking}`);
      }

      confidence = toNumber(intentSignals.confidence, previousConfidence);

      reasonCodes.push(
        `intent_primary_${String(intentSignals.primary_intent || "unknown")
          .toLowerCase()
          .replace(/\s+/g, "_")}`,
      );

      if (intentSignals.timeline_mentioned) reasonCodes.push("intent_timeline");
      if (intentSignals.budget_mentioned) reasonCodes.push("intent_budget");
      if (intentSignals.authority_mentioned) reasonCodes.push("intent_authority");
      if (intentCategory === "APPOINTMENT_ACTION") {
        reasonCodes.push(`intent_bonus_appointment`);
      }
      if (intentSignals.negative_not_interested) {
        reasonCodes.push("intent_negative_not_interested");
      }

      await persistMessageUnderstanding(
        tenant_id,
        contact_id,
        lead.lead_id,
        intentExtraction,
      );
    } else {
      reasonCodes.push("intent_reused_previous_components");
    }
  } else {
    reasonCodes.push("intent_reused_previous_components");
  }

  // ── Compute final score using profile-specific weights ──
  const scoreBreakdown = computeFinalCompositeScore(heat_score, conversationComponent, intentInterestComponent, profile);
  const boundedRawScore = scoreBreakdown.rawScore;
  const finalScore = scoreBreakdown.finalScore;
  const finalStatus = deriveFinalStatus(finalScore, profile.hotThreshold);

  const w = profile.weights;
  reasonCodes.push(`recency_band_${heat_state}`);
  reasonCodes.push(`profile_${businessType}`);
  reasonCodes.push(`weights_${Math.round(w.recency * 100)}r_${Math.round(w.conversation * 100)}c_${Math.round(w.interest * 100)}ii`);
  if (sourceEvent === "cron_decay") {
    reasonCodes.push("cron_recency_decay");
  }

  const finalReasonCodes = [...new Set(reasonCodes)];

  const updatePayload = {
    heat_state,
    score: Math.round(clampScore(heat_score)),
    lead_score_recency_component: Math.round(clampScore(heat_score)),
    lead_score_conversation_component: Math.round(clampScore(conversationComponent)),
    lead_score_intent_interest_component: Math.round(clampScore(intentInterestComponent)),
    // legacy field — mirrors conversation component for backward compat
    lead_score_intent_component: Math.round(clampScore(conversationComponent)),
    lead_score_confidence: Number(toNumber(confidence, 0.5).toFixed(2)),
    lead_score_raw: Number(boundedRawScore.toFixed(2)),
    lead_score_final: finalScore,
    lead_status_final: finalStatus,
    lead_score_reason_codes: finalReasonCodes,
    lead_score_updated_at: now,
  };

  if (summaryStatus) {
    updatePayload.summary_status = summaryStatus;
  }
  if (markUserMessageAt) {
    updatePayload.last_user_message_at = now;
  }
  if (markAdminReplyAt) {
    updatePayload.last_admin_reply_at = now;
  }

  const [affectedRows] = await db.Leads.update(updatePayload, {
    where: {
      tenant_id,
      contact_id,
      is_deleted: false,
    },
  });

  await persistLeadScoreHistory({
    tenant_id,
    contact_id,
    lead_id: lead.lead_id,
    previousFinal: previousFinalScore,
    rawScore: boundedRawScore,
    recencyComponent: heat_score,
    conversationComponent,
    intentInterestComponent,
    confidence,
    finalScore,
    finalStatus,
    reasonCodes: finalReasonCodes,
    sourceEvent,
  });

  return { affectedRows };
};

export const createLeadService = async (
  tenant_id,
  contact_id,
  source = "none",
) => {
  try {
    const lead_id = await generateReadableIdFromLast(
      tableNames.LEADS,
      "lead_id",
      "L",
      3,
    );

    const Query = `
    INSERT INTO ${tableNames?.LEADS} 
    (tenant_id, contact_id, lead_id, source, last_user_message_at) 
    VALUES (?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE updated_at = NOW()
  `;

    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, contact_id, lead_id, source],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getLeadByLeadIdService = async (tenant_id, lead_id) => {
  const dataQuery = `
    SELECT 
      led.lead_id,
      led.contact_id,
      led.tenant_id,
      led.status,
      led.heat_state,
      led.score,
      led.lead_score_final,
      led.lead_score_raw,
      led.lead_score_recency_component,
      led.lead_score_intent_component,
      led.lead_score_conversation_component,
      led.lead_score_intent_interest_component,
      led.lead_score_confidence,
      led.lead_status_final,
      led.lead_score_reason_codes,
      led.lead_score_updated_at,
      led.ai_summary,
      led.summary_status,
      led.last_user_message_at,
      led.last_admin_reply_at,
      led.ai_summary_created_at,
      led.created_at as lead_created_at,
      cta.name,
      cta.phone,
      cta.email,
      cta.profile_pic,
      led.lead_stage,
      led.assigned_to,
      agent.username AS assigned_agent_name,
      led.source,
      led.priority,
      led.internal_notes
    FROM ${tableNames?.LEADS} as led
    LEFT JOIN ${tableNames?.CONTACTS} as cta on (cta.contact_id = led.contact_id AND cta.tenant_id = led.tenant_id)
    LEFT JOIN ${tableNames?.TENANT_USERS} as agent on (agent.tenant_user_id = led.assigned_to)
    WHERE led.tenant_id = ? AND led.lead_id = ? AND led.is_deleted = false
    LIMIT 1`;

  try {
    const [leads] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id, lead_id],
    });

    if (!leads.length) {
      return null;
    }

    const lead = normalizeLeadScoreFields(leads[0]);

    // Fetch last 4 messages for this lead (MySQL 5.7 compatible)
    const messagesQuery = `
      SELECT contact_id, sender, message, created_at FROM (
        SELECT contact_id, sender, message, created_at
        FROM ${tableNames.MESSAGES}
        WHERE tenant_id = ? AND contact_id = ?
        ORDER BY created_at DESC
        LIMIT 4
      ) as recent
      ORDER BY created_at ASC
    `;

    const [messages] = await db.sequelize.query(messagesQuery, {
      replacements: [tenant_id, lead.contact_id],
    });

    return {
      ...lead,
      last_messages: messages || [],
    };
  } catch (err) {
    throw err;
  }
};

export const getLeadByContactIdService = async (tenant_id, contact_id) => {
  const Query = `
  SELECT * FROM ${tableNames?.LEADS} WHERE tenant_id = ? AND contact_id = ? AND is_deleted = false LIMIT 1`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, contact_id],
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getLeadListService = async (tenant_id) => {
  const dataQuery = `
  SELECT 
    led.lead_id,
    led.contact_id,
    led.tenant_id,
    led.status,
    led.heat_state,
    led.score,
    led.lead_score_final,
    led.lead_score_raw,
    led.lead_score_recency_component,
    led.lead_score_intent_component,
    led.lead_score_conversation_component,
    led.lead_score_intent_interest_component,
    led.lead_score_confidence,
    led.lead_status_final,
    led.lead_score_reason_codes,
    led.lead_score_updated_at,
    led.ai_summary,
    led.summary_status,
    led.last_user_message_at,
    led.last_admin_reply_at,
    led.ai_summary_created_at,
    led.created_at as lead_created_at,
    cta.name,
    cta.phone,
    cta.email,
    cta.profile_pic,
    led.lead_stage,
    led.assigned_to,
    agent.username AS assigned_agent_name,
    led.source,
    led.priority,
    led.internal_notes
  FROM ${tableNames?.LEADS} as led
  LEFT JOIN ${tableNames?.CONTACTS} as cta on (cta.contact_id = led.contact_id AND cta.tenant_id = led.tenant_id)
  LEFT JOIN ${tableNames?.TENANT_USERS} as agent on (agent.tenant_user_id = led.assigned_to)
  WHERE led.tenant_id = ? AND led.is_deleted = false
  ORDER BY led.last_user_message_at DESC`;

  try {
    const [leads] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id],
    });

    const normalizedLeads = leads.map(normalizeLeadScoreFields);

    if (!normalizedLeads.length) {
      return { leads: [] };
    }

    // 2. Fetch last 4 messages for these leads for preview
    const contactIds = normalizedLeads.map((l) => l.contact_id);
    const messagesQuery = `
      SELECT m.contact_id, m.sender, m.message, m.created_at
      FROM ${tableNames.MESSAGES} m
      INNER JOIN (
        SELECT contact_id, MAX(created_at) as max_created
        FROM ${tableNames.MESSAGES}
        WHERE tenant_id = ? AND contact_id IN (?)
        GROUP BY contact_id
      ) latest ON m.contact_id = latest.contact_id
      WHERE m.tenant_id = ? AND m.contact_id IN (?)
        AND m.created_at >= DATE_SUB(latest.max_created, INTERVAL 7 DAY)
      ORDER BY m.contact_id, m.created_at DESC
    `;

    const [allMessages] = await db.sequelize.query(messagesQuery, {
      replacements: [tenant_id, contactIds, tenant_id, contactIds],
    });

    // 3. Group messages by contact_id, keep last 4, and reverse to chronological
    const messagesMap = {};
    for (const msg of allMessages) {
      if (!messagesMap[msg.contact_id]) messagesMap[msg.contact_id] = [];
      if (messagesMap[msg.contact_id].length < 4) {
        messagesMap[msg.contact_id].push(msg);
      }
    }
    for (const cid in messagesMap) {
      messagesMap[cid].reverse();
    }

    const leadsWithMessages = normalizedLeads.map((lead) => ({
      ...lead,
      last_messages: messagesMap[lead.contact_id] || [],
    }));

    return {
      leads: leadsWithMessages,
    };
  } catch (err) {
    console.error("Error in getLeadListService:", err.message);
    throw err;
  }
};

export const updateLeadService = async (
  tenant_id,
  contact_id,
  options = {},
) => {
  try {
    return await applyCompositeLeadScoreUpdate(tenant_id, contact_id, {
      sourceEvent: options.sourceEvent || "user_message",
      markUserMessageAt: true,
      markAdminReplyAt: false,
      summaryStatus: "new",
      message_id: options.message_id || null,
      message_text: options.message_text || null,
      intentResult: options.intentResult || null,
      skipIntentAi: options.skipIntentAi === true,
    });
  } catch (err) {
    console.error("[LEAD-SCORE] Error updating lead score:", err.message);
    throw err;
  }
};

export const updateAdminLeadService = async (
  tenant_id,
  contact_id,
  options = {},
) => {
  try {
    return await applyCompositeLeadScoreUpdate(tenant_id, contact_id, {
      sourceEvent: options.sourceEvent || "admin_message",
      markUserMessageAt: false,
      markAdminReplyAt: true,
      summaryStatus: "new",
      message_id: null,
      message_text: null,
    });
  } catch (err) {
    console.error("[LEAD-SCORE] Error updating admin lead score:", err.message);
    throw err;
  }
};

export const startLeadHeatDecayCronService = () => {
  cron.schedule("*/30 * * * *", async () => {
    try {
      console.log("[LEAD-SCORE] Heat decay cron started");

      const [leads] = await db.sequelize.query(
        `SELECT tenant_id, contact_id FROM ${tableNames.LEADS} WHERE is_deleted = false`,
      );

      let updated = 0;
      let failed = 0;
      const tenantsSeen = new Set();

      for (const lead of leads) {
        try {
          if (!tenantsSeen.has(lead.tenant_id)) {
            tenantsSeen.add(lead.tenant_id);
            const profile = await getTenantScoringProfile(lead.tenant_id);
            const btype = getTenantBusinessType(lead.tenant_id);
            console.log(`[LEAD-SCORE] Cron: tenant=${lead.tenant_id} profile=${btype} decay=${profile.decayLambda} threshold=${profile.hotThreshold}`);
          }
          await applyCompositeLeadScoreUpdate(lead.tenant_id, lead.contact_id, {
            sourceEvent: "cron_decay",
            markUserMessageAt: false,
            markAdminReplyAt: false,
            summaryStatus: null,
            message_id: null,
            message_text: null,
          });
          updated++;
        } catch (leadErr) {
          failed++;
          console.error(`[LEAD-SCORE] Cron: failed for lead contact_id=${lead.contact_id}:`, leadErr.message);
        }
      }

      console.log(`[LEAD-SCORE] Heat decay cron finished — ${updated} updated, ${failed} failed, ${tenantsSeen.size} tenants`);
    } catch (err) {
      console.error("[LEAD-SCORE] Heat decay cron error:", err.message);
      throw err;
    }
  });
};

export const getBulkLeadSummaryService = async (
  tenant_id,
  lead_ids,
  mode = null,
  targetDate = null,
  startDateParam = null,
  endDateParam = null,
) => {
  try {
    if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
      throw new Error("Invalid lead_ids provided");
    }
    const Query = `
      SELECT led.lead_id, led.contact_id, cta.phone 
      FROM ${tableNames.LEADS} as led
      LEFT JOIN ${tableNames.CONTACTS} as cta ON (cta.contact_id = led.contact_id)
      WHERE led.tenant_id = ? AND led.lead_id IN (?) AND led.is_deleted = false
    `;

    const [leads] = await db.sequelize.query(Query, {
      replacements: [tenant_id, lead_ids],
    });

    if (!leads.length) {
      return [];
    }

    // 2. Process in parallel (Limit concurrency if needed, e.g. using p-limit or just Promise.all for small batches)
    // Assuming reasonable batch size from frontend (e.g. 5-10)
    const summaryPromises = leads.map(async (lead) => {
      try {
        if (!lead.phone) {
          return {
            lead_id: lead.lead_id,
            error: "Phone number not found for this lead",
          };
        }

        const result = await getLeadSummaryService(
          tenant_id,
          lead.phone,
          lead.lead_id,
          mode,
          targetDate,
          startDateParam,
          endDateParam,
          lead.contact_id,
        );

        return {
          lead_id: lead.lead_id,
          ...result,
        };
      } catch (err) {
        return {
          lead_id: lead.lead_id,
          error: err.message || "Failed to generate summary",
        };
      }
    });

    const results = await Promise.all(summaryPromises);
    return results;
  } catch (err) {
    console.error("Error in getBulkLeadSummaryService:", err);
    throw err;
  }
};

export const getLeadSummaryService = async (
  tenant_id,
  phone,
  lead_id = null,
  mode = null,
  targetDate = null,
  startDateParam = null,
  endDateParam = null,
  contact_id = null,
  { force = false } = {},
) => {
  try {
    const sanitize = (val) =>
      val === "null" || val === "undefined" || !val ? null : val;

    const cleanMode = sanitize(mode);
    const cleanTargetDate = sanitize(targetDate);
    const cleanStartDate = sanitize(startDateParam);
    const cleanEndDate = sanitize(endDateParam);

    const hasDateFilter = !!(cleanTargetDate || cleanStartDate || cleanEndDate);
    const resultingMode =
      cleanMode === "detailed" || hasDateFilter ? "filtered" : "overall";

    let startDate = cleanStartDate;
    let endDate = cleanEndDate;
    if (cleanTargetDate === "today") {
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
      startDate = endDate = today;
    } else if (cleanTargetDate === "yesterday") {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = endDate = yesterday.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
    } else if (cleanTargetDate && !cleanStartDate && !cleanEndDate) {
      startDate = endDate = cleanTargetDate;
    }

    let activeLeadId = lead_id;
    if (!activeLeadId && contact_id) {
      const lead = await getLeadByContactIdService(tenant_id, contact_id);
      activeLeadId = lead?.lead_id;
    }

    let currentLead = null;
    if (activeLeadId) {
      currentLead = await getLeadByLeadIdService(tenant_id, activeLeadId);
    }

    if (
      !force &&
      resultingMode === "overall" &&
      currentLead?.summary_status === "old" &&
      currentLead?.ai_summary
    ) {
      console.log(
        `[AI-SUMMARY] Cache Hit! Returning saved overall summary for lead: ${activeLeadId}`,
      );
      return {
        summary: currentLead.ai_summary,
        has_data: true,
        mode: "overall",
        date: null,
        cached: true,
        summary_created_at: currentLead.ai_summary_created_at,
      };
    }

    // Update lead_id to the resolved one for subsequent DB updates
    lead_id = activeLeadId;

    // 5. No cache? (Status is 'new' OR filters applied) -> Proceed with AI generation
    const memory = await getConversationMemory(
      tenant_id,
      phone,
      contact_id || currentLead?.contact_id,
    );

    if (!memory || memory.length === 0) {
      return {
        summary: "No conversation history available for this lead.",
        has_data: false,
      };
    }

    let filteredMemory = memory;
    let promptInstruction = "";
    const todayStr = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });

    // Re-apply date filters for memory slicing
    if (cleanTargetDate === "last_week") {
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);
      startDate = lastWeek.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
      endDate = todayStr;
    } else if (cleanTargetDate === "last_month") {
      const lastMonth = new Date();
      lastMonth.setDate(lastMonth.getDate() - 30);
      startDate = lastMonth.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
      endDate = todayStr;
    } else if (cleanTargetDate === "last_year") {
      const lastYear = new Date();
      lastYear.setDate(lastYear.getDate() - 365);
      startDate = lastYear.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
      endDate = todayStr;
    }

    if (startDate && endDate) {
      console.log(`Summary Filtering (IST): [${startDate}] to [${endDate}]`);
      filteredMemory = memory.filter((m) => {
        if (!m.created_at) return false;
        let msgDate = "";
        try {
          const dateObj = new Date(m.created_at);
          msgDate = dateObj.toLocaleDateString("en-CA", {
            timeZone: "Asia/Kolkata",
          });
        } catch (e) {
          return false;
        }
        return msgDate >= startDate && msgDate <= endDate;
      });

      if (filteredMemory.length === 0) {
        const rangeInfo =
          startDate === endDate
            ? `on ${startDate}`
            : `between ${startDate} and ${endDate}`;
        return {
          summary: `No interaction found ${rangeInfo}.`,
          has_data: false,
        };
      }

      promptInstruction = getLeadSummaryModeInstruction(
        cleanMode,
        startDate,
        endDate,
      );
    } else {
      // Default / Overall mode logic
      filteredMemory = memory.slice(-20);
      promptInstruction = getLeadSummaryModeInstruction(cleanMode, null, null);
    }

    const SUMMARIZE_PROMPT = getLeadSummarizePrompt(
      promptInstruction,
      JSON.stringify(filteredMemory, null, 2),
    );

    // 6. Generate Summary
    let aiSummary;
    try {
      aiSummary = await AiService(
        "system",
        SUMMARIZE_PROMPT,
        tenant_id,
        "lead_summary",
      );
    } catch (aiErr) {
      console.error("[AI-SUMMARY] AI generation failed:", aiErr.message);
      return {
        summary:
          "Unable to generate summary at this time. Please try again later.",
        has_data: false,
        mode: resultingMode,
        error: true,
      };
    }

    // 7. DB UPDATE LOGIC (Strictly Lazy)
    //    We ONLY update the DB if we are in 'overall' mode.
    //    Date-filtered summaries are temporary/view-only and should NOT overwrite the main status.
    let summaryCreatedAt = null;

    const isTodayFilter = startDate === todayStr && endDate === todayStr;

    if (
      lead_id &&
      (resultingMode === "overall" ||
        (isTodayFilter && currentLead?.summary_status === "new"))
    ) {
      try {
        const newStatus = force ? 'new' : 'old';
        // Update Summary + Set Status + Set Timestamp
        await db.sequelize.query(
          `UPDATE ${tableNames.LEADS} 
           SET ai_summary = ?, summary_status = ?, ai_summary_created_at = NOW()
           WHERE tenant_id = ? AND lead_id = ? AND is_deleted = false`,
          {
            replacements: [aiSummary, newStatus, tenant_id, lead_id],
            type: db.Sequelize.QueryTypes.UPDATE,
          },
        );
        summaryCreatedAt = new Date(); // Approximate timestamp for immediate return
        console.log(
          `[AI-SUMMARY] Saved usage-based summary & marked as '${newStatus}' for lead: ${lead_id} (Mode: ${resultingMode}, Force: ${force})`,
        );
      } catch (saveErr) {
        console.error("[AI-SUMMARY] Error saving summary:", saveErr.message);
      }
    } else {
      console.log(
        `[AI-SUMMARY] generated (Mode: ${resultingMode}, Status: ${currentLead?.summary_status}) - NOT saving to DB to preserve overall status.`,
      );
    }

    return {
      summary: aiSummary,
      has_data: true,
      mode: resultingMode,
      date: startDate === endDate ? startDate : null,
      summary_created_at:
        summaryCreatedAt || currentLead?.ai_summary_created_at,
    };
  } catch (err) {
    console.error("Error in getLeadSummaryService:", err);
    throw err;
  }
};

export const updateLeadStatusService = async (
  tenant_id,
  lead_id,
  status,
  heat_state,
  lead_stage = undefined,
  assigned_to = undefined,
  priority = undefined,
  source = undefined,
  internal_notes = undefined,
  summary_status = undefined,
) => {
  const updates = [];
  const replacements = [];

  if (status !== undefined) {
    updates.push("status = ?");
    replacements.push(status);
  }
  if (heat_state !== undefined) {
    updates.push("heat_state = ?");
    replacements.push(heat_state);
  }
  if (lead_stage !== undefined) {
    updates.push("lead_stage = ?");
    replacements.push(lead_stage);
  }
  if (assigned_to !== undefined) {
    updates.push("assigned_to = ?");
    replacements.push(assigned_to);
  }
  if (priority !== undefined) {
    updates.push("priority = ?");
    replacements.push(priority);
  }
  if (source !== undefined) {
    updates.push("source = ?");
    replacements.push(source);
  }
  if (internal_notes !== undefined) {
    updates.push("internal_notes = ?");
    replacements.push(internal_notes);
  }
  if (summary_status !== undefined) {
    updates.push("summary_status = ?");
    replacements.push(summary_status);
  }

  if (updates.length === 0) return null;

  const Query = `UPDATE ${tableNames?.LEADS} SET ${updates.join(", ")} WHERE tenant_id = ? AND lead_id = ? AND is_deleted = false`;
  replacements.push(tenant_id, lead_id);

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements,
    });

    // ─── SYNC WITH LIVECHAT ──────────────────────────────────────────────────
    if (assigned_to !== undefined) {
      const lead = await getLeadByLeadIdService(tenant_id, lead_id);
      if (lead?.contact_id) {
        const syncQuery = `UPDATE ${tableNames.LIVECHAT} SET assigned_admin_id = ? WHERE tenant_id = ? AND contact_id = ?`;
        await db.sequelize.query(syncQuery, {
          replacements: [assigned_to, tenant_id, lead.contact_id],
        });
      }
    }

    return result;
  } catch (err) {
    throw err;
  }
};

export const deleteLeadService = async (tenant_id, lead_id) => {
  const Query = `UPDATE ${tableNames?.LEADS} SET is_deleted = true, deleted_at = NOW() WHERE tenant_id = ? AND lead_id = ? AND is_deleted = false`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, lead_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const permanentDeleteLeadService = async (tenant_id, lead_id) => {
  const Query = `DELETE FROM ${tableNames?.LEADS} WHERE tenant_id = ? AND lead_id = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, lead_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const getDeletedLeadListService = async (tenant_id) => {
  const dataQuery = `
  SELECT 
    led.lead_id,
    led.contact_id,
    led.tenant_id,
    led.status,
    led.heat_state,
    led.score,
    led.lead_score_final,
    led.lead_score_raw,
    led.lead_score_recency_component,
    led.lead_score_intent_component,
    led.lead_score_conversation_component,
    led.lead_score_intent_interest_component,
    led.lead_score_confidence,
    led.lead_status_final,
    led.lead_score_reason_codes,
    led.lead_score_updated_at,
    led.ai_summary,
    led.summary_status,
    led.last_user_message_at,
    led.last_admin_reply_at,
    led.created_at as lead_created_at,
    cta.name,
    cta.phone,
    cta.email,
    cta.profile_pic,
    led.lead_stage,
    led.assigned_to,
    agent.username AS assigned_agent_name,
    led.source,
    led.priority,
    led.internal_notes,
    led.deleted_at
  FROM ${tableNames?.LEADS} as led
  LEFT JOIN ${tableNames?.CONTACTS} as cta on (cta.contact_id = led.contact_id AND cta.tenant_id = led.tenant_id)
  LEFT JOIN ${tableNames?.TENANT_USERS} as agent on (agent.tenant_user_id = led.assigned_to)
  WHERE led.tenant_id = ? AND led.is_deleted = true
  ORDER BY led.deleted_at DESC`;

  try {
    const [leads] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id],
    });

    const normalizedLeads = leads.map(normalizeLeadScoreFields);

    if (!normalizedLeads.length) {
      return { leads: [] };
    }

    // 2. Fetch last 4 messages per lead (MySQL 5.7 compatible)
    const contactIds = normalizedLeads.map((l) => l.contact_id);
    let messagesMap = {};

    if (contactIds.length > 0) {
      const messagesQuery = `
        SELECT m.contact_id, m.sender, m.message, m.created_at
        FROM ${tableNames.MESSAGES} m
        INNER JOIN (
          SELECT contact_id, MAX(created_at) as max_created
          FROM ${tableNames.MESSAGES}
          WHERE tenant_id = ? AND contact_id IN (?)
          GROUP BY contact_id
        ) latest ON m.contact_id = latest.contact_id
        WHERE m.tenant_id = ? AND m.contact_id IN (?)
        AND m.created_at >= DATE_SUB(latest.max_created, INTERVAL 7 DAY)
        ORDER BY m.contact_id, m.created_at DESC
      `;

      const [allMessages] = await db.sequelize.query(messagesQuery, {
        replacements: [tenant_id, contactIds, tenant_id, contactIds],
      });

      // Group by contact_id and keep only last 4 per contact
      const grouped = allMessages.reduce((acc, msg) => {
        if (!acc[msg.contact_id]) acc[msg.contact_id] = [];
        if (acc[msg.contact_id].length < 4) {
          acc[msg.contact_id].push(msg);
        }
        return acc;
      }, {});

      // Reverse to chronological order
      messagesMap = Object.fromEntries(
        Object.entries(grouped).map(([id, msgs]) => [id, msgs.reverse()]),
      );
    }

    const leadsWithMessages = normalizedLeads.map((lead) => ({
      ...lead,
      last_messages: messagesMap[lead.contact_id] || [],
    }));

    return {
      leads: leadsWithMessages,
    };
  } catch (err) {
    console.error("Error in getDeletedLeadListService:", err.message);
    throw err;
  }
};

export const restoreLeadService = async (lead_id, tenant_id) => {
  const Query = `UPDATE ${tableNames?.LEADS} SET is_deleted = false, deleted_at = NULL WHERE tenant_id = ? AND lead_id = ? AND is_deleted = true`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, lead_id],
    });

    if (result.affectedRows === 0) {
      throw new Error("Lead not found or not deleted");
    }

    return { message: "Lead restored successfully" };
  } catch (err) {
    throw err;
  }
};

export const bulkUpdateLeadsService = async (tenant_id, lead_ids, updates) => {
  if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0)
    return null;

  const setClauses = [];
  const replacements = [];

  if (updates.status) {
    setClauses.push("status = ?");
    replacements.push(updates.status);
  }
  if (updates.heat_state) {
    setClauses.push("heat_state = ?");
    replacements.push(updates.heat_state);
  }
  if (updates.lead_stage) {
    setClauses.push("lead_stage = ?");
    replacements.push(updates.lead_stage);
  }
  if (updates.assigned_to !== undefined) {
    setClauses.push("assigned_to = ?");
    replacements.push(updates.assigned_to);
  }
  if (updates.priority) {
    setClauses.push("priority = ?");
    replacements.push(updates.priority);
  }
  if (updates.source) {
    setClauses.push("source = ?");
    replacements.push(updates.source);
  }

  if (setClauses.length === 0) return null;

  const Query = `
    UPDATE ${tableNames.LEADS} 
    SET ${setClauses.join(", ")}, updated_at = NOW()
    WHERE tenant_id = ? AND lead_id IN (?) AND is_deleted = false
  `;

  replacements.push(tenant_id, lead_ids);

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements,
    });

    // ─── SYNC WITH LIVECHAT ──────────────────────────────────────────────────
    if (updates.assigned_to !== undefined) {
      const leadsQuery = `SELECT contact_id FROM ${tableNames.LEADS} WHERE tenant_id = ? AND lead_id IN (?)`;
      const [leads] = await db.sequelize.query(leadsQuery, {
        replacements: [tenant_id, lead_ids],
      });
      const contactIds = leads.map((l) => l.contact_id).filter(Boolean);

      if (contactIds.length > 0) {
        const syncQuery = `UPDATE ${tableNames.LIVECHAT} SET assigned_admin_id = ? WHERE tenant_id = ? AND contact_id IN (?)`;
        await db.sequelize.query(syncQuery, {
          replacements: [updates.assigned_to, tenant_id, contactIds],
        });
      }
    }

    return result;
  } catch (err) {
    throw err;
  }
};
