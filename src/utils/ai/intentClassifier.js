import { callAI } from "./coreAi.js";

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
 * @returns {Promise<{intent: string, requires: {knowledge: boolean, doctors: boolean, appointments: boolean}}>}
 */
export const classifyIntent = async (
  userMessage,
  chatHistory = [],
  tenant_id,
) => {
  try {
    // Build recent context (last 4 messages for conversation flow awareness)
    const recentContext = chatHistory
      .slice(-4)
      .map(
        (m) => `${m.role === "user" ? "Customer" : "Assistant"}: ${m.content}`,
      )
      .join("\n");

    const prompt = INTENT_CLASSIFIER_PROMPT.replace(
      "{RECENT_CONTEXT}",
      recentContext || "No previous messages.",
    ).replace("{USER_MESSAGE}", userMessage);

    const result = await callAI({
      messages: [{ role: "system", content: prompt }],
      tenant_id,
      source: "classifier",
      temperature: 0,
      responseFormat: { type: "json_object" },
    });

    const parsed = JSON.parse(result.content);

    // Validate intent
    const validIntents = ["APPOINTMENT_ACTION", "GENERAL_QUESTION"];
    const intent = validIntents.includes(parsed.intent)
      ? parsed.intent
      : "GENERAL_QUESTION";

    // Validate requires flags (default all false for safety — minimal tokens)
    const requires = {
      knowledge: parsed.requires?.knowledge === true,
      doctors: parsed.requires?.doctors === true,
      appointments: parsed.requires?.appointments === true,
    };

    // APPOINTMENT_ACTION always needs all context
    if (intent === "APPOINTMENT_ACTION") {
      requires.knowledge = true;
      requires.doctors = true;
      requires.appointments = true;
    }

    console.log(
      `[INTENT-CLASSIFIER] "${userMessage.substring(0, 60)}" → ${intent} | knowledge:${requires.knowledge} doctors:${requires.doctors} appointments:${requires.appointments}`,
    );

    return { intent, requires };
  } catch (err) {
    console.error("[INTENT-CLASSIFIER] Classification failed:", err.message);
    // Default: load knowledge only (covers most general questions, skips expensive doctor/appt calls)
    return {
      intent: "GENERAL_QUESTION",
      requires: { knowledge: true, doctors: false, appointments: false },
    };
  }
};

/**
 * Intent Classifier Prompt
 *
 * Classifies user messages and determines which data sources are needed.
 * This controls token usage — only load what's necessary.
 */
const INTENT_CLASSIFIER_PROMPT = `You are an Intent Classifier for a business WhatsApp chatbot.

TASK: Classify the customer's message AND determine which data sources the AI needs to answer it.

STEP 1 — Classify intent into ONE category:

APPOINTMENT_ACTION — The customer wants to:
- Book / schedule a new appointment
- Reschedule / update an existing appointment
- Cancel an existing appointment
- Check doctor availability or time slots for booking
- Provide information DURING an active appointment flow (name, age, date, time, slot number, confirmation)

GENERAL_QUESTION — Everything else:
- Greetings, small talk ("hi", "hello", "thanks", "ok")
- Asking about services, prices, timings, policies, location
- Asking about doctors (info only, not booking)
- Asking about their appointment history (info only, not modifying)
- Any factual question about the business

STEP 2 — Determine which data sources are needed (ONLY for GENERAL_QUESTION):

"knowledge": true/false — Does the AI need uploaded business documents?
  true → questions about services, prices, timings, policies, location, contact info, treatments, procedures
  false → greetings, small talk, "ok", "thanks", "bye", simple acknowledgments

"doctors": true/false — Does the AI need doctor information?
  true → questions about doctors, their names, specializations, qualifications, experience, working hours, availability days
  false → anything not about doctors

"appointments": true/false — Does the AI need this customer's appointment data?
  true → questions about their own appointments ("when is my appointment?", "do I have any bookings?", "my appointment details")
  false → anything not about their personal appointment status

CONTEXT RULES:
- Look at RECENT CONTEXT to detect if customer is mid-flow.
- If assistant just asked for appointment details and customer replies with info → APPOINTMENT_ACTION.
- "yes", "confirm", "book it", "cancel it" during active appointment flow → APPOINTMENT_ACTION.
- Number reply ("1", "2", "3") during slot selection → APPOINTMENT_ACTION.
- Greetings are always GENERAL_QUESTION with all requires = false.
- If ambiguous → GENERAL_QUESTION.
- For APPOINTMENT_ACTION, ignore the requires flags (system will load everything).

RECENT CONTEXT:
{RECENT_CONTEXT}

CUSTOMER'S MESSAGE:
"{USER_MESSAGE}"

Return ONLY valid JSON:
{"intent": "APPOINTMENT_ACTION" or "GENERAL_QUESTION", "requires": {"knowledge": true/false, "doctors": true/false, "appointments": true/false}}`;
