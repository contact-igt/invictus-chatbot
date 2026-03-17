import { LANGUAGE_DETECT_SYSTEM_PROMPT } from "./prompts/index.js";
import { normalizeLanguageLabel } from "./normalizeLanguageLabel.js";
import { AiService } from "./coreAi.js";

export const detectLanguageAI = async (message) => {
  if (!message || typeof message !== "string") {
    return {
      language: "unknown",
      style: "unknown",
      label: "unknown",
    };
  }

  const systemPrompt = `${LANGUAGE_DETECT_SYSTEM_PROMPT}\n\nUSER MESSAGE:\n${message}`;

  const result = await AiService("system", systemPrompt);

  try {
    const parsed = JSON.parse(result);
    return normalizeLanguageLabel(parsed);
  } catch {
    return {
      language: "unknown",
      style: "unknown",
      label: "unknown",
    };
  }
};
