import OpenAI from "openai";
import { getTenantAiModel } from "./getTenantAiModel.js";
import { trackAiTokenUsage } from "./trackAiTokenUsage.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Processes scraped text based on a user-provided prompt or a default cleaning prompt.
 * @param {string} text - The raw scraped text content.
 * @param {string} prompt - The user's specific extraction/summarization prompt (optional).
 * @param {string} [tenant_id] - Optional tenant ID to resolve model selection.
 * @returns {Promise<string>} - The AI-processed text.
 */
export const processKnowledgeWithAi = async (
  text,
  prompt,
  tenant_id = null,
) => {
  if (!text) return text;

  // Use a sensible default prompt if none is provided to ensure clean data
  const finalPrompt =
    prompt?.trim() ||
    "Extract the main readable content from this website. Remove all boilerplate like headers, footers, and scripts. If you see raw HTML, parse it to find the actual article or core information. Format the output clearly with headings.";

  try {
    const inputModel = await getTenantAiModel(tenant_id, "input");

    const response = await openai.chat.completions.create({
      model: inputModel,
      messages: [
        {
          role: "system",
          content:
            "You are a specialized content extraction assistant. Your task is to extract meaningful information from the provided website content, which may be raw HTML or plain text. 'Think like a browser'—if the input is raw HTML, identify the main content (articles, tables, lists) and ignore navigation links, footers, and advertisements. Maintain a professional tone and ensure the output is well-formatted for a knowledge base.",
        },
        {
          role: "user",
          content: `Website Content (Raw HTML or Text):\n---\n${text.substring(0, 25000)}\n---\n\nInstruction: ${finalPrompt}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 3000,
    });

    // Track token usage
    if (tenant_id) {
      await trackAiTokenUsage(tenant_id, "knowledge_process", response).catch(
        (e) =>
          console.error(
            "[KNOWLEDGE-PROCESS-AI] Token tracking failed:",
            e.message,
          ),
      );
    }

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error("Knowledge Processing AI error:", err.message);
    // Return original text as fallback if AI fails
    return text;
  }
};
