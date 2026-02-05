import { scrapeWebsiteText } from "../../utils/scrapeWebsiteText.js";
import {
  deleteKnowledgeService,
  permanentDeleteKnowledgeService,
  getKnowledgeByIdService,
  listKnowledgeService,
  processKnowledgeUpload,
  updateKnowledgeService,
  updateKnowledgeStatusService,
} from "./knowledge.service.js";
import { cleanText } from "../../utils/cleanText.js";
import { searchKnowledgeChunks } from "./knowledge.search.js";

export const uploadKnowledge = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const { title, type, text, source_url, file_name } = req.body;

    if (!title || !type) {
      return res.status(400).json({ message: "Title & type required" });
    }

    let finalText = "";
    let sourceUrl = null;

    if (type === "text" || type === "file") {
      if (!text || text.trim().length < 10) {
        return res.status(400).json({ message: "Text missing" });
      }
      finalText = text;
    }

    if (type === "url") {
      if (!source_url) {
        return res.status(400).json({ message: "URL required" });
      }
      const scraped = await scrapeWebsiteText(source_url);
      finalText = scraped.content;
      sourceUrl = source_url;
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

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

export const listKnowledge = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const data = await listKnowledgeService(tenant_id);
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

    if (!title || !text) {
      return res.status(400).json({ message: "title and text required" });
    }

    await updateKnowledgeService(id, tenant_id, title, text);
    res.json({ message: "Knowledge updated successfully" });
  } catch (err) {
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
      message: "Knowledge status updated successfully",
      output: data,
    });
  } catch (err) {
    return res.status(500).json({
      message: err?.message,
    });
  }
};
