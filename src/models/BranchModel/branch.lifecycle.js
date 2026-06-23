import {
  getDeletedBranchListService,
  permanentDeleteBranchService,
  restoreBranchService,
  softDeleteBranchService,
} from "./branch.service.js";

const respondFromError = (res, err) => {
  const status = err?.statusCode || 500;
  return res.status(status).send({ message: err?.message || "Internal server error" });
};

export const getDeletedBranchesController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    const rows = await getDeletedBranchListService(tenant_id);
    return res.status(200).send({
      message: "success",
      data: rows,
    });
  } catch (err) {
    return respondFromError(res, err);
  }
};

export const softDeleteBranchController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { branch_id } = req.params;

  try {
    const result = await softDeleteBranchService(branch_id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    return respondFromError(res, err);
  }
};

export const restoreBranchController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { branch_id } = req.params;

  try {
    const result = await restoreBranchService(branch_id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    return respondFromError(res, err);
  }
};

export const permanentDeleteBranchController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { branch_id } = req.params;

  try {
    const result = await permanentDeleteBranchService(branch_id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    return respondFromError(res, err);
  }
};
