import express from "express";
import {
  getLeadListController,
  getLeadSummaryController,
} from "./leads.controller.js";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.get("/leads", authenticate, getLeadListController);
Router.get("/leads-summary/:id", authenticate, getLeadSummaryController);

export default Router;
