import {
  getResolvedTenantFeaturesService,
  upsertTenantFeatureOverridesService,
} from "./tenantFeatureAccess.service.js";

const handleError = (res, err) => {
  const statusCode = err?.statusCode || 500;
  return res.status(statusCode).json({ message: err.message });
};

export const getTenantFeaturesController = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const data = await getResolvedTenantFeaturesService(tenant_id);
    return res.status(200).json({
      message: "success",
      data,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

export const getManagementTenantFeaturesController = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const data = await getResolvedTenantFeaturesService(tenantId);
    return res.status(200).json({
      message: "success",
      data,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

export const patchManagementTenantFeaturesController = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const data = await upsertTenantFeatureOverridesService(tenantId, req.body);
    return res.status(200).json({
      message: "Tenant feature overrides updated successfully",
      data,
    });
  } catch (err) {
    return handleError(res, err);
  }
};
