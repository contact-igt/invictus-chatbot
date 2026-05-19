import {
  getTenantDynamicAccessService,
  getTenantDynamicNavigationService,
} from "./moduleAccess.service.js";

const handleError = (res, err) => {
  const statusCode = err?.statusCode || 500;
  return res.status(statusCode).json({ message: err.message });
};

export const getTenantDynamicAccessController = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const data = await getTenantDynamicAccessService(tenant_id);
    return res.status(200).json({
      message: "success",
      data,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

export const getTenantDynamicNavigationController = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const data = await getTenantDynamicNavigationService(tenant_id);
    return res.status(200).json({
      message: "success",
      data,
    });
  } catch (err) {
    return handleError(res, err);
  }
};
