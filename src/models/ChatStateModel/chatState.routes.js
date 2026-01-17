import express from "express";

import {
  authenticate,
  requireManagement,
} from "../../middlewares/auth/authMiddlewares.js";
import { getChatStateList } from "./chatState.controller.js";

const Router = express.Router();

Router.get("/chatstates", authenticate, requireManagement, getChatStateList);

export default Router;
