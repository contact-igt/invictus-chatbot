import { callAI } from "./coreAi.js";
import { getTenantSettingsService } from "../../models/TenantModel/tenant.service.js";
import { getDomainSummary } from "./domainContextHelper.js";

const VALID_INTENTS = ["APPOINTMENT_ACTION", "GENERAL_QUESTION"];

// Granular appointment intents used by the message pipeline/orchestrator
export const APPOINTMENT_INTENTS = [
  "create_appointment",
  "view_my_appointments",
  "reschedule_appointment",
  "cancel_appointment",
  "check_doctor_availability",
  "list_available_doctors",
  "get_doctor_info",
  "APPOINTMENT_ACTION",
];

// Fast greeting keywords to short-circuit simple messages and avoid AI calls
export const GREETING_KEYWORDS = [
  "hi",
  "hello",
  "hey",
  "start",
  "menu",
  "help",
  "helo",
  "hii",
];
const INTENT_CONFIDENCE_DEFAULT = 0.5;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Robustly parses JSON from AI model output.
 * Handles: trailing commas, JS comments, markdown fences, wrapping text,
 * and TRUNCATED JSON (missing closing brackets from token limit cutoff).
 */
const safeParseAIJson = (raw) => {
  if (!raw || typeof raw !== "string") throw new Error("Empty AI response");

  // 1. Try direct parse first (fast path)
  try {
    return JSON.parse(raw);
  } catch (_) {
    /* continue to sanitize */
  }

  let text = raw;

  // 2. Strip markdown code fences: ```json ... ```
  text = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");

  // 3. Strip single-line comments: // ...
  text = text.replace(/\/\/[^\n]*/g, "");

  // 4. Strip multi-line comments: /* ... */
  text = text.replace(/\/\*[\s\S]*?\*\//g, "");

  // 5. Remove trailing commas before } or ]
  text = text.replace(/,\s*([\]}])/g, "$1");

  // 6. Try parsing the cleaned text
  try {
    return JSON.parse(text);
  } catch (_) {
    /* continue */
  }

  let autoFixed = text.trim();
  autoFixed = autoFixed.replace(/,?\s*"[^"]*"?\s*:?\s*$/, "");
  autoFixed = autoFixed.replace(/,\s*$/, "");

  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  for (const ch of autoFixed) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") openBraces++;
    else if (ch === "}") openBraces--;
    else if (ch === "[") openBrackets++;
    else if (ch === "]") openBrackets--;
  }

  // Append missing closers
  for (let i = 0; i < openBrackets; i++) autoFixed += "]";
  for (let i = 0; i < openBraces; i++) autoFixed += "}";

  try {
    return JSON.parse(autoFixed);
  } catch (_) {
    /* continue */
  }

  // 8. Last resort: extract the first { ... } block and auto-close
  const match = text.match(/\{[\s\S]*/);
  if (match) {
    let block = match[0].replace(/,\s*([\]}])/g, "$1");
    // Recount and close
    let ob = 0,
      obk = 0;
    let inStr = false,
      esc = false;
    for (const ch of block) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "{") ob++;
      else if (ch === "}") ob--;
      else if (ch === "[") obk++;
      else if (ch === "]") obk--;
    }
    block = block.replace(/,?\s*"[^"]*"?\s*:?\s*$/, "").replace(/,\s*$/, "");
    for (let i = 0; i < obk; i++) block += "]";
    for (let i = 0; i < ob; i++) block += "}";
    return JSON.parse(block);
  }

  throw new Error("Could not extract valid JSON from AI response");
};

const parseScore = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(clamp(parsed, 0, 100));
};

const parseConfidence = (value, fallback = INTENT_CONFIDENCE_DEFAULT) => {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Number(clamp(parsed, 0, 1).toFixed(2));
};

const parseText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const detectNotInterested = (message = "") =>
  /(not interested|dont need|don't need|stop|unsubscribe|no thanks|not now|not looking)/i.test(
    message,
  );

const detectTimelineMention = (message = "") =>
  /(today|tomorrow|this week|next week|next month|asap|urgent|soon|date|slot|appointment)/i.test(
    message,
  );

