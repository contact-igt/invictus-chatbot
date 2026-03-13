import axios from "axios";
import https from "https";
import OpenAI from "openai";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { detectLanguageAI } from "../../utils/ai/detectLanguageStyle.js";
import { buildChatHistory } from "../../utils/chat/buildChatHistory.js";
import { getActivePromptService } from "../AiPrompt/aiprompt.service.js";
import { processResponse } from "../../utils/ai/aiTagHandlers/index.js";
import { classifyResponse } from "../../utils/ai/responseClassifier.js";
import { handleClassification } from "../../utils/ai/classificationHandler.js";

import { getLeadByContactIdService } from "../LeadsModel/leads.service.js";
import { searchResolvedLogsService } from "../AiAnalysisLog/aiAnalysisLog.service.js";
import { getDoctorsForAIService } from "../DoctorModel/doctor.service.js";
import { getActiveAppointmentsByContactService } from "../AppointmentModel/appointment.service.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
});

export const sendWhatsAppMessage = async (tenant_id, to, message) => {
  try {
    if (!message || !message.trim()) return;

    const [rows] = await db.sequelize.query(
      `
    SELECT phone_number_id, access_token
    FROM ${tableNames.WHATSAPP_ACCOUNT}
    WHERE tenant_id = ?
      AND status = 'active'
    LIMIT 1
    `,
      { replacements: [tenant_id] },
    );

    if (!rows.length) {
      throw new Error("No active WhatsApp account for tenant");
    }

    const { phone_number_id, access_token } = rows[0];

    const META_API_VERSION = process.env.META_API_VERSION || "v22.0";
    console.log(
      `[SEND-MSG] Using Meta API version: ${META_API_VERSION}, phone_number_id: ${phone_number_id}, to: ${to}`,
    );

    let wamid = null;
    try {
      const response = await axios.post(
        `https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}/messages`,
        {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: message.trim() },
        },
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          httpsAgent,
        },
      );
      wamid = response?.data?.messages?.[0]?.id || null;
    } catch (axiosErr) {
      if (axiosErr.response) {
        console.error(
          "[SEND-MSG] Meta API Error:",
          JSON.stringify(axiosErr.response.data, null, 2),
        );
        const metaMsg =
          axiosErr.response.data?.error?.message || axiosErr.message;
        throw new Error(`Meta API Error: ${metaMsg}`);
      }
      throw axiosErr;
    }

    return { phone_number_id, wamid };
  } catch (err) {
    throw err;
  }
};

