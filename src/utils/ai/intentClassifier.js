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

    // NEW: Expanded valid intents — granular appointment intents + greeting
    const validIntents = [ // NEW
      "APPOINTMENT_ACTION", // NEW — kept for backward compat
      "GENERAL_QUESTION", // NEW
      "greeting", // NEW
      "create_appointment", // NEW
      "view_my_appointments", // NEW
      "reschedule_appointment", // NEW
      "cancel_appointment", // NEW
      "check_doctor_availability", // NEW
      "list_available_doctors", // NEW
      "get_doctor_info", // NEW
    ]; // NEW
    const intent = validIntents.includes(parsed.intent) // NEW
      ? parsed.intent // NEW
      : "GENERAL_QUESTION"; // NEW

    // Validate requires flags (default all false for safety — minimal tokens)
    const requires = {
      knowledge: parsed.requires?.knowledge === true,
      doctors: parsed.requires?.doctors === true,
      appointments: parsed.requires?.appointments === true,
    };

    // NEW: Any appointment-family intent gets full context
    if (APPOINTMENT_INTENTS.includes(intent) || intent === "APPOINTMENT_ACTION") { // NEW
      requires.knowledge = true; // NEW
      requires.doctors = true; // NEW
      requires.appointments = true; // NEW
    } // NEW

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
 * Intent Classifier Prompt — expanded with granular appointment intents.
 * Controls token usage: only load data sources that are truly needed.
 */
// NEW: Expanded prompt with 9 intent values
const INTENT_CLASSIFIER_PROMPT = `You are an Intent Classifier for a business WhatsApp chatbot.

TASK: Classify the customer's message into EXACTLY ONE intent from the list below,
AND determine which data sources the AI needs.

═══════════════════════════════════════════════════
INTENT VALUES (pick exactly one):
═══════════════════════════════════════════════════

greeting
  Customer is greeting or wants the main menu.
  Examples: "hi", "hello", "hey", "start", "menu", "help", "good morning"

create_appointment
  Customer wants to BOOK a new appointment.
  Examples: "book appointment", "I need to see a doctor", "schedule with Dr. Smith",
  "appointment for tomorrow 3pm", "can I get an appointment?", "I want to visit the doctor"

view_my_appointments
  Customer wants to SEE their existing appointments.
  Examples: "show my appointments", "my bookings", "do I have any appointments?",
  "when is my next appointment?", "my appointment details"

reschedule_appointment
  Customer wants to CHANGE the date or time of an existing appointment.
  Examples: "reschedule my appointment", "change my appointment to Friday",
  "move my booking to 4pm", "I need to change my appointment time"

cancel_appointment
  Customer wants to CANCEL an existing appointment.
  Examples: "cancel my appointment", "I want to cancel", "cancel my booking",
  "cancel the Monday appointment", "don't want the appointment anymore"

check_doctor_availability
  Customer wants to know if a specific doctor or time slot is available.
  Examples: "is Dr. Smith available on Friday?", "any slots for Tuesday?",
  "when is Dr. Priya free?", "check availability for tomorrow"

list_available_doctors
  Customer wants a list of all doctors or doctors by specialty.
  Examples: "show me all doctors", "which doctors are available?",
  "list of doctors", "what doctors do you have?", "show cardiologists"

get_doctor_info
  Customer wants details about a specific doctor.
  Examples: "tell me about Dr. Smith", "Dr. Priya's specialization",
  "what is Dr. Ahmed's experience?", "info about the neurologist"

APPOINTMENT_ACTION
  Use ONLY when the customer is mid-booking-flow and providing information
  (name, age, date, time, slot number, "yes"/"no" confirmation).
  Examples: "my name is John", "age 35", "tomorrow", "3pm", "yes confirm it",
  "no cancel it", "slot 2"

GENERAL_QUESTION
  Everything else: questions about services, prices, timings, policies, location,
  business info, and anything not appointment-related.
  Examples: "what are your charges?", "where are you located?", "thanks", "ok"

═══════════════════════════════════════════════════
REQUIRES FLAGS (for GENERAL_QUESTION only — ignored for all others):
═══════════════════════════════════════════════════

"knowledge": true/false — needs uploaded business documents?
"doctors": true/false — needs doctor information?
"appointments": true/false — needs this customer's appointment history?

═══════════════════════════════════════════════════
CLASSIFICATION RULES:
═══════════════════════════════════════════════════
- Check RECENT CONTEXT first — if assistant just asked for booking info,
  a plain reply ("tomorrow", "age 30", "yes") → APPOINTMENT_ACTION
- "yes"/"confirm"/"ok" with no prior context → greeting
- Greeting is ALWAYS greeting, never APPOINTMENT_ACTION
- When ambiguous between appointment intents → create_appointment
- When ambiguous overall → GENERAL_QUESTION

RECENT CONTEXT:
{RECENT_CONTEXT}

CUSTOMER'S MESSAGE:
"{USER_MESSAGE}"

Return ONLY valid JSON (no markdown, no explanation):
{"intent": "<one of the 10 values above>", "requires": {"knowledge": true/false, "doctors": true/false, "appointments": true/false}}`; // NEW

// NEW: Granular appointment intents — checked in the message pipeline to route to orchestrator
export const APPOINTMENT_INTENTS = [ // NEW
  "create_appointment", // NEW
  "view_my_appointments", // NEW
  "reschedule_appointment", // NEW
  "cancel_appointment", // NEW
  "check_doctor_availability", // NEW
  "list_available_doctors", // NEW
  "get_doctor_info", // NEW
  "APPOINTMENT_ACTION", // NEW — kept so legacy callers still get routed
]; // NEW

// NEW: Greeting keywords for fast keyword check (avoids AI call for simple greetings)
export const GREETING_KEYWORDS = [ // NEW
  "hi", "hello", "hey", "start", "menu", "help", "helo", "hii", // NEW
]; // NEW
