import express from "express";
import {
  createMentorController,
  getAllMentorsController,
  getMentorByIdController,
  updateMentorController,
  deleteMentorController,
} from "./mentors.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { checkFeatureAccess } from "../../middlewares/feature/checkFeatureAccess.js";

const Router = express.Router();
const tenantRoles = ["tenant_admin", "staff"];

// Create mentor
Router.post(
  "/courses/mentors",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("mentors"),
  createMentorController
);

// Get all mentors
Router.get(
  "/courses/mentors",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("mentors"),
  getAllMentorsController
);

// Get mentor by ID
Router.get(
  "/courses/mentors/:mentor_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("mentors"),
  getMentorByIdController
);

// Update mentor
Router.put(
  "/courses/mentors/:mentor_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("mentors"),
  updateMentorController
);

// Delete mentor
Router.delete(
  "/courses/mentors/:mentor_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("mentors"),
  deleteMentorController
);

export default Router;
