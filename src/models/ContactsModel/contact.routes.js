import express from "express";
import {
  createContactController,
  deleteContactController,
  permanentDeleteContactController,
  getAllContactsController,
  getContactByIdController,
  updateContactController,
  getDeletedContactListController,
  restoreContactController,
} from "./contacts.controller.js";
import { authenticate, authorize } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

Router.post(
  "/contact",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  createContactController,
);

Router.post(
  "/contact/:id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  restoreContactController,
);




Router.get(
  "/contacts/deleted/list",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getDeletedContactListController,
);
Router.get(
  "/contacts",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getAllContactsController,
);
Router.get(
  "/contact/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getContactByIdController,
);


Router.put(
  "/contact/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateContactController,
);


Router.delete(
  "/contact/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  deleteContactController,
);
Router.delete(
  "/contact/:id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  permanentDeleteContactController,
);




export default Router;


