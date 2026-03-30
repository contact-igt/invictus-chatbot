import { buildAiSystemPrompt } from "../../utils/ai/aiFlowHelper.js";
import { processResponse } from "../../utils/ai/aiTagHandlers/index.js";
import { classifyResponse } from "../../utils/ai/responseClassifier.js";
import { callAI } from "../../utils/ai/coreAi.js";

/**
 * Main playground chat service.
 * Takes a user message + conversation history, runs it through AI with knowledge base,
 * and returns the response along with knowledge sources used.
 */
export const playgroundChatService = async (
  tenant_id,
  message,
  conversationHistory = [],
  contact_id = null,
) => {
  try {
    // Always define sources and chunks to avoid reference errors
    const languageInfo = {
      language: "detected English",
      style: "helpful and professional",
      label: "playground_sim",
    };

    // Use centralized AI flow helper for parity with production WhatsApp
    const { systemPrompt, knowledgeSources, chunks, resolvedContext } =
      await buildAiSystemPrompt(tenant_id, contact_id, languageInfo, message);

    const sources = knowledgeSources;

    // Build message array for OpenAI
    const messages = [{ role: "system", content: systemPrompt }];

    // Add conversation history
    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.forEach((msg) => {
        messages.push({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.message,
        });
      });
    }

    // Add current user message
    messages.push({ role: "user", content: message });

    const aiResult = await callAI({
      messages,
      tenant_id,
      source: "playground",
      temperature: 0.1,
      topP: 0.9,
    });

    const rawReply = aiResult.content;
    const tokenUsage = aiResult.usage;

    console.log("[PLAYGROUND-AI-RAW]", rawReply);

    // Process tags
    const processed = await processResponse(rawReply, {
      tenant_id,
      userMessage: message,
    });

    let finalReply = processed.message;
    let tagExecutionLog = [];

    // If tags detected, simulate execution log (without actually persisting)
    if (processed.tagDetected) {
      tagExecutionLog.push(
        `Detected tag: [${processed.tagDetected}${processed.tagPayload ? ": " + processed.tagPayload : ""}]`,
      );
    }

    // Classify response
    let classification = null;
    try {
      classification = await classifyResponse(message, finalReply, tenant_id);
      tagExecutionLog.push(
        `Classification: ${classification.category} (${classification.reason})`,
      );
    } catch (err) {
      console.error("[PLAYGROUND-CLASSIFIER] Error:", err.message);
    }

    return {
      reply: finalReply,
      technicalLogs: {
        systemPrompt: systemPrompt,
        userMessage: message,
        rawAIResponse: rawReply,
        knowledgeChunksUsed: chunks || [],
        resolvedLogsUsed: resolvedContext || "",
        detectedTags: processed.tagDetected
          ? {
              tag: processed.tagDetected,
              payload: processed.tagPayload,
            }
          : null,
        tagExecutionHistory: tagExecutionLog,
        classification,
      },
      knowledgeSources: sources,
      responseOrigin:
        chunks && chunks.length > 0 ? "knowledge_base" : "ai_generated",
      tokenUsage: {
        prompt_tokens: tokenUsage.prompt_tokens || 0,
        completion_tokens: tokenUsage.completion_tokens || 0,
        total_tokens: tokenUsage.total_tokens || 0,
      },
    };
  } catch (err) {
    console.error("[PLAYGROUND] Error:", err.message);
    throw err;
  }
};