export const sendWhatsAppTemplate = async (
  tenant_id,
  to,
  templateName,
  languageCode,
  components,
) => {
  const [rows] = await db.sequelize.query(
    `
    SELECT phone_number_id, access_token
    FROM ${tableNames.WHATSAPP_ACCOUNT}
    WHERE tenant_id = ?
      AND status = 'active'
    LIMIT 1
    `,
    { replacements: [tenant_id] },
  );

  if (!rows.length) {
    throw new Error("No active WhatsApp account for tenant");
  }

  const { phone_number_id, access_token } = rows[0];

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode,
      },
      components: components || [],
    },
  };

  const META_API_VERSION = process.env.META_API_VERSION || "v22.0";
  console.log(
    `[SEND-TEMPLATE] Using Meta API version: ${META_API_VERSION}, phone_number_id: ${phone_number_id}, to: ${to}`,
  );

  try {
    const response = await axios.post(
      `https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        httpsAgent,
      },
    );

    const meta_message_id = response.data?.messages?.[0]?.id;

    return { phone_number_id, meta_message_id };
  } catch (error) {
    if (error.response) {
      console.error(
        "Meta API Error Details:",
        JSON.stringify(error.response.data, null, 2),
      );
      const message = error.response.data?.error?.message || error.message;
      throw new Error(`Meta API Error: ${message}`);
    }
    throw error;
  }
};

export const sendTypingIndicator = async (tenant_id, phone_number_id, to) => {
  try {
    const [rows] = await db.sequelize.query(
      `
    SELECT access_token
    FROM ${tableNames.WHATSAPP_ACCOUNT}
    WHERE tenant_id = ?
      AND phone_number_id = ?
      AND status = 'active'
    LIMIT 1
    `,
      { replacements: [tenant_id, phone_number_id] },
    );

    if (!rows.length) return;

    const META_API_VERSION = process.env.META_API_VERSION || "v22.0";
    await axios.post(
      `https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "typing",
      },
      {
        headers: {
          Authorization: `Bearer ${rows[0].access_token}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    throw err;
  }
};

export const isMessageProcessed = async (
  tenant_id,
  phone_number_id,
  message_id,
) => {
  try {
    const Query = `SELECT * FROM ${tableNames?.PROCESSEDMESSAGE} WHERE tenant_id = ? AND phone_number_id = ? AND message_id = ?`;

    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, phone_number_id, message_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const markMessageProcessed = async (
  tenant_id,
  phone_number_id,
  message_id,
  phone,
) => {
  try {
    const [result] = await db.sequelize.query(
      `INSERT IGNORE INTO ${tableNames.PROCESSEDMESSAGE}
     (tenant_id, phone_number_id, message_id, phone)
     VALUES (?, ?, ? , ?)`,
      { replacements: [tenant_id, phone_number_id, message_id, phone] },
    );
    return result;
  } catch (err) {
    throw err;
  }
};

export const isChatLocked = async (tenant_id, phone_number_id, phone) => {
  try {
    const [rows] = await db.sequelize.query(
      `
    SELECT 1
    FROM ${tableNames.CHATLOCKS}
    WHERE tenant_id = ?
      AND phone_number_id = ?
      AND phone = ?
      AND created_at > (NOW() - INTERVAL 15 SECOND)
    LIMIT 1
    `,
      { replacements: [tenant_id, phone_number_id, phone] },
    );

    return rows.length > 0;
  } catch (err) {
    throw err;
  }
};

export const lockChat = async (tenant_id, phone_number_id, phone) => {
  try {
    await db.sequelize.query(
      `
    INSERT IGNORE INTO ${tableNames.CHATLOCKS}
    (tenant_id, phone_number_id, phone)
    VALUES (?,?,?)
    `,
      { replacements: [tenant_id, phone_number_id, phone] },
    );
  } catch (err) {
    throw err;
  }
};

export const unlockChat = async (tenant_id, phone_number_id, phone) => {
  try {
    await db.sequelize.query(
      `
    DELETE FROM ${tableNames.CHATLOCKS}
    WHERE tenant_id = ?
      AND phone_number_id = ?
      AND phone = ?
    `,
      { replacements: [tenant_id, phone_number_id, phone] },
    );
  } catch (err) {
    throw err;
  }
};

export const getOpenAIReply = async (
  tenant_id,
  phone,
  userMessage,
  contact_id = null,
  phone_number_id = null,
) => {
  try {
    if (!userMessage) return null;

    const cleanMessage = userMessage.trim();
    if (!cleanMessage) return null;

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
    );

    const currentDateFormatted = now.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    const currentDayFormatted = now.toLocaleDateString("en-US", {
      weekday: "long",
    });

    const currentTimeFormatted = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const languageInfo = await detectLanguageAI(cleanMessage);

    console.log("language", languageInfo);

    const memory = await getConversationMemory(tenant_id, phone);
    const chatHistory = buildChatHistory(memory);

    const hospitalPrompt =
      (await getActivePromptService(tenant_id)) ||
      "You are a hospital front-desk assistant.";

    const chunks = await searchKnowledgeChunks(tenant_id, cleanMessage);

    // NEW: Fetch resolved logs
    const resolvedLogs = await searchResolvedLogsService(tenant_id, 5);
    const resolvedContext = resolvedLogs
      .map(
        (log) =>
          `[Previous Question]: ${log.user_message}\n[Admin Resolution]: ${log.resolution}`,
      )
      .join("\n\n");

    const knowledgeContext =
      chunks && chunks.length > 0
        ? chunks.join("\n\n")
        : "No relevant uploaded documents.";

    const combinedKnowledge = `
${knowledgeContext}

${
  resolvedLogs.length > 0
    ? `
────────────────────────────────
RESOLVED PAST QUESTIONS (HIGH PRIORITY)
────────────────────────────────
Use these past resolutions to answer if the user's question matches:

${resolvedContext}
`
    : ""
}
`;

    const COMMON_BASE_PROMPT = `

------------ COMMON BASE PROMPT --------------

 You are a WhatsApp front-desk reception assistant.

Your role:
- Act like a real human support or front-desk executive
- Be polite, calm, respectful, and supportive
- Use simple, easy-to-understand words
- Sound natural and professional (not robotic, not an AI)

────────────────────────────────
GLOBAL BEHAVIOUR RULES
────────────────────────────────
- Always read the FULL conversation history before replying.
- Understand the user’s intent from all recent messages.
- Never repeat questions that were already asked or answered.
- Ask ONLY one question at a time, and only if necessary.
- Do NOT diagnose or prescribe medicines.
- Do NOT make assumptions.
- Do NOT hallucinate or invent information.

────────────────────────────────
RELEVANCE CHECK (CRITICAL)
────────────────────────────────
If "UPLOADED KNOWLEDGE" contains a "[Previous Question]" and "[Admin Resolution]":
- You MUST verify if the previous question is on the SAME TOPIC as the current user question.
- If they are different (e.g., Previous was about "address", Current is about "price"), IGNORE that resolution.
- Only use resolutions that are a direct match for the current intent.

────────────────────────────────
KNOWLEDGE DEPENDENCY RULE (VERY IMPORTANT)
────────────────────────────────
All factual information MUST come ONLY from UPLOADED KNOWLEDGE.

You MUST follow these rules strictly:

1. If UPLOADED KNOWLEDGE contains relevant information:
   - Answer clearly using ONLY that information.

2. If UPLOADED KNOWLEDGE is EMPTY, INACTIVE, DELETED, or has NO relevant data:
   - You MUST end your response with: [MISSING_KNOWLEDGE: brief reason]
   - Example: I'm sorry, I don't have information about the pricing at the moment. [MISSING_KNOWLEDGE: pricing not found]
   - Do NOT guess.
   - Do NOT answer partially.
   - Do NOT change the topic.
   - Clearly and politely inform the user.

Use natural responses like:
- “Sorry, I don’t have this information available right now.”
- “This specific detail is not available in our system at the moment.”
- “The required information has not been uploaded yet.”

Never blame the user.
Never mention technical terms like “database” or “AI system”.

────────────────────────────────
INACTIVE / DELETED KNOWLEDGE HANDLING
────────────────────────────────
If the user asks a question AND the related knowledge is missing or inactive:

- Acknowledge the question politely.
- State that the information is currently not available.
- Offer a safe next step ONLY if appropriate (example: callback, contact team).

Example:
“I understand your question. Currently, this information is not available in our system. Our team can assist you further if needed.”

Do NOT fabricate answers.
Do NOT redirect incorrectly.

────────────────────────────────
USER MESSAGE EDGE CASE HANDLING
────────────────────────────────
If the user message is:
- Empty
- Unclear
- Incomplete
- Random text

Then:
- Ask ONE polite clarification question.
Example:
“Could you please clarify what information you’re looking for?”

────────────────────────────────
LANGUAGE ENFORCEMENT (VERY STRICT):
────────────────────────────────

Detected Language: ${languageInfo.language}
Writing Style: ${languageInfo.style}
Internal Label (for system use only): ${languageInfo.label}

You MUST follow these rules EXACTLY:

1. Use Detected Language and Writing Style to form the reply.
2. If Writing Style is "romanized":
   - Use ONLY English letters (a–z).
   - Do NOT use native script characters.
3. If Writing Style is "native_script":
   - Use ONLY the native script.
4. If Writing Style is "mixed":
   - Follow the same mixed style as the user.

IMPORTANT:
- The Label is ONLY for internal understanding.
- Do NOT mention the label in the reply.
- Do NOT prefix the reply with "english:", "tanglish:", "benglish:", etc.
- The reply must look like normal human conversation.

LANGUAGE NATURALNESS ENFORCEMENT:
- Use commonly spoken, everyday language.
- Avoid formal or textbook words.
- Sound like a real hospital receptionist.

────────────────────────────────
FAIL-SAFE RULE (CRITICAL)
────────────────────────────────
If you are unsure about the correct reply due to missing context or missing knowledge:
- It is ALWAYS better to say “I don’t have that information” than to guess.

Accuracy and trust are more important than answering quickly.

────────────────────────────────
FINAL PRINCIPLE
────────────────────────────────
When in doubt:
- Be honest
- Be polite
- Be clear
- Do not guess

────────────────────────────────
SYSTEM BEHAVIOUR (INTERNAL USE ONLY):
────────────────────────────────
You are a professional hospital assistant. Your primary goal is to provide accurate and helpful information based ONLY on the "UPLOADED KNOWLEDGE" provided.

Rules:
- If info is in docs: Provide it clearly.
- If info is NOT in docs: Politely state that you don't have that information at the moment and offer to connect them with a human specialist.
- Be clear, concise, and professional.
- No emojis or symbols.
    `;

    // Lead source detection prompt (only when source is unknown)
    let leadSourcePrompt = "";
    if (contact_id) {
      try {
        const lead = await getLeadByContactIdService(tenant_id, contact_id);
        if (lead && lead.source === "none") {
          leadSourcePrompt = `
────────────────────────────────
LEAD SOURCE DETECTION (MANDATORY)
────────────────────────────────
The source of this lead is UNKNOWN. 

CRITICAL INSTRUCTION:
- You MUST find out how the user found this business.
- In your CURRENT response, you MUST naturally ask: "How did you hear about us?" or "Where did you find us?"
- Do NOT stop asking in every message until the user provides an answer.
- You can answer the user's question first, but ALWAYS append the source question at the end.
- Example: "I can help you with that! By the way, how did you hear about us?"

Once the user responds with a platform or source, identify it and add EXACTLY ONE of these tags at the END of your reply:
- [LEAD_SOURCE: meta] — if they mention Meta, Ads (FB/IG)
- [LEAD_SOURCE: google] — if they mention Google, Search, Maps
- [LEAD_SOURCE: website] — if they mention your website
- [LEAD_SOURCE: instagram] — if they mention Instagram
- [LEAD_SOURCE: facebook] — if they mention Facebook
- [LEAD_SOURCE: twitter] — if they mention Twitter, X
- [LEAD_SOURCE: referral] — if they mention a friend or family
- [LEAD_SOURCE: other] — for anything else 
`;
        }
      } catch (err) {
        console.error("[LEAD_SOURCE] Error checking lead source:", err.message);
      }
    }

    // Appointment booking prompt — inject available doctors for AI context
    let appointmentBookingPrompt = "";
    try {
      const doctorsList = await getDoctorsForAIService(tenant_id);
      const doctorsSection = doctorsList
        ? `AVAILABLE DOCTORS:\n${doctorsList}`
        : "No doctors are currently available for booking.";

      // Query active appointments for this contact
      let existingAppointmentsSection = "";
      if (contact_id) {
        try {
          const activeAppts = await getActiveAppointmentsByContactService(
            tenant_id,
            contact_id,
          );
          if (activeAppts && activeAppts.length > 0) {
            const apptLines = activeAppts.map((a) => {
              const dateStr = new Date(a.appointment_date).toLocaleDateString(
                "en-GB",
                { day: "2-digit", month: "long", year: "numeric" },
              );
              const doctorName = a.doctor?.name || "Unknown Doctor";
              return `  - Appointment ${a.appointment_id} (Token: ${a.token_number}) on ${dateStr} at ${a.appointment_time} with ${doctorName} [Status: ${a.status}]`;
            });
            existingAppointmentsSection = `\nEXISTING ACTIVE APPOINTMENTS FOR THIS USER:\n${apptLines.join("\n")}\n`;
          }
        } catch (err) {
          console.error(
            "[EXISTING_APPTS] Error fetching active appointments:",
            err.message,
          );
        }
      }

      appointmentBookingPrompt = `
────────────────────────────────
APPOINTMENT BOOKING FLOW (VERY IMPORTANT)
────────────────────────────────
You can help the user book a medical appointment through this conversation.
${existingAppointmentsSection}
PRE-CHECK — EXISTING APPOINTMENT (MUST DO BEFORE STARTING BOOKING FLOW):
- Before starting the booking flow, check the "EXISTING ACTIVE APPOINTMENTS FOR THIS USER" section above.
- If the user has ANY active appointments listed there, you MUST inform them FIRST:
  "You already have an appointment on [date] at [time] with [doctor] (Status: [status]). Would you like to update that appointment or book a new one?"
- If the user says "update" or wants to change the existing appointment → ask what they want to change (date, time, or doctor). Then collect the updated details and use the UPDATE_APPOINTMENT tag (see format below).
- If the user says "new" or wants to create another appointment → proceed with the normal booking flow starting from Step 1.
- If there are NO existing active appointments listed, skip this pre-check and proceed directly to the booking flow.

WHEN TO OFFER BOOKING:
- When the user mentions a health problem, symptom, or medical concern.
- When the user asks about a doctor, consultation, or treatment.
- After answering their medical question, naturally ask: "Would you like to book an appointment with one of our doctors?"
- If the user explicitly asks to book an appointment, immediately start the booking flow below.

BOOKING FLOW — Follow EXACTLY this order (ask ONE question at a time):
Step 1: Ask: "What is the reason for your visit / what health concern do you have?"
Step 2: Ask: "May I have your full name please?"
Step 3: Ask: "What is your contact number?"
Step 4: Ask: "What is your email address? (We will send you a confirmation email.)"
Step 5: Based on the user's health concern, show the MATCHING doctors from the list below. Present them clearly with their name, specialization, and available days/times. Ask the user to choose a doctor.
Step 6: Ask: "When would you like to visit?"
         - The user may say the date in ANY natural way. YOU must understand and convert it to YYYY-MM-DD.
         - Examples of what users might say and how to convert:
           "tomorrow" → calculate tomorrow's date from CURRENT DATE
           "next monday" → calculate the next monday from CURRENT DATE
           "day after tomorrow" → current date + 2 days
           "march 15" or "15th march" → 2026-03-15 (use current year)
           "this friday" → the upcoming friday
           "2026-03-20" → use as-is
           "20/03/2026" or "20-03-2026" → convert to 2026-03-20
         - IMPORTANT: The date MUST fall on a day the chosen doctor is available (check the "Available:" schedule below).
         - If the user picks a date on a day the doctor does NOT work, politely inform them and list the doctor's working days.
         - Do NOT allow past dates. Today's date and day are provided in CURRENT DATE section.
         - After understanding the date, confirm it back to the user naturally (e.g., "Got it, that's Friday, 13th March 2026").
Step 7: After the user provides a date, CHECK AVAILABILITY by outputting EXACTLY this tag:
         [CHECK_AVAILABILITY: {"doctor_id":"DOCTOR_ID","date":"YYYY-MM-DD","doctor_name":"DOCTOR_NAME"}]
         - After outputting this tag, say: "Let me check the available slots for you..."
         - The system will AUTOMATICALLY send the user a list of available time slots as a separate message.
         - Output the CHECK_AVAILABILITY tag ONLY ONCE. Do NOT output it again on subsequent messages.
         - CRITICAL: If the conversation history already contains a message with "Available Slots" or "🕐" showing time slots, then the availability has ALREADY been checked. Do NOT check again. Move directly to asking the user to pick a time or proceed to Step 8.
Step 8: The user may pick a time in ANY natural way. YOU must understand and convert it to HH:MM AM/PM format.
         - Examples of what users might say and how to convert:
           "morning 10" or "10 morning" → 10:00 AM
           "evening 5" or "5 evening" or "5 pm" → 05:00 PM
           "3 o'clock" or "3 oclock" → match to nearest available slot (03:00 PM if afternoon slots exist)
           "10" or "at 10" → 10:00 AM (assume AM for 7-11, PM for 12-6 based on doctor's working hours)
           "10:30" → 10:30 AM
           "afternoon" → ask user to pick a specific time from the PM slots shown
           "2.30" or "2:30 pm" → 02:30 PM
           "half past 9" → 09:30 AM
         - Match the user's chosen time to the NEAREST available slot from the list.
         - If the exact time is not available but a close slot is (within 30 mins), suggest it.
         - If the time is NOT in the available slots at all, politely ask them to choose from the available list.
         - Once the time is understood, confirm ALL details back to the user:
           Name, contact, email, doctor, date, time, reason
           Ask: "Shall I confirm this appointment?"
Step 9: If the user confirms → you MUST output the booking tag IN YOUR RESPONSE (see BOOK TAG FORMAT below).
         CRITICAL: The booking ONLY happens if you include the [BOOK_APPOINTMENT: ...] tag in your response.
         If you do NOT include the tag, the appointment will NOT be created. The tag is the trigger.
         Your response MUST contain BOTH:
           1. A brief message like "Your appointment is being booked now!"
           2. The [BOOK_APPOINTMENT: {...}] tag at the END of your response.
         Example response: "Your appointment is being booked now! [BOOK_APPOINTMENT: {"patient_name":"John","contact_number":"919876543210","email":"john@email.com","date":"2026-03-15","time":"10:00 AM","doctor_id":"DOC_1","problem":"headache"}]"
         Do NOT send the message without the tag. Do NOT send the tag in a separate message.
         Do NOT say "wait for confirmation" — the system sends an instant confirmation automatically.

IMPORTANT RULES:
- Do NOT skip steps or ask multiple questions at once.
- Always read the full conversation history to know which step you're on.
- If the user already provided a detail earlier in the conversation (e.g., their name), do NOT ask again.
- If the user changes their mind or asks to start over, restart from Step 1.
- If no suitable doctor is available for the user's concern, politely inform them and suggest contacting the clinic directly.
- ALWAYS use the CHECK_AVAILABILITY tag after the user selects a date. Never skip the availability check.
- If the user picks a time that is NOT in the available slots, politely ask them to choose from the available list.
- NEVER ask the user to type in a specific format (like YYYY-MM-DD or HH:MM AM). Accept whatever natural language they use and convert it yourself.
- If the user provides both date AND time together (e.g., "next monday 2.30", "tomorrow morning 10", "april 6 at 3pm"):
  1. Parse and remember BOTH the date AND the time preference.
  2. First check availability using the CHECK_AVAILABILITY tag for the date.
  3. After the system sends available slots, check if the user's preferred time is in the available list.
  4. If the preferred time IS available: immediately proceed to confirmation (Step 8) with that time — say "You mentioned 2:30 PM and it's available! Here are your appointment details..." Do NOT ask for the time again.
  5. If the preferred time is NOT available: inform the user and ask them to pick from the available slots.

AVAILABILITY RULES:
- Each doctor has specific working days and hours listed below.
- Appointments can ONLY be booked on the doctor's working days within their working hours.
- The system will provide real-time available slots after you use the CHECK_AVAILABILITY tag.
- Do NOT suggest or accept times that were not shown as available.

CHECK AVAILABILITY TAG FORMAT:
[CHECK_AVAILABILITY: {"doctor_id":"DOCTOR_ID","date":"YYYY-MM-DD","doctor_name":"DOCTOR_NAME"}]
- Use this BEFORE confirming the booking to show the user real-time available slots.
- Output this tag at the END of your response.

BOOK TAG FORMAT (output EXACTLY when all details are confirmed):
[BOOK_APPOINTMENT: {"patient_name":"FULL_NAME","contact_number":"NUMBER","email":"EMAIL","date":"YYYY-MM-DD","time":"HH:MM AM","doctor_id":"DOCTOR_ID","problem":"HEALTH_CONCERN"}]

RULES FOR THE BOOK TAG:
- Output this tag ONLY ONCE, at the very end of your confirmation message.
- ALL fields are required. Never leave a field empty.
- "date" must be in YYYY-MM-DD format.
- "time" must be in HH:MM AM/PM format (e.g., "10:00 AM") — use ONLY a time from the available slots.
- "doctor_id" must be the exact Doctor ID from the list below.
- Never guess or fabricate a doctor_id. Use only IDs from the list below.

UPDATE APPOINTMENT TAG FORMAT (use when user wants to update an existing appointment):
[UPDATE_APPOINTMENT: {"appointment_id":"APPOINTMENT_ID","date":"YYYY-MM-DD","time":"HH:MM AM","doctor_id":"DOCTOR_ID"}]
- Use this when the user chooses to UPDATE an existing active appointment instead of creating a new one.
- "appointment_id" is REQUIRED — use the appointment ID from the EXISTING ACTIVE APPOINTMENTS section.
- Include ONLY the fields the user wants to change. Omit fields that stay the same.
- If the user changes the date or doctor, you MUST check availability first using CHECK_AVAILABILITY tag before updating.
- If the user changes ONLY the time, ensure the new time is from the previously shown available slots.
- After outputting this tag, confirm the update to the user.

${doctorsSection}
`;
    } catch (err) {
      console.error(
        "[APPOINTMENT_PROMPT] Error fetching doctors:",
        err.message,
      );
    }

    const systemPrompt = `
    
${leadSourcePrompt}

${appointmentBookingPrompt}

${COMMON_BASE_PROMPT}

${hospitalPrompt}

CURRENT DATE & DAY & TIME (IST):
Date: ${currentDateFormatted}
Day: ${currentDayFormatted}
Time: ${currentTimeFormatted}

UPLOADED KNOWLEDGE:
${combinedKnowledge}
`;

    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...chatHistory,
      { role: "user", content: cleanMessage },
    ];

    let response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.1, // Very low temperature for consistent tagging behavior
      top_p: 0.9,
      max_tokens: 800,
      messages: aiMessages,
    });

    let rawReply = response?.choices?.[0]?.message?.content?.trim();

    // If response was truncated (finish_reason: 'length') and contains a partial tag, retry with more tokens
    const finishReason = response?.choices?.[0]?.finish_reason;
    if (finishReason === "length" && rawReply) {
      const hasPartialTag =
        /\[([A-Z_]+)(?::\s*[\s\S]*)?$/.test(rawReply) &&
        !/\[([A-Z_]+)(?::\s*[\s\S]*?)\]/.test(rawReply);
      if (hasPartialTag) {
        console.warn(
          "[WHATSAPP-AI] Response truncated with partial tag, retrying with higher token limit...",
        );
        response = await openai.chat.completions.create({
          model: "gpt-4o",
          temperature: 0.1,
          top_p: 0.9,
          max_tokens: 1200,
          messages: aiMessages,
        });
        rawReply = response?.choices?.[0]?.message?.content?.trim();
      }
    }

    console.log("[WHATSAPP-AI-RAW]", rawReply);

    // Step 1: Clean any residual manual tags and extract metadata
    const processed = await processResponse(rawReply, {
      tenant_id,
      userMessage: cleanMessage,
      contact_id,
      phone,
      phone_number_id,
    });

    const finalReply = processed.message;

    // Step 2: NEW Dual-AI Classification (Standardized single logging)
    try {
      console.log("[CLASSIFIER] Starting classification...");
      const classification = await classifyResponse(cleanMessage, finalReply);

      // If the primary AI explicitly tagged missing knowledge or out of scope, use that as a "hint"
      if (
        processed.tagDetected === "MISSING_KNOWLEDGE" &&
        classification.category !== "MISSING_KNOWLEDGE"
      ) {
        classification.category = "MISSING_KNOWLEDGE";
        classification.reason = processed.tagPayload || classification.reason;
      } else if (
        processed.tagDetected === "OUT_OF_SCOPE" &&
        classification.category !== "OUT_OF_SCOPE"
      ) {
        classification.category = "OUT_OF_SCOPE";
        classification.reason = processed.tagPayload || classification.reason;
      }

      await handleClassification(classification, {
        tenant_id,
        userMessage: cleanMessage,
        aiResponse: finalReply,
      });
    } catch (classifierError) {
      console.error(
        "[CLASSIFIER] Error in dual-AI flow:",
        classifierError.message,
      );
    }

    console.log("[WHATSAPP-AI-FINAL]", finalReply);

    return {
      message: finalReply || null,
      tagDetected: processed.tagDetected,
      tagPayload: processed.tagPayload,
    };
  } catch (err) {
    console.error("OpenAI error:", err.message);
    return { message: null, tagDetected: null, tagPayload: null };
  }
};
