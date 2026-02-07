import express from "express";
import {
    authenticate,
    authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import {
    createContactGroupController,
    getContactGroupListController,
    getContactGroupByIdController,
    addContactsToGroupController,
    removeContactFromGroupController,
    deleteContactGroupController,
    permanentDeleteContactGroupController,
    updateContactGroupController,
    getAvailableContactsController,
    getDeletedContactGroupListController,
    restoreContactGroupController,
} from "./contactGroup.controller.js";

const router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];
const managerRoles = ["tenant_admin", "staff"];

// Create a new group
router.post(
    "/contact-group",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    createContactGroupController
);

// Get deleted groups
router.get(
    "/contact-group/deleted/list",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    getDeletedContactGroupListController
);

// Get all groups
router.get(
    "/contact-group/list",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    getContactGroupListController
);

// Get a single group by ID
router.get(
    "/contact-group/:group_id",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    getContactGroupByIdController
);

// Restore a group
router.post(
    "/contact-group/:group_id/restore",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
    restoreContactGroupController
);

// Get available contacts (not in group)
router.get(
    "/contact-group/:group_id/available-contacts",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    getAvailableContactsController
);

// Update group details
router.put(
    "/contact-group/:group_id",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    updateContactGroupController
);

// Add contacts to a group
router.post(
    "/contact-group/:group_id/add-contacts",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    addContactsToGroupController
);

// Remove a contact from a group
router.delete(
    "/contact-group/:group_id/contact/:contact_id",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    removeContactFromGroupController
);

// Delete a group (soft)
router.delete(
    "/contact-group/:group_id",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    deleteContactGroupController
);

// Delete a group (permanent)
router.delete(
    "/contact-group/:group_id/permanent",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
    permanentDeleteContactGroupController
);

export default router;
