import { isValidFeatureKey } from "../../config/featureAccess.config.js";
import { getResolvedTenantFeaturesService } from "../../models/TenantFeatureAccessModel/tenantFeatureAccess.service.js";

export const checkFeatureAccess = (featureKey) => {
  return async (req, res, next) => {
    try {
      if (!isValidFeatureKey(featureKey)) {
        return res.status(500).json({
          message: `Feature access misconfiguration: invalid feature key "${featureKey}"`,
        });
      }

      const tenantId = req.user?.tenant_id;
      const industryTypeFromAuth = req.user?.industry_type || null;
      void industryTypeFromAuth;

      if (!tenantId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const resolved = await getResolvedTenantFeaturesService(tenantId);
      const isEnabled = resolved.enabled_features.includes(featureKey);

      if (!isEnabled) {
        return res.status(403).json({
          message: `Feature "${featureKey}" is disabled for this tenant`,
        });
      }

      return next();
    } catch (err) {
      const statusCode = err?.statusCode || 500;
      return res.status(statusCode).json({
        message: err?.message || "Failed to evaluate feature access",
      });
    }
  };
};