const detectBudgetMention = (message = "") =>
  /(budget|price|cost|fees|pricing|amount|rs\.?|inr)/i.test(message);

const detectAuthorityMention = (message = "") =>
  /(i decide|decision maker|owner|my team|my family|my manager|my husband|my wife|approved)/i.test(
    message,
  );

// ── Tenant context cache (30-min TTL, avoids a DB call per message) ──────────
const TENANT_CONTEXT_CACHE = new Map(); // tenant_id → { context, orgContext, expiresAt }
const TENANT_CONTEXT_TTL_MS = 30 * 60 * 1000;

const TENANT_TYPE_CONTEXT_MAP = {
  hospital:
    "a hospital where patients book appointments with doctors and specialists",
  clinic:
    "a medical clinic offering treatments, consultations, and health check-ups",
  education:
    "an educational institution where students inquire about courses, admissions, fees, and enrolments",
  law: "a law firm where clients ask about legal services and book consultations with lawyers or advocates",
  organization:
    "a business that offers services and handles client inquiries, meetings, and bookings",
};

const buildBusinessContext = (tenantSettings) => {
  if (!tenantSettings) return "";
  const name = tenantSettings.company_name || "this business";
  // Full override via ai_settings.business_description
  const customDescription = tenantSettings.ai_settings?.business_description;
  if (
    customDescription &&
    typeof customDescription === "string" &&
    customDescription.trim()
  ) {
    return `You are working for "${name}", ${customDescription.trim()}.`;
  }
  // Extensible type via ai_settings.business_type (not limited to the DB ENUM)
  const aiType = tenantSettings.ai_settings?.business_type;
  if (aiType && typeof aiType === "string") {
    const mapped = TENANT_TYPE_CONTEXT_MAP[aiType.toLowerCase()];
    const description =
      mapped ||
      `a ${aiType} business that handles client inquiries and service bookings`;
    return `You are working for "${name}", ${description}.`;
  }
  // Fallback to tenant.type ENUM
  const enumType = tenantSettings.type;
  const description =
    TENANT_TYPE_CONTEXT_MAP[enumType] ||
    "a business that handles client inquiries and service bookings";
  return `You are working for "${name}", ${description}.`;
};

/**
 * Returns { context, orgContext } for a tenant.
 * - context: type-based business description ("You are working for X, a hospital...")
 * - orgContext: summarized domain knowledge (org prompt main points + KB topics)
 *   Built once by domainContextHelper and cached in ai_settings.domain_summary.
 */
const getTenantBusinessContext = async (tenant_id) => {
  if (!tenant_id) return { context: "", orgContext: "" };
  const cached = TENANT_CONTEXT_CACHE.get(tenant_id);
  if (cached && cached.expiresAt > Date.now())
    return { context: cached.context, orgContext: cached.orgContext };
  try {
    const [settings, domainSummary] = await Promise.all([
      getTenantSettingsService(tenant_id),
      getDomainSummary(tenant_id),
    ]);
    const context = buildBusinessContext(settings);
    const orgContext = domainSummary || "";
    TENANT_CONTEXT_CACHE.set(tenant_id, {
      context,
      orgContext,
      expiresAt: Date.now() + TENANT_CONTEXT_TTL_MS,
    });
    return { context, orgContext };
  } catch (err) {
    console.error(
      "[INTENT-CLASSIFIER] Failed to load tenant business context:",
      err.message,
    );
    return { context: "", orgContext: "" };
  }
};

// Intent interest score floor — minimum for any non-negative message
const INTENT_INTERESTED_SCORE = 82;
const INTENT_NOT_INTERESTED_SCORE = 20;
const INTENT_INTEREST_NEUTRAL = 70; // "hi", "yes", simple acks start at 70

const deriveIntentInterestScore = (
  negativeNotInterested,
  intent,
  userMessage = "",
) => {
  if (negativeNotInterested) return INTENT_NOT_INTERESTED_SCORE;
  if (intent === "APPOINTMENT_ACTION") return 92;
  // Budget/timeline mention = high domain interest
  if (detectBudgetMention(userMessage) || detectTimelineMention(userMessage))
    return 85;
  // Any domain question above greeting level
  if (userMessage && userMessage.trim().length > 10) return 75;
  // Simple greetings / acks still score 70 — they are not NOT interested
  return INTENT_INTEREST_NEUTRAL;
};

