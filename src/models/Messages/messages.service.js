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
import {
  getAdminSystemPrompt,
  getAdminSuggestedReplyPrompt,
  getAdminLeadSourcePrompt,
  getAdminAppointmentHistoryPrompt,
} from "../../utils/ai/prompts/index.js";

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
  template_name = null,
) => {
  const Query = `INSERT INTO ${tableNames?.MESSAGES} (  
  tenant_id,
  contact_id,
  phone_number_id,
  country_code,
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
  template_name )
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) `;

  try {
    let cleanPhone = phone ? phone.toString().replace(/\D/g, "") : "";
    let cc = "+91"; // fallback

    if (cleanPhone.length > 10) {
      cc = `+${cleanPhone.slice(0, -10)}`;
      cleanPhone = cleanPhone.slice(-10);
    } else if (cleanPhone.length === 10) {
      // It's already 10 digits, keep default cc or retrieve from contact
    }

    const values = [
      tenant_id,
      contact_id,
      phone_number_id,
      cc,
      cleanPhone,
      wamid,
      name,
      sender,
      sender_id,
      message,
      message_type,
      media_url,
      media_mime_type,
      status,
      template_name,
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
    c.is_ai_silenced,
    m.message,
    m.message_type,
    m.created_at AS last_message_at,
    (
      SELECT COUNT(*)
      FROM ${tableNames.MESSAGES} um
      WHERE um.contact_id = m.contact_id
        AND um.tenant_id = ?
        AND um.seen = false
        AND um.sender = 'user'
        AND um.is_deleted = false
    ) AS unread_count
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
      replacements: [tenant_id, tenant_id, tenant_id, tenant_id],
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
    } else {
      // Normalize phone to last 10 digits
      const cleanPhone = phone ? phone.toString().replace(/\D/g, "") : "";
      const suffix =
        cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
      replacements = [suffix, tenant_id];
    }

    const Query = `
    SELECT id, contact_id, sender, message, message_type, media_url, media_mime_type, seen, status, created_at
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

    let whereClause = "phone = ?";
    let replacements = [phone, tenant_id];

    if (contact) {
      whereClause = "contact_id = ?";
      replacements = [contact.contact_id, tenant_id];
    } else {
      // Normalize phone to last 10 digits
      const cleanPhone = phone ? phone.toString().replace(/\D/g, "") : "";
      const suffix =
        cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
      replacements = [suffix, tenant_id];
    }

    const Query = `UPDATE ${tableNames?.MESSAGES} SET seen = true WHERE ${whereClause} AND tenant_id = ? AND seen = false AND sender = 'user'`;
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

    let contact = null;
    try {
      contact = await getContactByPhoneAndTenantIdService(tenant_id, phone);
      if (contact) {
        contact_id = contact.contact_id;

        // 1. Lead Source Detection
        const lead = await getLeadByContactIdService(tenant_id, contact_id);
        if (lead && lead.source === "none") {
          leadSourcePrompt = getAdminLeadSourcePrompt();
        }

        // 2. Appointment History Detection
        const lastAppointment = await getLastAppointmentService(
          tenant_id,
          contact_id,
        );
        appointmentHistoryPrompt =
          getAdminAppointmentHistoryPrompt(lastAppointment);
      }
    } catch (err) {
      console.error(
        "[APPOINTMENT-HISTORY] Error in suggestReply initial lookup:",
        err.message,
      );
    }

    const ADMIN_SYSTEM_PROMPT = getAdminSystemPrompt(
      leadSourcePrompt,
      appointmentHistoryPrompt,
    );

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
    const { chunks } = await searchKnowledgeChunks(tenant_id, lastUserMessage);

    const knowledgeText =
      chunks && chunks.length > 0
        ? chunks.join("\n\n")
        : "No relevant knowledge found.";

    /* 4️⃣ AI prompt */
    const prompt = getAdminSuggestedReplyPrompt({
      adminSystemPrompt: ADMIN_SYSTEM_PROMPT,
      chatHistory,
      lastUserMessage,
      knowledgeText,
    });

    const rawReply = await AiService(
      "system",
      prompt,
      tenant_id,
      "smart_reply",
    );

    console.log("[AI-RAW-RESPONSE]", rawReply);

    // Step 1: Process tags (Self-Tagging) and extract metadata
    const processed = await processResponse(rawReply, {
      tenant_id,
      userMessage: lastUserMessage,
      contact_id,
      phone,
      name: contact?.name,
    });

    const cleanReply = processed.message;

    // Step 2: Dual-AI Classification (Standardized single logging)
    try {
      const classification = await classifyResponse(
        lastUserMessage,
        cleanReply,
        tenant_id,
      );

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
