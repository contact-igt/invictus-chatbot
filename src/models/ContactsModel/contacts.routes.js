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
  importContactsController,
  toggleSilenceAiController,
} from "./contacts.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

Router.post(
  "/contact",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  createContactController,
);

Router.get(
  "/contacts",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getAllContactsController,
);

Router.get(
  "/contact/:contact_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getContactByIdController,
);

Router.put(
  "/contact/:contact_id",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  updateContactController,
);

Router.delete(
  "/contact/:contact_id/soft",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  deleteContactController,
);

Router.delete(
  "/contact/:contact_id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  permanentDeleteContactController,
);

Router.post(
  "/contact/:contact_id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  restoreContactController,
);

Router.get(
  "/contacts/deleted/list",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getDeletedContactListController,
);

Router.post(
  "/contact/import",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
  importContactsController,
);

Router.patch(
  "/contact/:contact_id/silence",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  toggleSilenceAiController,
);

export default Router;
