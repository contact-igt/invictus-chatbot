import express from "express";
import {
  deleteLeadController,
  getLeadListController,
  getLeadSummaryController,
  updateLeadController,
} from "./leads.controller.js";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.get("/leads", authenticate, getLeadListController);
Router.get("/leads-summary/:id", authenticate, getLeadSummaryController);
Router.put("/lead/:id", authenticate, updateLeadController);
Router.delete("/lead/:id", authenticate, deleteLeadController);

export default Router;
