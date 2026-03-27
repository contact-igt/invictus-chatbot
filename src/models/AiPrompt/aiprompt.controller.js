import { cleanText } from "../../utils/text/cleanText.js";
import {
  deleteAiPromptService,
  getActivePromptService,
  getAiPromptByIdService,
  listAiPromptService,
  permanentDeleteAiPromptService,
  processAiPromptUpload,
  updateAiPromptService,
  updatePromptActiveService,
  getDeletedAiPromptListService,
  restoreAiPromptService,
} from "./aiprompt.service.js";
import OpenAI from "openai";
import { getTenantAiModel } from "../../utils/ai/getTenantAiModel.js";
import { trackAiTokenUsage } from "../../utils/ai/trackAiTokenUsage.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const getDeletedAiPromptListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  try {
    const result = await getDeletedAiPromptListService(tenant_id);
    return res.status(200).send({
      message: "success",
      data: result,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const restoreAiPromptController = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;
  try {
    const result = await restoreAiPromptService(id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    if (err.message === "Prompt not found or not deleted") {
      return res.status(404).send({ message: err.message });
    }
    return res.status(500).send({ message: err.message });
  }
};

export const uploadAiPrompt = async (req, res) => {
  try {
    const { name, prompt } = req.body;

    const tenant_id = req.user.tenant_id;

    if (!tenant_id) {
      return res.status(400).send({ message: "Invalid tenant context" });
    }

    let finalText = "";

    if (!prompt || prompt.trim().length < 10) {
      return res.status(400).json({ message: "Text missing" });
    }

    finalText = prompt;

    const cleanedText = cleanText(finalText);

    await processAiPromptUpload(tenant_id, name ? name : null, cleanedText);

    return res.status(200).send({
      message: "Prompt uploaded successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

export const listAiPrompt = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const data = await listAiPromptService(tenant_id);
    return res.status(200).send({
      data: data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAiPromptById = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { id } = req.params;
    const data = await getAiPromptByIdService(id, tenant_id);

    if (!data) {
      return res.status(404).json({ message: "Propmt not found" });
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateAiPrompt = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { id } = req.params;
    const { name, prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ message: "prompt required" });
    }

    await updateAiPromptService(id, tenant_id, name, prompt);
    res.json({ message: "Propmt updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updatePromptActive = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (!id) {
      return res.status(400).json({ message: "prompt id required" });
    }

    if (String(is_active) === "true") {
      // Logic inside service will deactivate others
    }

    await updatePromptActiveService(id, tenant_id, is_active);
    res.json({ message: "Prompt updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteAiPrompt = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { id } = req.params;
    await deleteAiPromptService(id, tenant_id);
    res.json({ message: "Prompt deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const permanentDeleteAiPrompt = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { id } = req.params;
    await permanentDeleteAiPromptService(id, tenant_id);
    res.json({ message: "Prompt permanently deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getActivePromptController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }
  try {
    const statuspropmt = await getActivePromptService(tenant_id);
    return res.status(200).send({
      message: "sucess",
      data: statuspropmt,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

/**
 * Generic AI completion endpoint for frontend use
 * Uses tenant's selected output model
 */
export const generateAiCompletionController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { prompt, systemInstruction = "You are a helpful assistant." } =
      req.body;

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ message: "Prompt is required" });
    }

    // Get tenant's selected output model
    const outputModel = await getTenantAiModel(tenant_id, "output");

    const response = await openai.chat.completions.create({
      model: outputModel,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    // Track token usage
    await trackAiTokenUsage(tenant_id, "frontend_utility", response).catch(
      (e) => console.error("[AI-COMPLETION] Token tracking failed:", e.message),
    );

    const result =
      response?.choices?.[0]?.message?.content?.trim() ||
      "No response generated.";

    return res.status(200).json({
      message: "success",
      data: { content: result },
    });
  } catch (err) {
    console.error("[AI-COMPLETION] Error:", err.message);
    return res
      .status(500)
      .json({ message: err.message || "Failed to generate AI response" });
  }
};
