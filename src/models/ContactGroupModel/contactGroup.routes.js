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
    updateContactGroupController,
    getAvailableContactsController,
} from "./contactGroup.controller.js";

const router = express.Router();

// Create a new group
router.post(
    "/contact-group",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
    createContactGroupController
);

// Get all groups
router.get(
    "/contact-group/list",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
    getContactGroupListController
);

// Get a single group by ID
router.get(
    "/contact-group/:group_id",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
    getContactGroupByIdController
);

// Get available contacts (not in group)
router.get(
    "/contact-group/:group_id/available-contacts",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
    getAvailableContactsController
);

// Update group details
router.put(
    "/contact-group/:group_id",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
    updateContactGroupController
);

// Add contacts to a group
router.post(
    "/contact-group/:group_id/add-contacts",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
    addContactsToGroupController
);

// Remove a contact from a group
router.delete(
    "/contact-group/:group_id/contact/:contact_id",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
    removeContactFromGroupController
);

// Delete a group
router.delete(
    "/contact-group/:group_id",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
    deleteContactGroupController
);

export default router;
