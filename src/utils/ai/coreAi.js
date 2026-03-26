import OpenAI from "openai";
import { trackAiTokenUsage } from "./trackAiTokenUsage.js";
import { getTenantAiModel } from "./getTenantAiModel.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const AiService = async (
  system,
  prompt,
  tenant_id = null,
  source = "utility",
) => {
  try {
    const inputModel = await getTenantAiModel(tenant_id, "input");

    const response = await openai.chat.completions.create({
      model: inputModel,
      messages: [{ role: system, content: prompt }],
      temperature: 0.01,
      max_tokens: 120,
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
    return "Please try again later.";
  }
};
