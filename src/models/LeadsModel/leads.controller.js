import {
  getContactByContactIdAndTenantIdService,
  getContactByIdAndTenantIdService,
} from "../ContactsModel/contacts.service.js";
import {
  deleteLeadService,
  permanentDeleteLeadService,
  getLeadListService,
  getLeadSummaryService,
  updateLeadService,
  updateLeadStatusService,
  getDeletedLeadListService,
  restoreLeadService,
  getLeadByLeadIdService,
  getBulkLeadSummaryService,
  bulkUpdateLeadsService,
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
      message: err?.message || err,
    });
  }
};

export const getLeadByIdController = async (req, res) => {
  const { lead_id } = req.params;

  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !lead_id) {
    return res.status(400).send({
      message: "Tenant id or lead id missing",
    });
  }

  try {
    const lead = await getLeadByLeadIdService(tenant_id, lead_id);
    if (!lead) {
      return res.status(404).send({ message: "Lead not found" });
    }
    return res.status(200).send({
      message: "success",
      data: lead,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const getLeadSummaryController = async (req, res) => {
  const { lead_id } = req.params;

  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !lead_id) {
    return res.status(400).send({
      message: "Tenant id or lead id missing",
    });
  }

  try {
    const lead = await getLeadByLeadIdService(tenant_id, lead_id);
    if (!lead) {
      return res.status(404).send({ message: "Lead not found" });
    }
    const contactDetails = await getContactByContactIdAndTenantIdService(
      lead.contact_id,
      tenant_id,
    );

    const { mode, date, start_date, end_date } = req.query;
    console.log(
      `Smart Summary Req - Lead: ${lead_id}, Mode: ${mode}, Date: ${date}, Range: ${start_date} to ${end_date}`,
    );

    const response = await getLeadSummaryService(
      tenant_id,
      contactDetails?.phone,
      lead_id,
      mode,
      date,
      start_date,
      end_date,
      lead.contact_id,
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

export const getBulkLeadSummaryController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { lead_ids, mode, date, start_date, end_date } = req.body;

  console.log("ssss", lead_ids);

  if (!tenant_id) {
    return res.status(400).send({ message: "Tenant id missing" });
  }

  if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
    return res
      .status(400)
      .send({ message: "Invalid or missing lead_ids array" });
  }

  try {
    console.log(
      `Bulk Smart Summary Req - Leads: ${lead_ids.length}, Mode: ${mode}`,
    );

    // Call service
    const results = await getBulkLeadSummaryService(
      tenant_id,
      lead_ids,
      mode,
      date,
      start_date,
      end_date,
    );

    return res.status(200).send({
      message: "success",
      data: results,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const updateLeadController = async (req, res) => {
  const { lead_id } = req.params;
  const {
    status,
    heat_state,
    lead_stage,
    assigned_to,
    priority,
    source,
    internal_notes,
  } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !lead_id) {
    return res.status(400).send({
      message: "Tenant id or lead id missing",
    });
  }

  try {
    await updateLeadStatusService(
      tenant_id,
      lead_id,
      status,
      heat_state,
      lead_stage,
      assigned_to,
      priority,
      source,
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
  const { lead_id } = req.params;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !lead_id) {
    return res.status(400).send({
      message: "Tenant id or lead id missing",
    });
  }

  try {
    await deleteLeadService(tenant_id, lead_id);
    return res.status(200).send({
      message: "Lead deleted successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const getDeletedLeadListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  try {
    const result = await getDeletedLeadListService(tenant_id);
    return res.status(200).send({
      message: "success",
      data: result,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const restoreLeadController = async (req, res) => {
  const { lead_id } = req.params;
  const tenant_id = req.user.tenant_id;
  try {
    const result = await restoreLeadService(lead_id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    if (err.message === "Lead not found or not deleted") {
      return res.status(404).send({ message: err.message });
    }
    return res.status(500).send({ message: err.message });
  }
};

export const permanentDeleteLeadController = async (req, res) => {
  const { lead_id } = req.params;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !lead_id) {
    return res.status(400).send({
      message: "Tenant id or lead id missing",
    });
  }

  try {
    await permanentDeleteLeadService(tenant_id, lead_id);
    return res.status(200).send({
      message: "Lead permanently deleted",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const bulkUpdateLeadsController = async (req, res) => {
  const { lead_ids, updates } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !lead_ids || !Array.isArray(lead_ids)) {
    return res.status(400).send({
      message: "Tenant id or lead ids missing",
    });
  }

  try {
    const result = await bulkUpdateLeadsService(tenant_id, lead_ids, updates);
    return res.status(200).send({
      message: "Leads updated successfully",
      data: result,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message || err,
    });
  }
};
