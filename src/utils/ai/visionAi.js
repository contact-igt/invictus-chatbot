import { getTenantAiModel } from "./getTenantAiModel.js";
import { getOpenAIClient } from "./getOpenAIClient.js";

// Models that support vision input — anything not in this set is overridden to gpt-4o
const VISION_CAPABLE_MODELS = new Set([
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4-vision-preview",
]);

/**
 * Analyze an image in context and return an AI reply.
 *
 * Uses GPT-4o vision. If the tenant's configured output model is not vision-capable,
 * we silently override to gpt-4o so the call never fails with an unsupported-feature error.
 *
 * @param {object} options
 * @param {string} options.imageUrl        - Public URL of the image (R2 CDN)
 * @param {string} [options.caption]       - Caption the user typed alongside the image
 * @param {Array}  [options.history]       - Pre-built chat history (role/content pairs from buildChatHistory)
 * @param {string} [options.systemPrompt]  - System prompt for the tenant
 * @param {string} [options.tenantId]      - Tenant ID for model/key resolution and billing
 * @returns {Promise<string>}              - AI reply text
 */
export const analyzeImageAndReply = async ({
  imageUrl,
  caption = "",
  history = [],
  systemPrompt = "",
  tenantId = null,
}) => {
  // Verify the tenant's configured model supports vision; fall back to gpt-4o if not
  const configuredModel = await getTenantAiModel(tenantId, "output");
  const model = VISION_CAPABLE_MODELS.has(configuredModel) ? configuredModel : "gpt-4o";

  const openai = await getOpenAIClient(tenantId);

  // Build the user turn: image first, then caption/prompt text
  const userContent = [
    {
      type: "image_url",
      image_url: {
        url: imageUrl,
        detail: "low", // ~85 tokens regardless of image size — safe default; upgrade to "high" per tenant in future
      },
    },
    {
      type: "text",
      text: caption?.trim()
        ? `The user sent this image with the caption: "${caption}". Please respond helpfully based on the image and the ongoing conversation.`
        : "The user sent this image. Please describe what you see and respond helpfully based on the ongoing conversation context.",
    },
  ];

  const messages = [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    ...history,
    { role: "user", content: userContent },
  ];

  // Call OpenAI directly (not via callAI wrapper) so we can override the model
  // and still use the tenant's API key. Token tracking is done via source label.
  const response = await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    max_tokens: 1500,
  });

  const reply = response.choices?.[0]?.message?.content?.trim() || "";

  // Non-blocking token tracking reusing the whatsapp_vision source
  if (tenantId) {
    import("./trackAiTokenUsage.js")
      .then(({ trackAiTokenUsage }) => trackAiTokenUsage(tenantId, "whatsapp_vision", response))
      .catch((e) => console.error("[VISION-AI] Token tracking failed:", e.message));
  }

  return reply;
};
