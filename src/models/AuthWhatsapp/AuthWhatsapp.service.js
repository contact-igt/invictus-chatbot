import axios from "axios";
import https from "https";
import FormData from "form-data";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { getSecret } from "../TenantSecretsModel/tenantSecrets.service.js";
import { buildAiSystemPrompt } from "../../utils/ai/aiFlowHelper.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { detectLanguageAI } from "../../utils/ai/detectLanguageStyle.js";
import { buildChatHistory } from "../../utils/chat/buildChatHistory.js";
import { processResponse } from "../../utils/ai/aiTagHandlers/index.js";
import { callAI } from "../../utils/ai/coreAi.js";
import { MISSING_INFO_FALLBACK_REPLY } from "../../utils/ai/prompts/system.js";
import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getActivePromptService } from "../AiPrompt/aiprompt.service.js";
import { getIO } from "../../middlewares/socket/socket.js";
import { classifyIntent, APPOINTMENT_INTENTS } from "../../utils/ai/intentClassifier.js"; // NEW — APPOINTMENT_INTENTS added
import { appointmentOrchestrator } from "../AppointmentModel/appointmentConversation.service.js"; // NEW

const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
});

const FIXED_MISSING_INFO_FALLBACK = MISSING_INFO_FALLBACK_REPLY;

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

const faqTrace = (label, data) => {
  const line = `[${new Date().toISOString()}] ${label} ${JSON.stringify(data)}\n`;
  process.stdout.write(line);
  try {
    import("fs").then(fs => fs.default.appendFileSync("/tmp/faq_trace.log", line)).catch(() => {});
  } catch {}
};

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

/**
 * Upload a media file directly to WhatsApp's Media API.
 * Returns a { mediaId, phone_number_id } — use mediaId for id-based message sends.
 * This is required for audio (webm/ogg) because link-based sends fail format validation.
 */
export const uploadWhatsAppMedia = async (tenant_id, fileBuffer, mimeType, filename) => {
  const [rows] = await db.sequelize.query(
    `SELECT phone_number_id FROM ${tableNames.WHATSAPP_ACCOUNT}
     WHERE tenant_id = ? AND status IN ('active', 'verified') LIMIT 1`,
    { replacements: [tenant_id] },
  );
  if (!rows.length) throw new Error("No active WhatsApp account for tenant");

  const { phone_number_id } = rows[0];
  const access_token = await getSecret(tenant_id, "whatsapp");
  if (!access_token) throw new Error("WhatsApp access token not found");

  const META_API_VERSION = process.env.META_API_VERSION || "v23.0";

  const form = new FormData();
  form.append("file", fileBuffer, { filename, contentType: mimeType });
  form.append("type", mimeType);
  form.append("messaging_product", "whatsapp");

  try {
    const resp = await axios.post(
      `https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}/media`,
      form,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          ...form.getHeaders(),
        },
        httpsAgent,
        maxContentLength: 20 * 1024 * 1024,
      },
    );
    const mediaId = resp.data?.id;
    if (!mediaId) throw new Error("WhatsApp media upload returned no id");
    return { mediaId, phone_number_id };
  } catch (axiosErr) {
    if (axiosErr.response) {
      const metaErr = axiosErr.response.data?.error || {};
      const metaMsg = metaErr.message || axiosErr.message;
      const code = metaErr.code ? ` (Code: ${metaErr.code})` : "";
      throw new Error(`Meta API Error: ${metaMsg}${code}`);
    }
    throw axiosErr;
  }
};

/**
 * Send a media message via WhatsApp Cloud API.
 * Supports both id-based sends (mediaId, preferred for audio) and link-based sends (mediaUrl).
 *
 * @param {string} tenant_id
 * @param {string} to
 * @param {"image"|"video"|"audio"|"document"} mediaType
 * @param {string} mediaUrl   - R2 public URL (used for link-based sends)
 * @param {string} [caption]
 * @param {string} [filename] - shown in WhatsApp for document type
 * @param {string|null} [mediaId] - WhatsApp media_id from uploadWhatsAppMedia(); if set, id-based send is used
 * @returns {Promise<{ phone_number_id: string, wamid: string }>}
 */
