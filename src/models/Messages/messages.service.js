import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { AiService } from "../../utils/ai/coreAi.js";
import { processResponse } from "../../utils/ai/aiTagHandlers/index.js";
import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { classifyResponse } from "../../utils/ai/responseClassifier.js";
import { handleClassification } from "../../utils/ai/classificationHandler.js";
import { getContactByPhoneAndTenantIdService } from "../ContactsModel/contacts.service.js";
import { getLeadByContactIdService } from "../LeadsModel/leads.service.js";
import { getLastAppointmentService } from "../AppointmentModel/appointment.service.js";

export const createUserMessageService = async (
  tenant_id,
  contact_id,
  phone_number_id,
  phone,
  wamid,
  name,
  sender,
  sender_id,
  message,
  message_type = "text",
  media_url = null,
  media_mime_type = null,
  status = null,
) => {
  const Query = `INSERT INTO ${tableNames?.MESSAGES} (  
  tenant_id,
  contact_id,
  phone_number_id,
  phone,
  wamid,
  name,
  sender,
  sender_id,
  message,
  message_type,
  media_url,
  media_mime_type,
  status )
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) `;

  try {
    const values = [
      tenant_id,
      contact_id,
      phone_number_id,
      phone,
      wamid,
      name,
      sender,
      sender_id,
      message,
      message_type,
      media_url,
      media_mime_type,
      status,
    ];

    const [result] = await db.sequelize.query(Query, { replacements: values });
    return { id: result };
  } catch (err) {
    throw err;
  }
};

export const getChatListService = async (tenant_id) => {
  const dataQuery = `
  SELECT
    m.contact_id,
    c.phone,
    c.name,
    m.message,
    m.message_type,
    m.seen,
    m.created_at AS last_message_at
  FROM messages m
  INNER JOIN (
    SELECT
      contact_id,
      MAX(created_at) AS last_message_time
    FROM messages
    WHERE tenant_id = ?
    GROUP BY contact_id
  ) lm
    ON m.contact_id = lm.contact_id
   AND m.created_at = lm.last_message_time
  JOIN contacts c
    ON c.contact_id = m.contact_id
  LEFT JOIN ${tableNames.LIVECHAT} lc
    ON lc.contact_id = m.contact_id
   AND lc.tenant_id = ?
  WHERE m.tenant_id = ?
    AND lc.contact_id IS NULL
  ORDER BY m.created_at DESC
`;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id, tenant_id, tenant_id],
    });

    return rows;
  } catch (err) {
    throw err;
  }
};

