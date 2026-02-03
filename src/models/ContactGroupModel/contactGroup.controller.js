import {
    createContactGroupService,
    getContactGroupListService,
    getContactGroupByIdService,
    addContactsToGroupService,
    removeContactFromGroupService,
    deleteContactGroupService,
    updateContactGroupService,
    getAvailableContactsForGroupService,
} from "./contactGroup.service.js";

export const createContactGroupController = async (req, res) => {
    const tenant_id = req.user.tenant_id;

    try {
        const group = await createContactGroupService(tenant_id, req.body);
        return res.status(200).send({
            message: "Group created successfully",
            group,
        });
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const getContactGroupListController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    try {
        const data = await getContactGroupListService(tenant_id, req.query);
        return res.status(200).send({
            message: "Success",
            data,
        });
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const getContactGroupByIdController = async (req, res) => {
    const { group_id } = req.params;
    const tenant_id = req.user.tenant_id;
    try {
        const group = await getContactGroupByIdService(group_id, tenant_id);
        if (!group) {
            return res.status(404).send({ message: "Group not found" });
        }
        return res.status(200).send({
            message: "Success",
            data: group,
        });
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const addContactsToGroupController = async (req, res) => {
    const { group_id } = req.params;
    const { contact_ids } = req.body;
    const tenant_id = req.user.tenant_id;

    try {
        const result = await addContactsToGroupService(group_id, tenant_id, contact_ids);
        return res.status(200).send(result);
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const removeContactFromGroupController = async (req, res) => {
    const { group_id, contact_id } = req.params;
    const tenant_id = req.user.tenant_id;

    try {
        const result = await removeContactFromGroupService(group_id, contact_id, tenant_id);
        return res.status(200).send(result);
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const deleteContactGroupController = async (req, res) => {
    const { group_id } = req.params;
    const tenant_id = req.user.tenant_id;

    try {
        const result = await deleteContactGroupService(group_id, tenant_id);
        return res.status(200).send(result);
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const updateContactGroupController = async (req, res) => {
    const { group_id } = req.params;
    const tenant_id = req.user.tenant_id;
    const { group_name, description } = req.body;

    try {
        const result = await updateContactGroupService(group_id, tenant_id, { group_name, description });
        return res.status(200).send({
            message: "Group updated successfully",
            data: result
        });
    } catch (err) {
        if (err.message === "Group not found") {
            return res.status(404).send({ message: err.message });
        }
        if (err.message === "Group name already exists") {
            return res.status(409).send({ message: err.message });
        }
        return res.status(500).send({ message: err.message });
    }
};

export const getAvailableContactsController = async (req, res) => {
    const { group_id } = req.params;
    const tenant_id = req.user.tenant_id;

    try {
        const contacts = await getAvailableContactsForGroupService(group_id, tenant_id);
        return res.status(200).send({
            message: "Available contacts fetched successfully",
            data: contacts
        });
    } catch (err) {
        if (err.message === "Group not found") {
            return res.status(404).send({ message: err.message });
        }
        return res.status(500).send({ message: err.message });
    }
};
