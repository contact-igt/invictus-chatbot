import { scrapeWebsiteText } from "../../utils/text/scrapeWebsiteText.js";
import { cleanText } from "../../utils/text/cleanText.js";
import { processKnowledgeWithAi } from "../../utils/ai/processKnowledgeAi.js";
import {
  deleteKnowledgeService,
  permanentDeleteKnowledgeService,
  getKnowledgeByIdService,
  listKnowledgeService,
  processKnowledgeUpload,
  updateKnowledgeService,
  updateKnowledgeStatusService,
  getDeletedKnowledgeListService,
  restoreKnowledgeService,
} from "./knowledge.service.js";
import { searchKnowledgeChunks } from "./knowledge.search.js";

export const getDeletedKnowledgeController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  try {
    const data = await getDeletedKnowledgeListService(tenant_id);
    return res.status(200).send({
      message: "Success",
      data,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const restoreKnowledgeController = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;
  try {
    const result = await restoreKnowledgeService(id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    if (err.message === "Knowledge source not found or not deleted") {
      return res.status(404).send({ message: err.message });
    }
    return res.status(500).send({ message: err.message });
  }
};

export const uploadKnowledge = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { title, type, text, source_url, file_name, prompt } = req.body;

    if (!title || !type) {
      return res.status(400).json({ message: "Title & type required" });
    }

    let finalText = "";
    let sourceUrl = null;

    if (type === "text" || type === "file") {
      if (!text || text.trim().length < 10) {
        return res.status(400).json({ message: "Text content must be at least 10 characters long." });
      }
      finalText = text;
    }

    if (type === "url") {
      if (!source_url) {
        return res.status(400).json({ message: "Website URL is required" });
      }
      
      try {
        const scraped = await scrapeWebsiteText(source_url);
        finalText = scraped.content;
        sourceUrl = source_url;

        // AI Feature: Always process the scraped text with AI for optimal quality
        if (finalText) {
          finalText = await processKnowledgeWithAi(finalText, prompt);
        }
      } catch (scrapeErr) {
        return res.status(400).json({ 
          message: `Failed to scrape website: ${scrapeErr.message}. Please ensure the URL is correct and accessible.` 
        });
      }
    }

    if (!finalText || finalText.trim().length === 0) {
      return res.status(400).json({ message: "No content found for the provided source." });
    }

    const cleanedText = cleanText(finalText);

    await processKnowledgeUpload(
      tenant_id,
      title,
      type,
      sourceUrl,
      cleanedText,
      file_name,
    );

    res.json({ success: true, message: "Knowledge source added successfully." });
  } catch (err) {
    console.error("[UPLOAD-KNOWLEDGE] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const listKnowledge = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const data = await listKnowledgeService(tenant_id, req.query);
    return res.status(200).send({
      data: data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getKnowledgeById = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { id } = req.params;
    const data = await getKnowledgeByIdService(id, tenant_id);

    if (!data) {
      return res.status(404).json({ message: "Knowledge not found" });
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateKnowledge = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { id } = req.params;
    const { title, text } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Title is required" });
    }

    // Call service with optional text. If text is provided, it will re-chunk.
    await updateKnowledgeService(id, tenant_id, title, text);
    res.json({ message: "Knowledge updated successfully" });
  } catch (err) {
    console.error("[UPDATE-KNOWLEDGE] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const deleteKnowledge = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { id } = req.params;
    await deleteKnowledgeService(id, tenant_id);
    res.json({ message: "Knowledge deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const permanentDeleteKnowledge = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { id } = req.params;
    await permanentDeleteKnowledgeService(id, tenant_id);
    res.json({ message: "Knowledge and its chunks permanently deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateKnowledgeStatusController = async (req, res) => {
  const { id } = req.params;
  const { status } = req.query;

  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  if (!status || !id) {
    return res.status(400).send({
      message: "Knowledge status  or id required",
    });
  }

  try {
    await updateKnowledgeStatusService(status, id, tenant_id);

    return res.status(200).send({
      message: "Knowledge status updated successfully",
    });
  } catch (err) {
    return res.status(500).json({
      message: err?.message,
    });
  }
};

export const searchKnowledgeChunksController = async (req, res) => {
  const { question } = req.body;

  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  if (!question) {
    return res.status(400).send({
      message: "Knowledge search question or required",
    });
  }

  try {
    const data = await searchKnowledgeChunks(tenant_id, question);

    return res.status(200).send({
      message: "Knowledge search successful",
      output: data.chunks, // Maintain output as array for legacy UI
      full_analysis: data, // Return full object for modern consumers
    });
  } catch (err) {
    return res.status(500).json({
      message: err?.message,
    });
  }
};