const getDefaultLeadIntelligence = (
  userMessage = "",
  intent = "GENERAL_QUESTION",
) => {
  const negativeNotInterested = detectNotInterested(userMessage);
  const timelineMentioned = detectTimelineMention(userMessage);
  const budgetMentioned = detectBudgetMention(userMessage);
  const authorityMentioned = detectAuthorityMention(userMessage);
  const baseConversationLeadScore = negativeNotInterested
    ? 10
    : intent === "APPOINTMENT_ACTION"
      ? 82
      : 50;

  return {
    summary: negativeNotInterested
      ? "User appears not interested right now."
      : "Intent appears exploratory with limited buying signal.",
    primary_intent: intent,
    buying_signal_score: negativeNotInterested
      ? 10
      : intent === "APPOINTMENT_ACTION"
        ? 75
        : 45,
    clarity_score: userMessage?.trim()?.length > 24 ? 55 : 35,
    conversation_lead_score: baseConversationLeadScore,
    intent_interest_score: deriveIntentInterestScore(
      negativeNotInterested,
      intent,
      userMessage,
    ),
    timeline_mentioned: timelineMentioned,
    budget_mentioned: budgetMentioned,
    authority_mentioned: authorityMentioned,
    negative_not_interested: negativeNotInterested,
    negative_irrelevant: false,
    confidence: 0.55,
    entities: {
      use_case: null,
      timeline: null,
      budget: null,
    },
  };
};

const normalizeLeadIntelligence = (rawValue, userMessage, intent) => {
  const defaults = getDefaultLeadIntelligence(userMessage, intent);
  const raw = rawValue && typeof rawValue === "object" ? rawValue : {};
  const entities =
    raw.entities && typeof raw.entities === "object" ? raw.entities : {};

  const timelineText = parseText(raw.timeline) || parseText(entities.timeline);
  const budgetText = parseText(raw.budget) || parseText(entities.budget);
  const useCaseText = parseText(raw.use_case) || parseText(entities.use_case);

  const negativeNotInterested =
    raw.negative_not_interested === true || detectNotInterested(userMessage);

  // Normalize intent_interest_score: prefer AI numeric 0-100, then binary map, then default
  const rawInterest = raw.intent_interest_score;
  let normalizedInterest;
  if (
    rawInterest !== null &&
    rawInterest !== undefined &&
    Number.isFinite(Number(rawInterest))
  ) {
    normalizedInterest = parseScore(
      rawInterest,
      defaults.intent_interest_score,
    );
  } else if (typeof raw.intent_interest === "string") {
    const label = raw.intent_interest.toUpperCase();
    normalizedInterest =
      label === "INTERESTED"
        ? INTENT_INTERESTED_SCORE
        : label === "NOT_INTERESTED"
          ? INTENT_NOT_INTERESTED_SCORE
          : defaults.intent_interest_score;
  } else {
    normalizedInterest = negativeNotInterested
      ? INTENT_NOT_INTERESTED_SCORE
      : defaults.intent_interest_score;
  }

  // Code-layer safety clamp: interest score is always 20-100
  normalizedInterest = Math.max(20, Math.min(100, normalizedInterest));

  return {
    summary: parseText(raw.summary) || defaults.summary,
    primary_intent: parseText(raw.primary_intent) || intent,
    buying_signal_score: parseScore(
      raw.buying_signal_score,
      defaults.buying_signal_score,
    ),
    clarity_score: parseScore(raw.clarity_score, defaults.clarity_score),
    conversation_lead_score: parseScore(
      raw.conversation_lead_score,
      defaults.conversation_lead_score,
    ),
    intent_interest_score: normalizedInterest,
    timeline_mentioned:
      raw.timeline_mentioned === true ||
      !!timelineText ||
      defaults.timeline_mentioned,
    budget_mentioned:
      raw.budget_mentioned === true ||
      !!budgetText ||
      defaults.budget_mentioned,
    authority_mentioned:
      raw.authority_mentioned === true || defaults.authority_mentioned,
    negative_not_interested: negativeNotInterested,
    negative_irrelevant: raw.negative_irrelevant === true,
    confidence: parseConfidence(raw.confidence, defaults.confidence),
    entities: {
      use_case: useCaseText,
      timeline: timelineText,
      budget: budgetText,
    },
  };
};

