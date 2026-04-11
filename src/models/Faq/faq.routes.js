import express from "express";
import {
  listFaqReviewsController,
  getFaqCountsController,
  getFaqMasterSourceController,
  saveFaqDraftController,
  publishFaqController,
  createFaqController,
  toggleFaqActiveController,
  softDeleteFaqController,
  listFaqKnowledgeEntriesController,
  getFaqKnowledgeEntryController,
  editFaqKnowledgeEntryController,
  removeFaqKnowledgeEntryController,
} from "./faq.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const router = express.Router();

const managerRoles = ["tenant_admin", "staff", "doctor"];

// GET  /faq-reviews
router.get(
  "/faq-reviews",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  listFaqReviewsController,
);

// GET  /faq-reviews/counts
router.get(
  "/faq-reviews/counts",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  getFaqCountsController,
);

// GET  /faq-reviews/master-source
router.get(
  "/faq-reviews/master-source",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  getFaqMasterSourceController,
);

// POST /faq-reviews  (admin creates new FAQ directly as published)
router.post(
  "/faq-reviews",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  createFaqController,
);

// PUT  /faq-reviews/:id  (save draft)
router.put(
  "/faq-reviews/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  saveFaqDraftController,
);

// PUT  /faq-reviews/:id/publish
router.put(
  "/faq-reviews/:id/publish",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  publishFaqController,
);

// PUT  /faq-reviews/:id/toggle
router.put(
  "/faq-reviews/:id/toggle",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  toggleFaqActiveController,
);

// DELETE  /faq-reviews/:id/soft
router.delete(
  "/faq-reviews/:id/soft",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  softDeleteFaqController,
);

// GET  /faq-reviews/knowledge-entries
router.get(
  "/faq-reviews/knowledge-entries",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  listFaqKnowledgeEntriesController,
);

// GET  /faq-reviews/knowledge-entries/:id
router.get(
  "/faq-reviews/knowledge-entries/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  getFaqKnowledgeEntryController,
);

// PUT  /faq-reviews/knowledge-entries/:id
router.put(
  "/faq-reviews/knowledge-entries/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  editFaqKnowledgeEntryController,
);

// DELETE  /faq-reviews/knowledge-entries/:id
router.delete(
  "/faq-reviews/knowledge-entries/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  removeFaqKnowledgeEntryController,
);

export default router;
