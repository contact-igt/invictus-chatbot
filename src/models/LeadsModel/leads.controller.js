import { getContactByContactIdAndTenantIdService, getContactByIdAndTenantIdService } from "../ContactsModel/contacts.service.js";
import {
  deleteLeadService,
  permanentDeleteLeadService,
  getLeadListService,
  getLeadSummaryService,
  updateLeadService,
  updateLeadStatusService,
  getDeletedLeadListService,
  restoreLeadService,
} from "./leads.service.js";

export const getDeletedLeadListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  try {
    const data = await getDeletedLeadListService(tenant_id, req.query);
    return res.status(200).send({
      message: "Success",
      data,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const restoreLeadController = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;
  try {
    const result = await restoreLeadService(id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    if (err.message === "Lead not found or not deleted") {
      return res.status(404).send({ message: err.message });
    }
    return res.status(500).send({ message: err.message });
  }
};

export const getLeadListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({
      message: "Tenant id missing",
    });
  }

  try {
    const response = await getLeadListService(tenant_id);

    return res.status(200).send({
      message: "success",
      data: response,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message || err,
    });
  }
};

export const getLeadSummaryController = async (req, res) => {
  const { id } = req.params;

  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !id) {
    return res.status(400).send({
      message: "Tenant id or contact id missing",
    });
  }

  try {
    const contactDetails = await getContactByContactIdAndTenantIdService(
      id,
      tenant_id,
    );

    const response = await getLeadSummaryService(
      tenant_id,
      contactDetails?.phone,
      id,
    );

    return res.status(200).send({
      message: "success",
      data: response,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const updateLeadController = async (req, res) => {
  const { id } = req.params;
  const { status, heat_state, lead_stage, assigned_to, priority, internal_notes } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !id) {
    return res.status(400).send({
      message: "Tenant id or contact id missing",
    });
  }

  try {
    await updateLeadStatusService(
      tenant_id,
      id,
      status,
      heat_state,
      lead_stage,
      assigned_to,
      priority,
      internal_notes,
    );
    return res.status(200).send({
      message: "Lead updated successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const deleteLeadController = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !id) {
    return res.status(400).send({
      message: "Tenant id or contact id missing",
    });
  }

  try {
    await deleteLeadService(tenant_id, id);
    return res.status(200).send({
      message: "Lead deleted successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const permanentDeleteLeadController = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !id) {
    return res.status(400).send({
      message: "Tenant id or contact id missing",
    });
  }

  try {
    await permanentDeleteLeadService(tenant_id, id);
    return res.status(200).send({
      message: "Lead permanently deleted",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};
