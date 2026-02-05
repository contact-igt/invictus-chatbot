import { cleanText } from "../../utils/cleanText.js";
import {
  deleteAiPromptService,
  getActivePromptService,
  getAiPromptByIdService,
  listAiPromptService,
  permanentDeleteAiPromptService,
  processAiPromptUpload,
  updateAiPromptService,
  updatePromptActiveService,
} from "./aiprompt.service.js";

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
