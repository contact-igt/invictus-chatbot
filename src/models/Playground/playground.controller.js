import {
  playgroundChatService,
  playgroundInboundService,
} from "./playground.service.js";
import { listKnowledgeService } from "../Knowledge/knowledge.service.js";

/**
 * POST /api/whatsapp/playground/chat
 * Send a message in the playground and get AI response with knowledge references
 */
export const playgroundChat = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { message, conversationHistory } = req.body;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  if (!message || !message.trim()) {
    return res.status(400).send({ message: "Message is required" });
  }

  try {
    const result = await playgroundChatService(
      tenant_id,
      message.trim(),
      conversationHistory || [],
    );

    return res.status(200).send({
      message: "success",
      data: result,
    });
  } catch (err) {
    console.error("[PLAYGROUND-CHAT] Error:", err.message);
    return res.status(500).send({
      message: err?.message || "Failed to process playground message",
    });
  }
};

/**
 * POST /api/whatsapp/playground/inbound
 * Simulate a WhatsApp inbound text/button/list reply inside Playground.
 */
export const playgroundInbound = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const {
    message = "",
    interactiveReplyId = null,
    replyTitle = "",
    source = "text",
    playgroundSessionId = null,
    conversationHistory = [],
  } = req.body || {};

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  if (!String(message || replyTitle || interactiveReplyId || "").trim()) {
    return res.status(400).send({ message: "Message or reply id is required" });
  }

  try {
    const result = await playgroundInboundService({
      tenantId: tenant_id,
      user: req.user,
      message,
      interactiveReplyId,
      replyTitle,
      source,
      playgroundSessionId,
      conversationHistory,
    });

    return res.status(200).send({
      message: "success",
      data: result,
    });
  } catch (err) {
    console.error("[PLAYGROUND-INBOUND] Error:", err.message, err.stack);
    return res.status(500).send({
      message: err?.message || "Failed to process playground inbound message",
    });
  }
};

/**
 * GET /api/whatsapp/playground/knowledge-sources
 * List all active knowledge sources for the tenant (for the playground reference panel)
 */
export const getPlaygroundKnowledgeSources = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const data = await listKnowledgeService(tenant_id);
    return res.status(200).send({
      message: "success",
      data: data.sources,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message || "Failed to fetch knowledge sources",
    });
  }
};
