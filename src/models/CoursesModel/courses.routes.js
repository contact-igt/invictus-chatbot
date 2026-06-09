import express from "express";
import {
  createCourseController,
  getAllCoursesController,
  getCourseByIdController,
  updateCourseController,
  deleteCourseController,
} from "./courses.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { checkFeatureAccess } from "../../middlewares/feature/checkFeatureAccess.js";

const Router = express.Router();
const tenantRoles = ["tenant_admin", "staff"];

// Create course
Router.post(
  "/courses",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("courses"),
  createCourseController
);

// Get all courses
Router.get(
  "/courses",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("courses"),
  getAllCoursesController
);

// Get course by ID
Router.get(
  "/courses/:course_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("courses"),
  getCourseByIdController
);

// Update course
Router.put(
  "/courses/:course_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("courses"),
  updateCourseController
);

// Delete course
Router.delete(
  "/courses/:course_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("courses"),
  deleteCourseController
);

export default Router;

