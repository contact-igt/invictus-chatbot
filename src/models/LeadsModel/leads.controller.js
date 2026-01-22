import { getLeadListService, getLeadSummaryService } from "./leads.service.js";

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
  const { phone } = req.query;
  const { id } = req.params;

  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !phone) {
    return res.status(400).send({
      message: "Tenant id or phone number missing",
    });
  }

  try {
    const response = await getLeadSummaryService(tenant_id, phone , id);

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
