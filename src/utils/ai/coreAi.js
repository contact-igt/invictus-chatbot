import OpenAI from "openai";
import { trackAiTokenUsage } from "./trackAiTokenUsage.js";
import { getTenantAiModel } from "./getTenantAiModel.js";
import { getOpenAIClient } from "./getOpenAIClient.js";

export const AiService = async (
  system,
  prompt,
  tenant_id = null,
  source = "utility",
) => {
  try {
    // Use input model for classification tasks, output model for generation tasks
    const inputSources = ["language_detect", "classifier"];
    const modelType = inputSources.includes(source) ? "input" : "output";
    const model = await getTenantAiModel(tenant_id, modelType);
    const openai = await getOpenAIClient(tenant_id);

    // Use appropriate max_tokens based on source
    const tokenLimits = {
      language_detect: 80,
      classifier: 80,
      lead_summary: 300,
      smart_reply: 500,
      utility: 150,
    };
    const maxTokens = tokenLimits[source] || 150;

    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: system, content: prompt }],
      temperature: 0.01,
      max_tokens: maxTokens,
    });

    // Track token usage if tenant_id is available
    if (tenant_id) {
      await trackAiTokenUsage(tenant_id, source, response).catch((e) =>
        console.error("[AI-SERVICE] Token tracking failed:", e.message),
      );
    }

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error("OpenAI error:", err.message);
    throw new Error(`AI generation failed: ${err.message}`);
  }
};
