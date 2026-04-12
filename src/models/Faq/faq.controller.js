import {
  listFaqReviewsService,
  getFaqCountsService,
  getFaqMasterSourceService,
  saveFaqDraftService,
  publishFaqService,
  createFaqService,
  toggleFaqActiveService,
  softDeleteFaqService,
  listFaqKnowledgeEntriesService,
  getFaqKnowledgeEntryService,
  editFaqKnowledgeEntryService,
  removeFaqKnowledgeEntryService,
} from "./faq.service.js";

// ─── List FAQ Reviews  GET /faq-reviews ──────────────────────────────────
export const listFaqReviewsController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { status = "pending_review", page = 1, limit = 20 } = req.query;

  const allowedStatuses = ["pending_review", "published", "deleted"];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid status filter" });
  }

  try {
    const data = await listFaqReviewsService(
      tenant_id,
      status,
      parseInt(page, 10) || 1,
      Math.min(parseInt(limit, 10) || 20, 100),
    );
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── FAQ Counts  GET /faq-reviews/counts ─────────────────────────────────
export const getFaqCountsController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  try {
    const data = await getFaqCountsService(tenant_id);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── Master FAQ Source  GET /faq-reviews/master-source ───────────────────
export const getFaqMasterSourceController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  try {
    const data = await getFaqMasterSourceService(tenant_id);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── Save Draft  PUT /faq-reviews/:id ────────────────────────────────────
export const saveFaqDraftController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;
  const { question, doctor_answer } = req.body;

  if (question === undefined && doctor_answer === undefined) {
    return res.status(400).json({ message: "Nothing to update" });
  }

  try {
    const data = await saveFaqDraftService(id, tenant_id, question, doctor_answer);
    if (!data) return res.status(404).json({ message: "FAQ not found" });
    return res.status(200).json({ message: "Draft saved", data });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── Publish FAQ  PUT /faq-reviews/:id/publish ───────────────────────────
export const publishFaqController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;
  const reviewed_by = req.user?.name || req.user?.email || null;
  const payload = req.body || {};

  try {
    const data = await publishFaqService(id, tenant_id, reviewed_by, payload);
    if (!data) return res.status(404).json({ message: "FAQ not found" });
    return res.status(200).json({ message: "FAQ published", data });
  } catch (err) {
    if (err.message.includes("without a doctor answer")) {
      return res.status(400).json({ message: err.message });
    }
    return res.status(500).json({ message: err.message });
  }
};

// ─── Create FAQ (Admin Direct Add)  POST /faq-reviews ────────────────────
export const createFaqController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const created_by = req.user?.name || req.user?.email || null;
  const { question, answer } = req.body;

  if (!question?.trim() || !answer?.trim()) {
    return res.status(400).json({ 
      message: "Question and answer are required and cannot be empty" 
    });
  }

  try {
    const data = await createFaqService(tenant_id, created_by, question, answer);
    return res.status(201).json({ 
      message: "FAQ created and published successfully", 
      data 
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── Toggle is_active  PUT /faq-reviews/:id/toggle ───────────────────────
export const toggleFaqActiveController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;

  try {
    const data = await toggleFaqActiveService(id, tenant_id);
    if (!data) {
      return res.status(404).json({ message: "Published FAQ not found" });
    }
    return res.status(200).json({ message: "FAQ active status toggled", data });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── Soft Delete  DELETE /faq-reviews/:id/soft ────────────────────────────
export const softDeleteFaqController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;

  try {
    const deleted = await softDeleteFaqService(id, tenant_id);
    if (!deleted) return res.status(404).json({ message: "FAQ not found" });
    return res.status(200).json({ message: "FAQ deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── List Knowledge Entries  GET /faq-reviews/knowledge-entries ───────────
export const listFaqKnowledgeEntriesController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { page = 1, limit = 50 } = req.query;

  try {
    const data = await listFaqKnowledgeEntriesService(
      tenant_id,
      parseInt(page, 10) || 1,
      Math.min(parseInt(limit, 10) || 50, 200),
    );
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── Get Single Knowledge Entry  GET /faq-reviews/knowledge-entries/:id ───
export const getFaqKnowledgeEntryController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;

  try {
    const data = await getFaqKnowledgeEntryService(id, tenant_id);
    if (!data) return res.status(404).json({ message: "Entry not found" });
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── Edit Knowledge Entry  PUT /faq-reviews/knowledge-entries/:id ─────────
export const editFaqKnowledgeEntryController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;
  const { question, answer } = req.body;
  const updated_by = req.user?.id || req.user?.tenant_id || null;

  if (question === undefined && answer === undefined) {
    return res.status(400).json({ message: "Nothing to update" });
  }

  try {
    const data = await editFaqKnowledgeEntryService(id, tenant_id, {
      question,
      answer,
      updated_by,
    });
    if (!data) return res.status(404).json({ message: "Entry not found" });
    return res.status(200).json({ message: "FAQ entry updated", data });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── Remove Knowledge Entry  DELETE /faq-reviews/knowledge-entries/:id ────
export const removeFaqKnowledgeEntryController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;

  try {
    const removed = await removeFaqKnowledgeEntryService(id, tenant_id);
    if (!removed) return res.status(404).json({ message: "Entry not found" });
    return res.status(200).json({ message: "FAQ entry removed" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
