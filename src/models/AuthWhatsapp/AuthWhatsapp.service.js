import axios from "axios";
import https from "https";
import OpenAI from "openai";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { buildAiSystemPrompt } from "../../utils/ai/aiFlowHelper.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { detectLanguageAI } from "../../utils/ai/detectLanguageStyle.js";
import { buildChatHistory } from "../../utils/chat/buildChatHistory.js";
import { processResponse } from "../../utils/ai/aiTagHandlers/index.js";
import { classifyResponse } from "../../utils/ai/responseClassifier.js";
import { handleClassification } from "../../utils/ai/classificationHandler.js";
import { trackAiTokenUsage } from "../../utils/ai/trackAiTokenUsage.js";
import { getTenantAiModel } from "../../utils/ai/getTenantAiModel.js";
import { getOpenAIClient } from "../../utils/ai/getOpenAIClient.js";
import { getIO } from "../../middlewares/socket/socket.js";

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
      AND status IN ('active', 'verified')
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
        const metaErr = axiosErr.response.data?.error || {};
        const metaMsg = metaErr.message || axiosErr.message;
        const code = metaErr.code ? ` (Code: ${metaErr.code})` : "";
        const subcode = metaErr.error_subcode
          ? ` (Subcode: ${metaErr.error_subcode})`
          : "";
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
    `SELECT phone_number_id, access_token FROM ${tableNames.WHATSAPP_ACCOUNT} WHERE tenant_id = ? AND status = 'active' LIMIT 1`,
    { replacements: [tenant_id] },
  );

  if (!rows.length) {
    throw new Error("No active WhatsApp account for tenant");
  }

  const { phone_number_id, access_token } = rows[0];
  const META_API_VERSION = process.env.META_API_VERSION || "v22.0";

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
    `
    SELECT phone_number_id, access_token
    FROM ${tableNames.WHATSAPP_ACCOUNT}
    WHERE tenant_id = ?
      AND status IN ('active', 'verified')
    LIMIT 1
    `,
    { replacements: [tenant_id] },
  );

  if (!rows.length) {
    throw new Error("No active WhatsApp account for tenant");
  }

  const { phone_number_id, access_token } = rows[0];
  console.log("components", JSON.stringify(components, null, 2));
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
  console.log("Full Payload:", JSON.stringify(payload, null, 2));
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

export const sendReadReceipt = async (
  tenant_id,
  phone_number_id,
  message_id,
) => {
  try {
    const [rows] = await db.sequelize.query(
      `
    SELECT access_token
    FROM ${tableNames.WHATSAPP_ACCOUNT}
    WHERE tenant_id = ?
      AND phone_number_id = ?
      AND status IN ('active', 'verified')
    LIMIT 1
    `,
      { replacements: [tenant_id, phone_number_id] },
    );

    if (!rows.length) return;

    const META_API_VERSION = process.env.META_API_VERSION || "v22.0";
    try {
      await axios.post(
        `https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}/messages`,
        {
          messaging_product: "whatsapp",
          status: "read",
          message_id,
        },
        {
          headers: {
            Authorization: `Bearer ${rows[0].access_token}`,
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
    console.error("[READ-RECEIPT] Database Error:", err.message);
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

    // 2. Fetch token and send typing indicator to Meta
    if (!message_id) return;

    const [rows] = await db.sequelize.query(
      `
    SELECT access_token
    FROM ${tableNames.WHATSAPP_ACCOUNT}
    WHERE tenant_id = ?
      AND phone_number_id = ?
      AND status IN ('active', 'verified')
    LIMIT 1
    `,
      { replacements: [tenant_id, phone_number_id] },
    );

    if (!rows.length) return;

    const META_API_VERSION = process.env.META_API_VERSION || "v22.0";
    const access_token = rows[0]?.access_token;
    if (!access_token) return;

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
  cachedData = {},
) => {
  try {
    if (!userMessage) return null;

    const cleanMessage = userMessage.trim();
    if (!cleanMessage) return null;

    // Use cached tenant settings or fetch if not provided
    const { getTenantSettingsService } =
      await import("../TenantModel/tenant.service.js");
    const tenantSettings =
      cachedData.tenantSettings || (await getTenantSettingsService(tenant_id));
    const tenantTimezone = tenantSettings?.timezone || "Asia/Kolkata";

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: tenantTimezone }),
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

    const languageInfo = await detectLanguageAI(cleanMessage, tenant_id).catch(
      (err) => {
        console.error("[WHATSAPP-AI] Language detection failed:", err.message);
        return { language: "unknown", style: "unknown", label: "unknown" };
      },
    );

    console.log("language", languageInfo);

    let chatHistory = [];
    try {
      const memory = await getConversationMemory(tenant_id, phone, contact_id);
      chatHistory = buildChatHistory(memory);
    } catch (memErr) {
      console.error("[WHATSAPP-AI] Memory/history failed:", memErr.message);
    }

    // Use centralized AI flow helper for parity with Playground
    // Pass cached data including tenantSettings to avoid redundant DB calls
    let systemPrompt = "";
    try {
      const promptResult = await buildAiSystemPrompt(
        tenant_id,
        contact_id,
        languageInfo,
        cleanMessage,
        { ...cachedData, tenantSettings },
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

    const outputModel = await getTenantAiModel(tenant_id, "output");
    const openai = await getOpenAIClient(tenant_id);

    let response = await openai.chat.completions.create({
      model: outputModel,
      temperature: 0.1, // Very low temperature for consistent tagging behavior
      top_p: 0.9,
      max_tokens: 1200,
      messages: aiMessages,
    });

    // Track token usage for the primary AI call
    await trackAiTokenUsage(tenant_id, "whatsapp", response).catch((e) =>
      console.error("[WHATSAPP-AI] Token tracking failed:", e.message),
    );

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
          model: outputModel,
          temperature: 0.1,
          top_p: 0.9,
          max_tokens: 1600,
          messages: aiMessages,
        });
        await trackAiTokenUsage(tenant_id, "whatsapp_retry", response).catch(
          (e) =>
            console.error(
              "[WHATSAPP-AI] Retry token tracking failed:",
              e.message,
            ),
        );
        rawReply = response?.choices?.[0]?.message?.content?.trim();
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

    const finalReply = processed.message;

    // Step 2: NEW Dual-AI Classification (Standardized single logging)
    try {
      console.log("[CLASSIFIER] Starting classification...");
      const classification = await classifyResponse(
        cleanMessage,
        finalReply,
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
