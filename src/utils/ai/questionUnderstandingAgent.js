import { callAI } from "./coreAi.js";
import { getDomainSummary } from "./domainContextHelper.js";

/**
 * Question Understanding Agent
 *
 * Runs ONLY after the main AI has already failed to answer a question
 * (i.e., MISSING_KNOWLEDGE tag was emitted). Classifies whether the
 * unanswered question is worth logging into FAQ Review.
 *
 * Uses the cheap 80-token input model — same budget as intentClassifier.
 * Domain context is loaded once from cache (tenants.ai_settings.domain_summary)
 * and reused, making this work for any tenant type without hardcoding.
 *
 * Output categories:
 *   valid_faq     — relevant to this business, unanswered, worth doctor review
 *   out_of_scope  — possibly medical/professional but outside this tenant's domain
 *   noise         — greeting, junk, random off-topic, irrelevant
 */

const CLASSIFIER_PROMPT = `You are a FAQ triage agent for a business WhatsApp assistant.

A customer asked a question that the AI could not answer from the knowledge base.
Your job is to decide if this question should be queued for a human expert to review and answer.

BUSINESS CONTEXT:
{DOMAIN_SUMMARY}

UNANSWERED QUESTION:
"{QUESTION}"

KNOWN TOPIC (from AI tag):
"{TOPIC}"

TASK:
Classify this question into ONE category:

valid_faq    → The question is relevant to this business's domain/services.
               It is a genuine customer question that a staff member or doctor could answer.
               Example: pricing, procedures, policies, service details, eligibility, preparation.

out_of_scope → The question looks professional or medical but belongs to a different domain
               (e.g., a different specialty, a different type of organization).
               Example: asking about heart surgery at an eye clinic, asking about school fees at a clinic.

noise        → The question is irrelevant, random, or not a genuine business inquiry.
               Example: jokes, greetings alone, weather, unrelated small talk, test messages.

RULES:
- Classify as valid_faq only when the question is genuinely useful for this specific business.
- Classify as out_of_scope when outside this business type/domain but looks like a real question.
- Classify as noise for everything else.
- Be strict: when in doubt between valid_faq and noise, prefer out_of_scope or noise.

Return ONLY valid JSON — no markdown, no explanation:
{"category": "valid_faq" | "out_of_scope" | "noise", "reason": "one sentence", "normalized_question": "clean rephrased version of the question"}`;

/**
 * Classifies an unanswered customer question to decide if it should go to FAQ Review.
 *
 * @param {string} question     - Original patient message
 * @param {string} topic        - Topic extracted from [MISSING_KNOWLEDGE: topic]
 * @param {string} tenantId     - Tenant ID for domain context lookup
 * @returns {Promise<{category: string, reason: string, normalized_question: string}>}
 */
export const classifyForFaq = async (question, topic, tenantId) => {
  try {
    const domainSummary = await getDomainSummary(tenantId);

    const prompt = CLASSIFIER_PROMPT
      .replace("{DOMAIN_SUMMARY}", domainSummary)
      .replace("{QUESTION}", question)
      .replace("{TOPIC}", topic || question);

    const result = await callAI({
      messages: [{ role: "user", content: prompt }],
      tenant_id: tenantId,
      source: "classifier",   // uses input model + 80 token budget
      temperature: 0,
      responseFormat: { type: "json_object" },
    });

    const parsed = JSON.parse(result.content);

    const validCategories = ["valid_faq", "out_of_scope", "noise"];
    const category = validCategories.includes(parsed.category)
      ? parsed.category
      : "noise";

    return {
      category,
      reason: parsed.reason?.substring(0, 300) || "",
      normalized_question: parsed.normalized_question?.substring(0, 500) || topic || question,
    };
  } catch (err) {
    console.error("[FAQ-CLASSIFIER] classifyForFaq failed:", err.message);
    // Fail safe: treat as noise so nothing is incorrectly queued
    return {
      category: "noise",
      reason: "Classifier error — defaulting to noise",
      normalized_question: topic || question,
    };
  }
};