export const sendWhatsAppMediaMessage = async (
  tenant_id,
  to,
  mediaType,
  mediaUrl,
  caption = "",
  filename = "",
  mediaId = null,
) => {
  try {
    const [rows] = await db.sequelize.query(
      `SELECT phone_number_id FROM ${tableNames.WHATSAPP_ACCOUNT}
       WHERE tenant_id = ? AND status IN ('active', 'verified') LIMIT 1`,
      { replacements: [tenant_id] },
    );

    if (!rows.length) throw new Error("No active WhatsApp account for tenant");

    const { phone_number_id } = rows[0];
    const access_token = await getSecret(tenant_id, "whatsapp");
    if (!access_token) throw new Error("WhatsApp access token not found");

    const META_API_VERSION = process.env.META_API_VERSION || "v23.0";

    // id-based send (WhatsApp Media API upload) — reliable for audio/webm
    // link-based send — works for image/video/document with public R2 URL
    let mediaPayload;
    if (mediaId) {
      if (mediaType === "document") {
        mediaPayload = { id: mediaId, ...(filename ? { filename } : {}), ...(caption ? { caption } : {}) };
      } else if (mediaType === "audio") {
        mediaPayload = { id: mediaId };
      } else {
        mediaPayload = { id: mediaId, ...(caption ? { caption } : {}) };
      }
    } else {
      if (mediaType === "image") {
        mediaPayload = { link: mediaUrl, ...(caption ? { caption } : {}) };
      } else if (mediaType === "video") {
        mediaPayload = { link: mediaUrl, ...(caption ? { caption } : {}) };
      } else if (mediaType === "audio") {
        mediaPayload = { link: mediaUrl };
      } else if (mediaType === "document") {
        mediaPayload = { link: mediaUrl, ...(filename ? { filename } : {}), ...(caption ? { caption } : {}) };
      } else {
        throw new Error(`Unsupported media type: ${mediaType}`);
      }
    }

    let wamid = null;
    try {
      const response = await axios.post(
        `https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}/messages`,
        {
          messaging_product: "whatsapp",
          to,
          type: mediaType,
          [mediaType]: mediaPayload,
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
        const metaErr = axiosErr.response.data?.error || {};
        const metaMsg = metaErr.message || axiosErr.message;
        const code = metaErr.code ? ` (Code: ${metaErr.code})` : "";
        throw new Error(`Meta API Error: ${metaMsg}${code}`);
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
  messageId = null,
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

    faqTrace("[AI-FLOW] intent classified", { intent: intentResult.intent, requires: intentResult.requires, msg: cleanMessage.substring(0, 60) });

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

    // Also check: did the intent classifier require knowledge, but we found zero chunks?
    // This is a definitive missing-knowledge signal regardless of factual keyword matching.
    const knowledgeRequiredButMissing =
      intentResult.requires.knowledge && !hasKnowledgeGrounding;

    console.log(
      `[WHATSAPP-AI] Grounding precheck | strict:${strictGroundingRequired} | knowledgeRequiredButMissing:${knowledgeRequiredButMissing} | chunks:${groundingChunkCount}`,
    );

    if ((strictGroundingRequired || knowledgeRequiredButMissing) && !hasKnowledgeGrounding) {
      const forcedMissing = buildForcedMissingKnowledgeResult(cleanMessage);
      faqTrace("[AI-FLOW] FORCED missing-knowledge (pre-AI)", { tag: forcedMissing.tagDetected, payload: forcedMissing.tagPayload, strict: strictGroundingRequired, knowledgeRequiredButMissing, chunks: groundingChunkCount });
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
        "You are a helpful AI assistant. Answer briefly, never promise a team follow-up, and if information is missing say you do not have that detail right now.";
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
        messageId: messageId || null,
      });
    } catch (procErr) {
      console.error("[WHATSAPP-AI] processResponse failed:", procErr.message);
      processed = { message: rawReply, tagDetected: null, tagPayload: null };
    }

    if ((strictGroundingRequired || knowledgeRequiredButMissing) && !hasKnowledgeGrounding) {
      processed = buildForcedMissingKnowledgeResult(cleanMessage);
      faqTrace("[AI-FLOW] FORCED missing-knowledge (post-AI)", { tag: processed.tagDetected, payload: processed.tagPayload });
    }

    faqTrace("[AI-FLOW] getOpenAIReply FINAL", { tagDetected: processed.tagDetected, tagPayload: processed.tagPayload, msgPreview: (processed.message || "").substring(0, 60) });
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

/**
 * Vision-aware AI reply for incoming user images.
 *
 * Skips intent classification, knowledge search, and FAQ pipeline — those are
 * text-only paths. Vision reply is a direct GPT-4o call with:
 *   - The tenant system prompt (business context + persona)
 *   - Last 30 conversation messages as text context
 *   - The image + user caption as the final user turn
 *
 * @param {string} tenant_id
 * @param {string} phone          - User's phone number (for memory lookup)
 * @param {string} imageUrl       - Public R2 URL of the image
 * @param {string} caption        - User's caption typed alongside the image (may be empty)
 * @param {string} contact_id
 * @param {string} phone_number_id
 * @param {object} cachedData     - Pre-fetched tenant/contact/lead data
 * @returns {Promise<{ message: string|null }>}
 */
export const getOpenAIVisionReply = async (
  tenant_id,
  phone,
  imageUrl,
  caption = "",
  contact_id = null,
  phone_number_id = null,
  cachedData = {},
) => {
  try {
    const { analyzeImageAndReply } = await import("../../utils/ai/visionAi.js");

    // Fetch conversation memory and active prompt in parallel
    const [memory, activePrompt] = await Promise.all([
      getConversationMemory(tenant_id, phone, contact_id).catch((err) => {
        console.error("[VISION-AI] Memory fetch failed:", err.message);
        return [];
      }),
      getActivePromptService(tenant_id).catch((err) => {
        console.error("[VISION-AI] Active prompt fetch failed:", err.message);
        return null;
      }),
    ]);

    const chatHistory = buildChatHistory(memory);

    // Build system prompt (business context, persona, language settings)
    let systemPrompt = "";
    try {
      const promptResult = await buildAiSystemPrompt(
        tenant_id,
        contact_id,
        { language: "unknown", style: "unknown", label: "unknown" },
        caption || "image",
        { ...cachedData, activePrompt, knowledgeResult: { chunks: [], resolvedLogs: [], sources: [] } },
      );
      systemPrompt = promptResult.systemPrompt;
    } catch (err) {
      console.error("[VISION-AI] System prompt build failed:", err.message);
      systemPrompt =
        "You are a helpful AI assistant. Analyze the image the user sent and respond helpfully based on the conversation context.";
    }

    const reply = await analyzeImageAndReply({
      imageUrl,
      caption,
      history: chatHistory,
      systemPrompt,
      tenantId: tenant_id,
    });

    console.log("[VISION-AI] Reply generated:", reply?.substring(0, 120));
    return { message: reply || null };
  } catch (err) {
    console.error("[VISION-AI] getOpenAIVisionReply failed:", err.message);
    return { message: null };
  }
};
