import axios from "axios";
import https from "https";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { getSecret } from "../TenantSecretsModel/tenantSecrets.service.js";
import { buildAiSystemPrompt } from "../../utils/ai/aiFlowHelper.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { detectLanguageAI } from "../../utils/ai/detectLanguageStyle.js";
import { buildChatHistory } from "../../utils/chat/buildChatHistory.js";
import { processResponse } from "../../utils/ai/aiTagHandlers/index.js";
import { callAI } from "../../utils/ai/coreAi.js";
import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getActivePromptService } from "../AiPrompt/aiprompt.service.js";
import { getIO } from "../../middlewares/socket/socket.js";
import { classifyIntent, APPOINTMENT_INTENTS } from "../../utils/ai/intentClassifier.js"; // NEW — APPOINTMENT_INTENTS added
import { appointmentOrchestrator } from "../AppointmentModel/appointmentConversation.service.js"; // NEW

const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
});

const FIXED_MISSING_INFO_FALLBACK =
  "Our team will get back to you shortly. Please feel free to ask any other questions in the meantime ?";

const ENABLE_APPOINTMENT_FLOW = false;

const FACTUAL_KEYWORD_PATTERN =
  /\b(price|cost|fee|fees|timing|timings|hours|open|close|policy|policies|service|services|treatment|treatments|procedure|procedures|operation|surgery|medication|medicine|diet|drink|drinks|food|before|after|insurance|package|offer|facility|facilities|address|location|contact|refund|payment|emi|warranty|guarantee|side effects?)\b/i;
const FACTUAL_INTENT_PATTERN =
  /\b(what|when|where|which|who|how\s+much|how\s+many|how\s+long)\b/i;
const SMALLTALK_PATTERN =
  /^(hi|hello|hey|thanks|thank you|ok|okay|bye|good morning|good afternoon|good evening|how are you)\b/i;

const normalizeMissingKnowledgeTopic = (message = "") =>
  String(message)
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .trim()
    .slice(0, 120) || "your question";

const hasGroundingChunks = (knowledgeResult) =>
  Array.isArray(knowledgeResult?.chunks) && knowledgeResult.chunks.length > 0;

const isLikelyFactualQuestion = (message = "") => {
  const text = String(message || "").trim();
  if (!text) return false;

  if (FACTUAL_KEYWORD_PATTERN.test(text)) return true;

  // Ignore pure small-talk even if a question mark is present (e.g., "how are you?")
  if (SMALLTALK_PATTERN.test(text) && text.split(/\s+/).length <= 8) {
    return false;
  }

  return text.includes("?") && FACTUAL_INTENT_PATTERN.test(text);
};

const shouldEnforceStrictGrounding = (message = "", intentResult = null) => {
  if (!isLikelyFactualQuestion(message)) return false;

  // Keep booking/appointment and doctor-flow logic unchanged.
  if (intentResult?.intent === "APPOINTMENT_ACTION") return false;
  if (intentResult?.requires?.appointments) return false;
  if (intentResult?.requires?.doctors) return false;

  return true;
};

const buildForcedMissingKnowledgeResult = (message = "") => ({
  message: FIXED_MISSING_INFO_FALLBACK,
  tagDetected: "MISSING_KNOWLEDGEBASE_HOOK",
  tagPayload: normalizeMissingKnowledgeTopic(message),
});

