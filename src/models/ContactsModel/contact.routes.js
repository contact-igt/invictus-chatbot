import express from "express";
import {
  createContactController,
  deleteContactController,
  getAllContactsController,
  getContactByIdController,
  updateContactController,
} from "./contacts.controller.js";
import { authenticate, authorize } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.post("/contact", authenticate, authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }), createContactController);
Router.get("/contacts", authenticate, authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }), getAllContactsController);
Router.get("/contact/:id", authenticate, authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }), getContactByIdController);
Router.put("/contact/:id", authenticate, authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }), updateContactController);
Router.delete("/contact/:id", authenticate, authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }), deleteContactController);

export default Router;


