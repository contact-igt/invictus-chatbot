import express from "express";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import {
  createTenantUsercontroller,
  getAllTenantUsersController,
  getTenantUserByIdController,
  loginTenantUserController,
  permanentDeleteTenantUserController,
  softDeleteTenantUserController,
  updateTenantUserByIdController,
} from "./tenantuser.controller.js";

const Router = express.Router();

Router.post(
  "/tenant-user",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin"],
  }),
  createTenantUsercontroller,
);

Router.post("/tenant-user/login", loginTenantUserController);


Router.get(
  "/tenant-users",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin"],
  }),
  getAllTenantUsersController,
);

Router.get(
  "/tenant-user/:id",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "doctor", "staff", "agent"],
  }),
  getTenantUserByIdController,
);

Router.put(
  "/tenant-user/:id",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "doctor", "staff", "agent"],
  }),
  updateTenantUserByIdController,
);

Router.delete(
  "/tenant-user/:id",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin"],
  }),
  softDeleteTenantUserController,
);

/* ⚠️ PERMANENT DELETE – USE CAREFULLY */
Router.delete(
  "/tenant-user/:id/permanent",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin"],
  }),
  permanentDeleteTenantUserController,
);

export default Router;