export const sendWhatsAppMessage = async (tenant_id, to, message) => {
  try {
    if (!message || !message.trim()) return;

    const [rows] = await db.sequelize.query(
      `SELECT phone_number_id FROM ${tableNames.WHATSAPP_ACCOUNT}
       WHERE tenant_id = ? AND status IN ('active', 'verified') LIMIT 1`,
      { replacements: [tenant_id] },
    );

    if (!rows.length) {
      throw new Error("No active WhatsApp account for tenant");
    }

    const { phone_number_id } = rows[0];
    const access_token = await getSecret(tenant_id, "whatsapp");
    if (!access_token) throw new Error("WhatsApp access token not found");

    const META_API_VERSION = process.env.META_API_VERSION || "v23.0";

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
        const metaErr = axiosErr.response.data?.error || {};
        const metaMsg = metaErr.message || axiosErr.message;
        const code = metaErr.code ? ` (Code: ${metaErr.code})` : "";
        const subcode = metaErr.error_subcode
          ? ` (Subcode: ${metaErr.error_subcode})`
          : "";

        // Meta code 190 = Invalid OAuth 2.0 Access Token — flag account immediately
        if (metaErr.code === 190 || metaErr.type === "OAuthException") {
          console.error(
            `[SEND-MSG] Access token error for tenant ${tenant_id} — marking account as token_error`,
          );
          try {
            await db.sequelize.query(
              `UPDATE ${tableNames.WHATSAPP_ACCOUNT} SET status = 'token_error', last_error = ? WHERE tenant_id = ? AND phone_number_id = ?`,
              {
                replacements: [
                  `Token error: ${metaMsg}`,
                  tenant_id,
                  phone_number_id,
                ],
              },
            );
          } catch (dbErr) {
            console.error(
              "[SEND-MSG] Failed to update account token_error status:",
              dbErr.message,
            );
          }
          const tokenErr = new Error(
            `Meta Access Token Error: ${metaMsg}${code}${subcode}`,
          );
          tokenErr.isTokenError = true;
          throw tokenErr;
        }

        throw new Error(`Meta API Error: ${metaMsg}${code}${subcode}`);
      }
      throw axiosErr;
    }

    return { phone_number_id, wamid };
  } catch (err) {
    throw err;
  }
};

export const sendWhatsAppLocation = async (tenant_id, to, locationParams) => {
  const [rows] = await db.sequelize.query(
    `SELECT phone_number_id FROM ${tableNames.WHATSAPP_ACCOUNT}
     WHERE tenant_id = ? AND status = 'active' LIMIT 1`,
    { replacements: [tenant_id] },
  );

  if (!rows.length) throw new Error("No active WhatsApp account for tenant");

  const { phone_number_id } = rows[0];
  const access_token = await getSecret(tenant_id, "whatsapp");
  if (!access_token) throw new Error("WhatsApp access token not found");

  const META_API_VERSION = process.env.META_API_VERSION || "v23.0";

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "location",
    location: {
      latitude: String(locationParams.latitude),
      longitude: String(locationParams.longitude),
      name: locationParams.name || "",
      address: locationParams.address || "",
    },
  };

  console.log(
    `[SEND-LOCATION] Sending location to ${to}:`,
    JSON.stringify(payload, null, 2),
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
        "[SEND-LOCATION] Meta API Error:",
        JSON.stringify(error.response.data, null, 2),
      );
      const metaErr = error.response.data?.error || {};
      const message = metaErr.message || error.message;
      throw new Error(`Meta API Location Error: ${message}`);
    }
    throw error;
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
    `SELECT phone_number_id FROM ${tableNames.WHATSAPP_ACCOUNT}
     WHERE tenant_id = ? AND status IN ('active', 'verified') LIMIT 1`,
    { replacements: [tenant_id] },
  );

  if (!rows.length) throw new Error("No active WhatsApp account for tenant");

  const { phone_number_id } = rows[0];
  const access_token = await getSecret(tenant_id, "whatsapp");
  if (!access_token) throw new Error("WhatsApp access token not found");
  console.log("components", JSON.stringify(components, null, 2));

  // Guard against null/empty language code — default to "en" as safe fallback
  const resolvedLanguageCode = languageCode || "en";
  if (!languageCode) {
    console.warn(
      `[SEND-TEMPLATE] languageCode is null/empty for template "${templateName}", defaulting to "en"`,
    );
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: resolvedLanguageCode,
      },
      components: components || [],
    },
  };
  console.log("Full Payload:", JSON.stringify(payload, null, 2));
  const META_API_VERSION = process.env.META_API_VERSION || "v23.0";
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
      const metaErr = error.response.data?.error || {};
      const message = metaErr.message || error.message;
      const code = metaErr.code ? ` (Code: ${metaErr.code})` : "";
      const subcode = metaErr.error_subcode
        ? ` (Subcode: ${metaErr.error_subcode})`
        : "";
      throw new Error(`Meta API Error: ${message}${code}${subcode}`);
    }
    throw error;
  }
};

