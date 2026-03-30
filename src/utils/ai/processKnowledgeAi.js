import { callAI } from "./coreAi.js";

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

  const finalPrompt =
    prompt?.trim() ||
    "Extract the main readable content from this website. Remove all boilerplate like headers, footers, and scripts. If you see raw HTML, parse it to find the actual article or core information. Format the output clearly with headings.";

  try {
    const result = await callAI({
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
      tenant_id,
      source: "knowledge_process",
      temperature: 0.3,
    });

    return result.content;
  } catch (err) {
    console.error("Knowledge Processing AI error:", err.message);
    return text;
  }
};
