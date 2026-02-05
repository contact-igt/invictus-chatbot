import express from "express";
import {
  acceptTenantInvitationController,
  rejectTenantInvitationController,
  setTenantPasswordController,
  verifyTenantInvitationController,
} from "./tenantinvitation.controller.js";

const Router = express.Router();

Router.get("/invite/verify", verifyTenantInvitationController);
Router.post("/invite/accept", acceptTenantInvitationController);
Router.post("/invite/reject", rejectTenantInvitationController);
Router.post("/invite/set-password", setTenantPasswordController);
export default Router;
