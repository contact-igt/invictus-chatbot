import {
  listIndustriesService,
  createIndustryService,
  patchIndustryService,
  deleteIndustryService,
  listSaaSModulesService,
  createSaaSModuleService,
  patchSaaSModuleService,
  deleteSaaSModuleService,
  listPlansService,
  createPlanService,
  patchPlanService,
  deletePlanService,
  getIndustrySaaSModulesService,
  patchIndustrySaaSModulesService,
  getPlanSaaSModulesService,
  patchPlanSaaSModulesService,
  getManagementTenantDynamicAccessService,
  patchManagementTenantDynamicAccessService,
} from "./moduleAccess.management.service.js";

const handleError = (res, err) => {
  const statusCode = err?.statusCode || 500;
  return res.status(statusCode).json({ message: err.message });
};

export const listIndustriesController = async (req, res) => {
  try {
    const data = await listIndustriesService();
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const createIndustryController = async (req, res) => {
  try {
    const data = await createIndustryService(req.body);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const patchIndustryController = async (req, res) => {
  try {
    const { industryId } = req.params;
    const data = await patchIndustryService(industryId, req.body);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const deleteIndustryController = async (req, res) => {
  try {
    const { industryId } = req.params;
    const data = await deleteIndustryService(industryId);
    return res.status(200).json({ message: "Industry deleted successfully", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const listSaaSModulesController = async (req, res) => {
  try {
    const data = await listSaaSModulesService();
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const createSaaSModuleController = async (req, res) => {
  try {
    const data = await createSaaSModuleService(req.body);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const patchSaaSModuleController = async (req, res) => {
  try {
    const { moduleId } = req.params;
    const data = await patchSaaSModuleService(moduleId, req.body);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const deleteSaaSModuleController = async (req, res) => {
  try {
    const { moduleId } = req.params;
    const data = await deleteSaaSModuleService(moduleId);
    return res.status(200).json({ message: "SaaS module deleted successfully", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const listPlansController = async (req, res) => {
  try {
    const data = await listPlansService();
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const createPlanController = async (req, res) => {
  try {
    const data = await createPlanService(req.body);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const patchPlanController = async (req, res) => {
  try {
    const { planId } = req.params;
    const data = await patchPlanService(planId, req.body);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const deletePlanController = async (req, res) => {
  try {
    const { planId } = req.params;
    const data = await deletePlanService(planId);
    return res.status(200).json({ message: "Plan deleted successfully", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const getIndustrySaaSModulesController = async (req, res) => {
  try {
    const { industryId } = req.params;
    const data = await getIndustrySaaSModulesService(industryId);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const patchIndustrySaaSModulesController = async (req, res) => {
  try {
    const { industryId } = req.params;
    const data = await patchIndustrySaaSModulesService(
      industryId,
      req.body?.mappings,
    );
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const getPlanSaaSModulesController = async (req, res) => {
  try {
    const { planId } = req.params;
    const data = await getPlanSaaSModulesService(planId);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const patchPlanSaaSModulesController = async (req, res) => {
  try {
    const { planId } = req.params;
    const data = await patchPlanSaaSModulesService(planId, req.body?.mappings);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const getManagementTenantDynamicAccessController = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const data = await getManagementTenantDynamicAccessService(tenantId);
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};

export const patchManagementTenantDynamicAccessController = async (
  req,
  res,
) => {
  try {
    const { tenantId } = req.params;
    const data = await patchManagementTenantDynamicAccessService(
      tenantId,
      req.body,
    );
    return res.status(200).json({ message: "success", data });
  } catch (err) {
    return handleError(res, err);
  }
};
