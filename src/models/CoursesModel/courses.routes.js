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

const Router = express.Router();

const tenantRoles = ["tenant_admin", "staff", "doctor", "agent"];

// Create course
Router.post(
  "/courses",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  createCourseController
);

// Get all courses
Router.get(
  "/courses",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getAllCoursesController
);

// Get course by ID
Router.get(
  "/courses/:course_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getCourseByIdController
);

// Update course
Router.put(
  "/courses/:course_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateCourseController
);

// Delete course
Router.delete(
  "/courses/:course_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  deleteCourseController
);

export default Router;
