import { missingFieldsChecker } from "../../utils/helpers/missingFields.js";
import {
    createSpecializationService,
    getAllSpecializationsService,
    getSpecializationByIdService,
    updateSpecializationService,
    deleteSpecializationService,
    toggleActiveStatusService,
    getDeletedSpecializationListService,
    restoreSpecializationService,
    permanentDeleteSpecializationService,
} from "./specialization.service.js";

// create
export const createSpecializationController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    const { name, description } = req.body;

    const requiredFields = { name };
    const missing = await missingFieldsChecker(requiredFields);
    if (missing.length > 0) {
        return res.status(400).send({ message: `Missing fields: ${missing.join(", ")}` });
    }

    try {
        const result = await createSpecializationService(tenant_id, name, description);
        return res.status(201).send({
            message: "success",
            data: result,
        });
    } catch (err) {
        if (err.name === "SequelizeUniqueConstraintError") {
            return res.status(409).send({ message: "This specialization already exists" });
        }
        return res.status(500).send({ message: err.message });
    }
};

// update
export const updateSpecializationController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    const { id } = req.params;
    const { name } = req.body;

    // Name is optional in update now, but if provided must be valid
    if (name !== undefined && (!name || !name.trim())) {
        return res.status(400).send({ message: "Specialization name cannot be empty" });
    }

    try {
        const result = await updateSpecializationService(id, tenant_id, req.body);
        return res.status(200).send(result);
    } catch (err) {
        if (err.message === "Specialization not found") {
            return res.status(404).send({ message: err.message });
        }
        if (err.name === "SequelizeUniqueConstraintError") {
            return res.status(409).send({ message: "This specialization name already exists" });
        }
        return res.status(500).send({ message: err.message });
    }
};

export const getAllSpecializationsController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    const { search } = req.query;

    try {
        const result = await getAllSpecializationsService(tenant_id, search);
        return res.status(200).send({
            message: "success",
            data: result,
        });
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const getSpecializationByIdController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    const { id } = req.params;

    try {
        const result = await getSpecializationByIdService(id, tenant_id);
        if (!result) {
            return res.status(404).send({ message: "Specialization not found" });
        }
        return res.status(200).send({
            message: "success",
            data: result,
        });
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};


// Toggle Active Status
export const toggleActiveStatusController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    const { id } = req.params;

    try {
        const result = await toggleActiveStatusService(id, tenant_id);
        return res.status(200).send(result);
    } catch (err) {
        if (err.message === "Specialization not found") {
            return res.status(404).send({ message: err.message });
        }
        return res.status(500).send({ message: err.message });
    }
};

export const deleteSpecializationController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    const { id } = req.params;

    try {
        const result = await deleteSpecializationService(id, tenant_id);
        return res.status(200).send(result);
    } catch (err) {
        if (err.message === "Specialization not found") {
            return res.status(404).send({ message: err.message });
        }
        if (err.message.startsWith("Cannot delete:")) {
            return res.status(409).send({ message: err.message });
        }
        return res.status(500).send({ message: err.message });
    }
};

export const getDeletedSpecializationListController = async (req, res) => {
    const tenant_id = req.user.tenant_id;

    try {
        const result = await getDeletedSpecializationListService(tenant_id);
        return res.status(200).send({
            message: "success",
            data: result,
        });
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const restoreSpecializationController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    const { id } = req.params;

    try {
        const result = await restoreSpecializationService(id, tenant_id);
        return res.status(200).send(result);
    } catch (err) {
        if (err.message === "Specialization not found or not deleted") {
            return res.status(404).send({ message: err.message });
        }
        return res.status(500).send({ message: err.message });
    }
};

export const permanentDeleteSpecializationController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    const { id } = req.params;

    try {
        const result = await permanentDeleteSpecializationService(id, tenant_id);
        return res.status(200).send(result);
    } catch (err) {
        if (err.message === "Specialization not found") {
            return res.status(404).send({ message: err.message });
        }
        return res.status(500).send({ message: err.message });
    }
};