/**
 * Intent Classifier — Determines what context data the AI needs for this message.
 *
 * Returns the intent AND which data sources to load, so we skip unnecessary
 * DB calls and keep token usage low for simple messages.
 *
 * Uses the lightweight "input" model for fast, cheap classification.
 *
 * @param {string} userMessage - The current user message
 * @param {Array} chatHistory - Recent chat history [{role, content}]
 * @param {string} tenant_id - Tenant ID for model resolution
 * @returns {Promise<{intent: string, requires: {knowledge: boolean, doctors: boolean, appointments: boolean}, lead_intelligence: object}>}
 */
export const classifyIntent = async (
  userMessage,
  chatHistory = [],
  tenant_id,
) => {
  try {
    // Build recent context (last 8 messages to capture conversation trajectory)
    const recentContext = chatHistory
      .slice(-8)
      .map(
        (m) => `${m.role === "user" ? "Customer" : "Assistant"}: ${m.content}`,
      )
      .join("\n");

    const { context: businessContext, orgContext } =
      await getTenantBusinessContext(tenant_id);
    const prompt = buildClassifierPrompt(businessContext, orgContext)
      .replace("{RECENT_CONTEXT}", recentContext || "No previous messages.")
      .replace("{USER_MESSAGE}", userMessage);

    const result = await callAI({
      messages: [{ role: "system", content: prompt }],
      tenant_id,
      source: "classifier",
      temperature: 0,
      responseFormat: { type: "json_object" },
    });

    const parsed = safeParseAIJson(result.content);

    const intent = VALID_INTENTS.includes(parsed.intent)
      ? parsed.intent
      : "GENERAL_QUESTION";

    const requires = {
      knowledge: parsed.requires?.knowledge === true,
      doctors: parsed.requires?.doctors === true,
      appointments: parsed.requires?.appointments === true,
    };

    if (
      APPOINTMENT_INTENTS.includes(intent) ||
      intent === "APPOINTMENT_ACTION"
    ) {
      requires.knowledge = true;
      requires.doctors = true;
      requires.appointments = true;
    }

    const lead_intelligence = normalizeLeadIntelligence(
      parsed.lead_intelligence || parsed.leadIntelligence,
      userMessage,
      intent,
    );

    console.log(
      `[INTENT-CLASSIFIER] "${userMessage.substring(0, 60)}" → ${intent} | knowledge:${requires.knowledge} doctors:${requires.doctors} appointments:${requires.appointments} | conv:${lead_intelligence.conversation_lead_score} buy:${lead_intelligence.buying_signal_score} conf:${lead_intelligence.confidence}`,
    );

    return { intent, requires, lead_intelligence };
  } catch (err) {
    console.error("[INTENT-CLASSIFIER] Classification failed:", err.message);
    const fallbackIntent = "GENERAL_QUESTION";

    return {
      intent: fallbackIntent,
      requires: { knowledge: true, doctors: false, appointments: false },
      lead_intelligence: getDefaultLeadIntelligence(
        userMessage,
        fallbackIntent,
      ),
    };
  }
};

