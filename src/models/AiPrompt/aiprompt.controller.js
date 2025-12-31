import { cleanText } from "../../utils/cleanText.js";
import {
  checkIsAnyActivePromptService,
  deleteAiPromptService,
  getActivePromptService,
  getAiPromptByIdService,
  listAiPromptService,
  processAiPromptUpload,
  updateAiPromptService,
  updatePromptActiveService,
} from "./aiprompt.service.js";

export const uploadAiPrompt = async (req, res) => {
  try {
    const { name, prompt } = req.body;

    let finalText = "";

    if (!prompt || prompt.trim().length < 10) {
      return res.status(400).json({ message: "Text missing" });
    }

    finalText = prompt;

    const cleanedText = cleanText(finalText);

    await processAiPromptUpload(name ? name : null, cleanedText);

    return res.status(200).send({
      message: "Prompt uploaded successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

export const listAiPrompt = async (req, res) => {
  try {
    const data = await listAiPromptService();
    return res.status(200).send({
      data: data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAiPromptById = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await getAiPromptByIdService(id);

    if (!data) {
      return res.status(404).json({ message: "Propmt not found" });
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateAiPrompt = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ message: "prompt required" });
    }

    await updateAiPromptService(id, name, prompt);
    res.json({ message: "Propmt updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updatePromptActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (!id) {
      return res.status(400).json({ message: "prompt id required" });
    }

    if (is_active === "true") {
      const activelist = await checkIsAnyActivePromptService();
      if (activelist?.active_count > 0) {
        return res.status(400).send({
          message: "Only one prompt can be active",
        });
      }
    }

    await updatePromptActiveService(id, is_active);
    res.json({ message: "Prompt activated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteAiPrompt = async (req, res) => {
  try {
    const { id } = req.params;
    await deleteAiPromptService(id);
    res.json({ message: "Propmt deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getActivePromptController = async (req, res) => {
  try {
    const statuspropmt = await getActivePromptService();
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
