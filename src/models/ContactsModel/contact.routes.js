import express from "express";
import {
  createContactController,
  getAllContactsController,
} from "./contacts.controller.js";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.post("/contact-create", createContactController);
Router.get("/contacts", authenticate, getAllContactsController);

export default Router;
