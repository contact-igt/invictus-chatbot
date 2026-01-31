import express from "express";
import {
  createContactController,
  deleteContactController,
  getAllContactsController,
  getContactByIdController,
  updateContactController,
} from "./contacts.controller.js";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.post("/contact", authenticate, createContactController);
Router.get("/contacts", authenticate, getAllContactsController);
Router.get("/contact/:id", authenticate, getContactByIdController);
Router.put("/contact/:id", authenticate, updateContactController);
Router.delete("/contact/:id", authenticate, deleteContactController);

export default Router;
