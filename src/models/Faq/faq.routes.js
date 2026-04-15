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
  getDeletedFaqReviewsController,
  restoreFaqReviewController,
  hardDeleteFaqReviewController,
} from "./faq.lifecycle.js";
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

// GET     /faq-reviews/deleted
router.get(
  "/faq-reviews/deleted",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  getDeletedFaqReviewsController,
);

// PUT     /faq-reviews/:id/restore
router.put(
  "/faq-reviews/:id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  restoreFaqReviewController,
);

// DELETE  /faq-reviews/:id/soft
router.delete(
  "/faq-reviews/:id/soft",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  softDeleteFaqController,
);

// DELETE  /faq-reviews/:id  (hard delete — admin only)
router.delete(
  "/faq-reviews/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  hardDeleteFaqReviewController,
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
