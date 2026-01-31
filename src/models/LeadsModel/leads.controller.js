import { getContactByIdAndTenantIdService } from "../ContactsModel/contacts.service.js";
import {
  deleteLeadService,
  getLeadListService,
  getLeadSummaryService,
  updateLeadStatusService,
} from "./leads.service.js";

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
      message: err,
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
    const contactDetails = await getContactByIdAndTenantIdService(
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
  const { status, heat_state } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !id) {
    return res.status(400).send({
      message: "Tenant id or contact id missing",
    });
  }

  try {
    await updateLeadStatusService(tenant_id, id, status, heat_state);
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
