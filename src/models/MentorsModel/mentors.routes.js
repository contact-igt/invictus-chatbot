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

const Router = express.Router();

const tenantRoles = ["tenant_admin", "staff", "doctor", "agent"];

// Create mentor
Router.post(
  "/courses/mentors",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  createMentorController
);

// Get all mentors
Router.get(
  "/courses/mentors",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getAllMentorsController
);

// Get mentor by ID
Router.get(
  "/courses/mentors/:mentor_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getMentorByIdController
);

// Update mentor
Router.put(
  "/courses/mentors/:mentor_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateMentorController
);

// Delete mentor
Router.delete(
  "/courses/mentors/:mentor_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  deleteMentorController
);

export default Router;