export const sendReadReceipt = async (tenant_id, phone_number_id, message_id) => {
  try {
    const access_token = await getSecret(tenant_id, "whatsapp");
    if (!access_token) return;

    const META_API_VERSION = process.env.META_API_VERSION || "v23.0";
    try {
      await axios.post(
        `https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}/messages`,
        { messaging_product: "whatsapp", status: "read", message_id },
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
    } catch (apiErr) {
      console.error(
        "[READ-RECEIPT] Meta API Error:",
        apiErr?.response?.data || apiErr.message,
      );
    }
  } catch (err) {
    console.error("[READ-RECEIPT] Error:", err.message);
  }
};

export const sendTypingIndicator = async (
  tenant_id,
  phone_number_id,
  phone,
  message_id,
) => {
  try {
    // 1. Emit Socket event for Whatnexus Dashboard Animation
    try {
      const io = getIO();
      if (io) {
        console.log(
          `[TYPING] Emitting ai-typing for tenant ${tenant_id}, phone ${phone}`,
        );
        io.to(`tenant-${tenant_id}`).emit("ai-typing", {
          tenant_id,
          phone,
          status: true,
        });
      }
    } catch (socketErr) {
      console.error("[TYPING] Socket Emit Error:", socketErr.message);
    }

    // 2. Fetch token from secrets and send typing indicator to Meta
    if (!message_id) return;

    const access_token = await getSecret(tenant_id, "whatsapp");
    if (!access_token) return;

    const META_API_VERSION = process.env.META_API_VERSION || "v23.0";

    try {
      await axios.post(
        `https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}/messages`,
        {
          messaging_product: "whatsapp",
          status: "read",
          message_id,
          typing_indicator: {
            type: "text",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
    } catch (apiErr) {
      // Typing indicator may not be supported on all API versions — suppress gracefully
      console.debug(
        "[TYPING] Meta API typing indicator failed:",
        apiErr?.response?.data?.error?.message || apiErr.message,
      );
    }
  } catch (err) {
    console.error("[TYPING] Database Error:", err.message);
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

/**
 * Atomic lock acquisition — combines check + acquire + stale cleanup in one operation.
 * Returns true if lock was acquired, false if already locked by another process.
 */
export const tryAcquireLock = async (tenant_id, phone_number_id, phone) => {
  try {
    // Step 1: Clean stale locks older than 30 seconds (zombie cleanup)
    await db.sequelize.query(
      `DELETE FROM ${tableNames.CHATLOCKS}
       WHERE tenant_id = ? AND phone_number_id = ? AND phone = ?
       AND created_at < (NOW() - INTERVAL 30 SECOND)`,
      { replacements: [tenant_id, phone_number_id, phone] },
    );

    // Step 2: Atomic insert — if lock exists (not stale), INSERT IGNORE returns 0 affected rows
    const [, metadata] = await db.sequelize.query(
      `INSERT IGNORE INTO ${tableNames.CHATLOCKS}
       (tenant_id, phone_number_id, phone, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())`,
      { replacements: [tenant_id, phone_number_id, phone] },
    );

    // affectedRows = 1 means we got the lock, 0 means someone else has it
    return (metadata?.affectedRows ?? metadata) === 1;
  } catch (err) {
    console.error("[CHAT-LOCK] Lock acquisition error:", err.message);
    return false;
  }
};

/**
 * Queue a pending message for a user who is currently locked.
 * Only the LATEST message is kept (overwrites previous queued message).
 */
const pendingMessages = new Map(); // key: "tenant_id:phone" → { text, contact_id, ... }

export const queuePendingMessage = (tenant_id, phone, messageData) => {
  const key = `${tenant_id}:${phone}`;
  pendingMessages.set(key, messageData);
  console.log(`[MSG-QUEUE] Queued pending message for ${key}`);
};

export const consumePendingMessage = (tenant_id, phone) => {
  const key = `${tenant_id}:${phone}`;
  const msg = pendingMessages.get(key);
  if (msg) {
    pendingMessages.delete(key);
    console.log(`[MSG-QUEUE] Consumed pending message for ${key}`);
  }
  return msg || null;
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
      AND created_at > (NOW() - INTERVAL 30 SECOND)
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
  cachedData = {},
) => {
  try {
    if (!userMessage) return null;

    const cleanMessage = userMessage.trim();
    if (!cleanMessage) return null;

    // ── Phase 1: Parallel fetch — language + memory + active prompt (always needed) ──
    const [languageInfo, memory, activePrompt] = await Promise.all([
      detectLanguageAI(cleanMessage, tenant_id).catch((err) => {
        console.error("[WHATSAPP-AI] Language detection failed:", err.message);
        return { language: "unknown", style: "unknown", label: "unknown" };
      }),
      getConversationMemory(tenant_id, phone, contact_id).catch((memErr) => {
        console.error("[WHATSAPP-AI] Memory/history failed:", memErr.message);
        return [];
      }),
      getActivePromptService(tenant_id).catch((promptErr) => {
        console.error(
          "[WHATSAPP-AI] Active prompt fetch failed:",
          promptErr.message,
        );
        return null;
      }),
    ]);

    console.log("language", languageInfo);

    const chatHistory = buildChatHistory(memory);

    // ── Phase 1.5: Intent Classification — what data does this message need? ──
    let intentResult = await classifyIntent(
      cleanMessage,
      chatHistory,
      tenant_id,
    );

    console.log(
      "[AI FLOW]",
      "Appointment flow enabled:",
      ENABLE_APPOINTMENT_FLOW,
    );

    // NEW: Route appointment intents directly — skip heavy AI call and knowledge search
    if (
      ENABLE_APPOINTMENT_FLOW &&
      APPOINTMENT_INTENTS.includes(intentResult.intent)
    ) { // NEW
      const contactObj = { // NEW
        contact_id, // NEW
        phone_number: phone, // NEW
        phone, // NEW
        ...(cachedData?.contact || {}), // NEW
      }; // NEW
      const apptResult = await appointmentOrchestrator.handleAppointmentIntent( // NEW
        intentResult.intent, cleanMessage, contactObj, tenant_id, // NEW
      ); // NEW
      return { // NEW
        message: apptResult.message, // NEW
        tagDetected: null, // NEW
        tagPayload: null, // NEW
        intent: intentResult.intent, // NEW
        _apptResult: apptResult, // NEW — signals controller to use interactive sending
      }; // NEW
    } // NEW

    const factualKnowledgeNeeded = isLikelyFactualQuestion(cleanMessage);
    if (!intentResult.requires.knowledge && factualKnowledgeNeeded) {
      intentResult = {
        ...intentResult,
        requires: { ...intentResult.requires, knowledge: true },
      };
      console.log(
        "[WHATSAPP-AI] Knowledge lookup forced by strict factual-question heuristic.",
      );
    }

    console.log(
      `[WHATSAPP-AI] Intent: ${intentResult.intent} | requires: K:${intentResult.requires.knowledge} D:${intentResult.requires.doctors} A:${intentResult.requires.appointments}`,
    );

    // ── Phase 1.6: Fetch knowledge ONLY if classifier says it's needed ──
    let knowledgeResult = { chunks: [], resolvedLogs: [], sources: [] };
    if (intentResult.requires.knowledge) {
      knowledgeResult = await searchKnowledgeChunks(
        tenant_id,
        cleanMessage,
      ).catch((knErr) => {
        console.error("[WHATSAPP-AI] Knowledge search failed:", knErr.message);
        return { chunks: [], resolvedLogs: [], sources: [] };
      });
    }

    const strictGroundingRequired = shouldEnforceStrictGrounding(
      cleanMessage,
      intentResult,
    );
    const hasKnowledgeGrounding = hasGroundingChunks(knowledgeResult);
    const groundingChunkCount = Array.isArray(knowledgeResult?.chunks)
      ? knowledgeResult.chunks.length
      : 0;

    console.log(
      `[WHATSAPP-AI] Grounding precheck | strict:${strictGroundingRequired} | chunks:${groundingChunkCount}`,
    );

    if (strictGroundingRequired && !hasKnowledgeGrounding) {
      const forcedMissing = buildForcedMissingKnowledgeResult(cleanMessage);
      console.warn(
        `[WHATSAPP-AI] Forced missing-knowledge before AI generation. topic:${forcedMissing.tagPayload}`,
      );
      return {
        ...forcedMissing,
        intent: intentResult.intent,
      };
    }

    // ── Phase 2: Build system prompt (mostly local assembly, data pre-fetched) ──
    let systemPrompt = "";
    try {
      const promptResult = await buildAiSystemPrompt(
        tenant_id,
        contact_id,
        languageInfo,
        cleanMessage,
        {
          ...cachedData,
          knowledgeResult,
          activePrompt,
          intent: intentResult.intent,
          requires: intentResult.requires,
        },
      );
      systemPrompt = promptResult.systemPrompt;
    } catch (promptErr) {
      console.error(
        "[WHATSAPP-AI] System prompt build failed:",
        promptErr.message,
      );
      // Use a minimal fallback prompt so AI can still respond
      systemPrompt =
        "You are a helpful AI assistant. Answer the user's question.";
    }

    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...chatHistory,
      { role: "user", content: cleanMessage },
    ];

    let aiResult = await callAI({
      messages: aiMessages,
      tenant_id,
      source: "whatsapp",
      temperature: 0.1,
      topP: 0.9,
    });

    let rawReply = aiResult.content;

    // If response was truncated and contains a partial tag, retry with more tokens
    if (aiResult.finishReason === "length" && rawReply) {
      const hasPartialTag =
        /\[([A-Z_]+)(?::\s*[\s\S]*)?$/.test(rawReply) &&
        !/\[([A-Z_]+)(?::\s*[\s\S]*?)\]/.test(rawReply);
      if (hasPartialTag) {
        console.warn(
          "[WHATSAPP-AI] Response truncated with partial tag, retrying with higher token limit...",
        );
        aiResult = await callAI({
          messages: aiMessages,
          tenant_id,
          source: "whatsapp_retry",
          temperature: 0.1,
          topP: 0.9,
        });
        rawReply = aiResult.content;
      }
    }

    console.log("[WHATSAPP-AI-RAW]", rawReply);

    // Step 1: Clean any residual manual tags and extract metadata
    let processed;
    try {
      processed = await processResponse(rawReply, {
        tenant_id,
        userMessage: cleanMessage,
        contact_id,
        phone,
        phone_number_id,
      });
    } catch (procErr) {
      console.error("[WHATSAPP-AI] processResponse failed:", procErr.message);
      processed = { message: rawReply, tagDetected: null, tagPayload: null };
    }

    if (strictGroundingRequired && !hasKnowledgeGrounding) {
      processed = buildForcedMissingKnowledgeResult(cleanMessage);
      console.warn(
        `[WHATSAPP-AI] Forced missing-knowledge after AI generation safety override. topic:${processed.tagPayload}`,
      );
    }

    const finalReply = processed.message;

    console.log("[WHATSAPP-AI-FINAL]", finalReply);

    return {
      message: finalReply || null,
      tagDetected: processed.tagDetected,
      tagPayload: processed.tagPayload,
      intent: intentResult.intent,
      requires: intentResult.requires,
      lead_intelligence: intentResult.lead_intelligence || null,
    };
  } catch (err) {
    console.error("OpenAI error:", err.message);
    return {
      message: null,
      tagDetected: null,
      tagPayload: null,
      intent: null,
      requires: null,
      lead_intelligence: null,
    };
  }
};
