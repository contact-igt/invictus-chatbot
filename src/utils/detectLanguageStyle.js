import { AiService } from "../models/Ai/ai.service.js";
import { normalizeLanguageLabel } from "./normalizeLanguageLabel.js";

export const detectLanguageAI = async (message) => {
  if (!message || typeof message !== "string") {
    return {
      language: "unknown",
      style: "unknown",
      label: "unknown",
    };
  }

  const LANGUAGE_DETECT_SYSTEM_PROMPT = `
You are a language and writing-style detector.

Analyze the USER MESSAGE and identify:
1. Primary spoken language (ALL Indian languages + English).
2. Writing style:
   - native_script
   - romanized
   - mixed

Return ONLY valid JSON in this format:
{
  "language": "",
  "style": ""
}

Do not explain.
Do not add extra text.

USER MESSAGE

${message}

`;

  const result = await AiService("system", LANGUAGE_DETECT_SYSTEM_PROMPT);

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