export const getChatByPhoneService = async (phone, tenant_id) => {
  try {
    const contact = await getContactByPhoneAndTenantIdService(tenant_id, phone);

    let whereClause = "phone = ? AND tenant_id = ?";
    let replacements = [phone, tenant_id];

    if (contact) {
      whereClause = "contact_id = ? AND tenant_id = ?";
      replacements = [contact.contact_id, tenant_id];
    }

    const Query = `
    SELECT id, contact_id, sender, message, message_type, media_url, media_mime_type, seen, created_at
    FROM ${tableNames?.MESSAGES}
    WHERE ${whereClause}
    ORDER BY created_at ASC
  `;
    const [result] = await db.sequelize.query(Query, {
      replacements: replacements,
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const markSeenMessageService = async (tenant_id, phone) => {
  try {
    const contact = await getContactByPhoneAndTenantIdService(tenant_id, phone);

    let whereClause = "phone = ? AND tenant_id = ?";
    let replacements = [true, phone, false, tenant_id];

    if (contact) {
      whereClause = "contact_id = ? AND tenant_id = ?";
      replacements = [true, contact.contact_id, false, tenant_id];
    }

    const Query = `UPDATE ${tableNames?.MESSAGES} SET seen = ? WHERE ${whereClause} AND seen = ? AND tenant_id = ?`;
    const [result] = await db.sequelize.query(Query, {
      replacements: replacements,
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const suggestReplyService = async (tenant_id, phone) => {
  try {
    let leadSourcePrompt = "";
    let appointmentHistoryPrompt = "";
    let contact_id = null;

    try {
      const contact = await getContactByPhoneAndTenantIdService(tenant_id, phone);
      if (contact) {
        contact_id = contact.contact_id;

        // 1. Lead Source Detection
        const lead = await getLeadByContactIdService(tenant_id, contact_id);
        if (lead && lead.source === "none") {
          leadSourcePrompt = `
────────────────────────────────
LEAD SOURCE DETECTION (INTERNAL)
────────────────────────────────
The source of this lead is currently UNKNOWN.

During the FIRST conversation, after greeting the user, naturally and politely ask:
"How did you hear about us?" or "Where did you find us?"

When the user responds, identify the source and add ONE of these tags at the END of your reply:
- [LEAD_SOURCE: meta] — if they mention Meta, Facebook ads
- [LEAD_SOURCE: google] — if they mention Google, Google ads, search
- [LEAD_SOURCE: website] — if they mention website, online
- [LEAD_SOURCE: instagram] — if they mention Instagram
- [LEAD_SOURCE: facebook] — if they mention Facebook page/post (not ads)
- [LEAD_SOURCE: twitter] — if they mention Twitter, X
- [LEAD_SOURCE: referral] — if they mention friend, family, someone told them
- [LEAD_SOURCE: other] — if the source doesn't match any above

Rules:
- Ask about the source ONLY ONCE. If already asked in previous messages, do NOT ask again.
- The tag is INTERNAL. The user must NEVER see it.
- Add the tag ONLY when the user gives a clear answer about their source.
- Do NOT guess. If the user's answer is unclear, do NOT add the tag.
`;
        }

        // 2. Appointment History Detection
        const lastAppointment = await getLastAppointmentService(tenant_id, contact_id);
        if (lastAppointment) {
          const status = lastAppointment.status;
          const date = lastAppointment.appointment_date;
          const time = lastAppointment.appointment_time;

          appointmentHistoryPrompt = `
────────────────────────────────
APPOINTMENT HISTORY (INTERNAL)
────────────────────────────────
This person HAS booked with us before.
Latest Appointment Info:
- Status: ${status}
- Date: ${date}
- Time: ${time}

Guidelines for your response:
${status === "Completed" ? '- They had a good experience last time. Acknowledge their return and ask if they need a new booking.' : ""}
${status === "Noshow" ? '- They missed their last appointment. Be polite but note that they missed it if they try to book again.' : ""}
${status === "Confirmed" ? `- They already have an upcoming appointment on ${date} at ${time}. If they try to book again, remind them of this existing one.` : ""}
${status === "Cancelled" ? '- They cancelled their previous booking. Ask if they want to reschedule now.' : ""}
`;
        } else {
          appointmentHistoryPrompt = `
────────────────────────────────
NEW VISITOR (INTERNAL)
────────────────────────────────
This person has NO previous appointment history.
Naturally guide them towards booking if they show interest.
`;
        }
      }
    } catch (err) {
      console.error("[APPOINTMENT-HISTORY] Error in suggestReply initial lookup:", err.message);
    }

    const ADMIN_SYSTEM_PROMPT = `
You are a professional customer support executive.

Rules:
1. Relevance Check:
   - If "Relevant knowledge" contains a "[Previous Question]" and "[Admin Resolution]", you MUST verify if it applies to the CURRENT question.
   - If the previous question is about a different topic (e.g., Question A is about "refunds", current question is about "shipping"), do NOT use that resolution.
2. Missing Knowledge:
   - If the information is NOT found or NOT relevant:
   - You MUST end your response with: [MISSING_KNOWLEDGE: brief reason]
   - Example: I'm sorry, I don't have information about the pricing at the moment. [MISSING_KNOWLEDGE: pricing not found]

3. Appointment Booking:
   - If the user wants to book, collect: Name, Date (YYYY-MM-DD), Time (HH:mm), and Doctor (optional).
   - Once confirmed, output: [BOOK_APPOINTMENT: {"date": "YYYY-MM-DD", "time": "HH:mm", "patient_name": "...", "doctor_id": "..."}]
   - ONLY output the tag when the user has explicitly agreed to the final details.

4. Professional English only.
5. No emojis or symbols.
6. Be clear and helpful.

${leadSourcePrompt}
${appointmentHistoryPrompt}
`;

    let msgWhere = "phone = ? AND tenant_id = ?";
    let msgReplacements = [phone, tenant_id];

    if (contact_id) {
      msgWhere = "contact_id = ? AND tenant_id = ?";
      msgReplacements = [contact_id, tenant_id];
    }

    const [messages] = await db.sequelize.query(
      `
    SELECT sender, message
    FROM ${tableNames.MESSAGES}
    WHERE ${msgWhere}
  ORDER BY created_at ASC
    `,
      { replacements: msgReplacements },
    );

    const chatHistory = messages
      .map((m) => `${m.sender.toUpperCase()}: ${m.message} `)
      .join("\n");

    const [lastMsg] = await db.sequelize.query(
      `
    SELECT message
    FROM ${tableNames.MESSAGES}
    WHERE phone = ?
  AND sender = 'user' AND tenant_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `,
      { replacements: [phone, tenant_id] },
    );

    if (!lastMsg.length) {
      return "No recent customer message found.";
    }

    const lastUserMessage = lastMsg[0].message;

    /* 3️⃣ Knowledge base search (Uses Smart AI Retrieval internally) */
    const chunks = await searchKnowledgeChunks(tenant_id, lastUserMessage);

    const knowledgeText =
      chunks && chunks.length > 0
        ? chunks.join("\n\n")
        : "No relevant knowledge found.";

    /* 4️⃣ AI prompt */
    const prompt = `
${ADMIN_SYSTEM_PROMPT}

Conversation history:
${chatHistory}

Last customer message:
${lastUserMessage}

Relevant knowledge:
${knowledgeText}

Task:
Write a professional reply to the last customer message.

  Reply:
`;

    const rawReply = await AiService("system", prompt);

    console.log("[AI-RAW-RESPONSE]", rawReply);

    // Step 1: Process tags (Self-Tagging) and extract metadata
    const processed = await processResponse(rawReply, {
      tenant_id,
      userMessage: lastUserMessage,
      contact_id,
      phone,
      name: contact?.name
    });

    const cleanReply = processed.message;

    // Step 2: Dual-AI Classification (Standardized single logging)
    try {
      const classification = await classifyResponse(lastUserMessage, cleanReply);

      // If the primary AI explicitly tagged missing knowledge or out of scope, use that as a "hint"
      if (processed.tagDetected === "MISSING_KNOWLEDGE" && classification.category !== "MISSING_KNOWLEDGE") {
        classification.category = "MISSING_KNOWLEDGE";
        classification.reason = processed.tagPayload || classification.reason;
      } else if (processed.tagDetected === "OUT_OF_SCOPE" && classification.category !== "OUT_OF_SCOPE") {
        classification.category = "OUT_OF_SCOPE";
        classification.reason = processed.tagPayload || classification.reason;
      }

      await handleClassification(classification, {
        tenant_id,
        userMessage: lastUserMessage,
        aiResponse: cleanReply,
      });
    } catch (classifierError) {
      console.error("[CLASSIFIER-ADMIN] Error:", classifierError.message);
    }

    console.log("[AI-CLEAN-RESPONSE]", cleanReply);

    return cleanReply;
  } catch (err) {
    throw err;
  }
};