const buildClassifierPrompt = (businessContext = "", orgContext = "") => {
  const contextSection = businessContext
    ? `BUSINESS CONTEXT:\n${businessContext}\n\n`
    : "";

  const orgSection = orgContext
    ? `ORGANIZATION KNOWLEDGE (what this business actually offers — use this to judge if the customer's question is relevant):\n${orgContext}\n\n`
    : "";

  return `You are an Intent Classifier for a business WhatsApp chatbot.

${contextSection}${orgSection}TASK: Classify the customer's message AND determine which data sources the AI needs to answer it.

═══════════════════════════════════════════════════
INTENT VALUES (pick exactly one):
═══════════════════════════════════════════════════

APPOINTMENT_ACTION — The customer wants to actively book or engage:
- Book / schedule / enroll in a session, appointment, class, consultation, meeting, or demo
- Reschedule or cancel an existing booking / session / enrollment
- Check availability of staff, doctors, teachers, lawyers, or consultants for booking
- Provide information DURING an active booking or enrollment flow (name, date, time, slot, confirmation)

GENERAL_QUESTION — Everything else:
- Greetings, small talk ("hi", "hello", "thanks", "ok")
- Asking about services, programs, courses, prices, timings, policies, location, or eligibility
- Asking about staff or professionals (info only, not booking)
- Asking about their own bookings, sessions, or enrollment history (info only, not modifying)
- Any factual question about the business

view_my_appointments
  Customer wants to SEE their existing appointments.
  Examples: "show my appointments", "my bookings", "do I have any appointments?",
  "when is my next appointment?", "my appointment details"

"knowledge": true/false — Does the AI need uploaded business documents?
  true → questions about services, programs, courses, prices, timings, policies, location, procedures, fees, eligibility
  false → greetings, small talk, "ok", "thanks", "bye", simple acknowledgments

"doctors": true/false — Does the AI need information about the business's staff or professionals?
  true → questions about doctors, teachers, lawyers, consultants, trainers, advisors — their names, specializations, qualifications, experience, working hours, availability
  false → anything not specifically about staff or professionals

"appointments": true/false — Does the AI need this customer's own booking or session data?
  true → questions about their own bookings ("when is my session?", "do I have any enrollments?", "my appointment details")
  false → anything not about their personal booking status

CONTEXT RULES:
- Look at RECENT CONTEXT to detect if customer is mid-flow.
- If assistant just asked for booking/enrollment details and customer replied with info → APPOINTMENT_ACTION.
- "yes", "confirm", "book it", "cancel it", "enroll me" during active flow → APPOINTMENT_ACTION.
- Number reply ("1", "2", "3") during slot/option selection → APPOINTMENT_ACTION.
- Greetings are always GENERAL_QUESTION with all requires = false.
- If ambiguous → GENERAL_QUESTION.
- For APPOINTMENT_ACTION, ignore the requires flags (system will load everything).

RECENT CONTEXT:
{RECENT_CONTEXT}

CUSTOMER'S MESSAGE:
"{USER_MESSAGE}"

EXTRA TASK — LEAD SCORING (CRITICAL):
Estimate intent quality signals. Set negative_not_interested = true ONLY if the user explicitly says they are not interested or asks to stop. Use confidence 0-1.

YOU MUST ANALYSE ALL 8 MESSAGES IN "RECENT CONTEXT" + the BUSINESS CONTEXT / ORGANIZATION KNOWLEDGE above.
Score how engaged and ready this customer is. Be GENEROUS — lean toward higher scores.

━━━ conversation_lead_score (0-100) ━━━
Simple 4-level scoring. Read the last 8 messages and the business summary, then pick a level:

  NEGATIVE (0-30): Customer explicitly rejected — "not interested", "stop", "don't contact me".
    ONLY use this when there is CLEAR rejection. Nothing else goes here.

  LOW (31-55): Customer sent ONLY a bare greeting ("hi", "hello") with absolutely NO follow-up.
    No question asked, no context given, no engagement at all. Just a greeting and silence.

  GOOD (60-80) — THIS IS THE DEFAULT for most conversations:
    65 → Customer asked at least ONE question about anything
    70 → Customer asked about something related to what this business offers (use ORGANIZATION KNOWLEDGE to check)
    72 → Multi-turn conversation (2+ customer messages)
    75 → Customer asked about pricing, fees, availability, or specifics
    78 → Customer shared personal details OR asked follow-up questions
    80 → Customer asked 3+ questions across the conversation

  GREAT (81-100) — Customer is actively moving toward action:
    82 → Customer mentioned timeline, budget, or urgency
    85 → Customer asked multiple specific questions and is deepening engagement
    90 → Customer asked "how to apply?", "how to book?", "how to enroll?", "how to proceed?"
    95 → Customer confirmed: "book it", "enroll me", "yes confirm", "I want to pay"
    99 → Customer is mid-booking flow, actively completing an action

  RULES — KEEP IT SIMPLE:
  • DEFAULT is 65-75. Start here for any normal conversation.
  • Any question about the business = at least 65. Always.
  • 2+ customer messages = at least 72.
  • 3+ customer messages with questions = at least 78.
  • 5+ customer messages = at least 82.
  • "How to apply?", "enroll me", "book for me" = 90+ even if first message.
  • Do NOT go below 50 unless the customer ONLY said "hi" with zero follow-up.
  • Do NOT go below 30 unless the customer explicitly rejected.
  • Use ORGANIZATION KNOWLEDGE: if the customer asked about services this business ACTUALLY offers, boost +5 to +10.
  • Be generous. A customer chatting with a business is showing interest. Score them well.

━━━ intent_interest_score (20-100) ━━━
This score measures how interested the customer is in the business RIGHT NOW based on their latest message.
Do NOT go below 50 unless the customer explicitly shows they are NOT interested or disengaging.

FOUR LEVELS — pick the one that fits best:

  NOT INTERESTED (20-45):
    Use ONLY when the customer explicitly signals they want to stop or are not interested.
    20-30 → "not interested", "stop", "dont want", "don't contact me", "no thanks" , "BAD"
    31-45 → Clear conversation-ending signals: "I'll think about it", "not now", "will call you later"

  NORMAL / POSITIVE (70-75) — DEFAULT for most messages:
    Use for greetings, simple acknowledgments, and any positive response.
    70 → "hi", "hello", "yes", "ok", "sure", "please tell me more", "sounds good"
    72 → Customer responding to questions asked by the bot, providing their name/details during intake
    75 → Customer asking a general question about the business for the first time

  DOMAIN INTEREST (78-88) — Customer is asking something relevant:
    Use when the customer asks a question that is clearly about the business's services, products, or offerings.
    78 → General service/product question: "what do you offer?", "what courses do you have?"
    82 → Specific domain question: "tell me about CCOD", "what's the fee?", "who are your doctors?"
    85 → Deeper domain engagement: "what's included?", "how long is the course?", "when is the next batch?"
    88 → Budget/timeline: customer mentioned fees, pricing, schedule, or timeline

  READY TO ACT (90-100):
    99 → Customer is actively asking how to proceed or enroll
    99 → Customer has confirmed intent: "how to apply","apply now","I want to enroll", "book me a slot", "yes confirm"
    99 → Customer is mid-booking flow, providing details to complete an action

  RULES:
    • DEFAULT is 70-75. Start there unless there is a clear reason to go higher or lower.
    • Do NOT use scores below 50 unless the customer is explicitly not interested.
    • "hi", "yes", "ok", "please" → 70-72. These are POSITIVE signals, not neutral.
    • Any question about the business → 75-88 depending on specificity.
    • Only explicit rejection or conversation-ending signals → below 50.

  Examples:
    "hi" → 70
    "yes" → 71
    "ok thanks" (politely ending) → 50
    "not interested" → 0
    "what courses do you have?" → 88
    "I want to enroll, how do I proceed?" → 99
    "confirm my booking" → 100

Return ONLY valid JSON with this exact shape:
{
  "intent": "APPOINTMENT_ACTION" or "GENERAL_QUESTION",
  "requires": {
    "knowledge": true/false,
    "doctors": true/false,
    "appointments": true/false
  },
  "lead_intelligence": {
    "summary": "short one-line explanation of conversation trajectory and lead quality",
    "primary_intent": "short intent label",
    "buying_signal_score": 0-100,
    "clarity_score": 0-100,
    "conversation_lead_score": 0-100,
    "intent_interest_score": 20-100,
    "timeline_mentioned": true/false,
    "budget_mentioned": true/false,
    "authority_mentioned": true/false,
    "negative_not_interested": true/false,
    "negative_irrelevant": true/false,
    "confidence": 0-1,
    "entities": {
      "use_case": "string or null",
      "timeline": "string or null",
      "budget": "string or null"
    }
  }
}`;
};
