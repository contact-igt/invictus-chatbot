import express from "express";
import {
  deleteKnowledge,
  permanentDeleteKnowledge,
  getKnowledgeById,
  listKnowledge,
  searchKnowledgeChunksController,
  updateKnowledge,
  updateKnowledgeStatusController,
  uploadKnowledge,
  getDeletedKnowledgeController,
  restoreKnowledgeController,
} from "./knowledge.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];
const managerRoles = ["tenant_admin", "staff"];

router.get(
  "/knowledges/deleted/list",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  getDeletedKnowledgeController,
);

router.post(
  "/knowledge",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  uploadKnowledge,
);
router.get(
  "/knowledges",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  listKnowledge,
);
router.get(
  "/knowledge/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getKnowledgeById,
);
router.put(
  "/knowledge/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  updateKnowledge,
);
router.delete(
  "/knowledge/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  deleteKnowledge,
);
router.delete(
  "/knowledge/:id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  permanentDeleteKnowledge,
);
router.post(
  "/knowledge/:id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  restoreKnowledgeController,
);
router.put(
  "/knowledge-status/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  updateKnowledgeStatusController,
);
router.post(
  "/knowledge-search",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  searchKnowledgeChunksController,
);

export default router;
