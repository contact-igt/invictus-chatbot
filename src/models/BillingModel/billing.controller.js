import {
  getBillingKpiService,
  getBillingLedgerService,
  getBillingSpendChartService,
  getWalletBalanceService,
  getWalletTransactionsService,
  getPricingTableService,
  updatePricingService,
  getBillingTemplateStatsService,
  getBillingCampaignStatsService,
  getAiTokenUsageService,
  getAutoRechargeSettingsService,
  updateAutoRechargeSettingsService,
  getAvailableAiModelsService,
} from "./billing.service.js";

export const getBillingKpiController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { startDate, endDate } = req.query;

    const kpiData = await getBillingKpiService(tenant_id, startDate, endDate);

    return res.status(200).json({
      success: true,
      data: kpiData,
      message: "Billing KPIs fetched successfully",
    });
  } catch (error) {
    console.error("Error in getBillingKpiController:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch billing KPIs",
      error: error.message,
    });
  }
};

export const getBillingLedgerController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { page = 1, limit = 50, category, startDate, endDate } = req.query;

    const ledgerData = await getBillingLedgerService(
      tenant_id,
      page,
      limit,
      category,
      startDate,
      endDate,
    );

    return res.status(200).json({
      success: true,
      data: ledgerData,
    });
  } catch (error) {
    console.error("Error in getBillingLedgerController:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch billing ledger",
      error: error.message,
    });
  }
};

export const getBillingSpendChartController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { startDate, endDate } = req.query;

    const spendChartData = await getBillingSpendChartService(
      tenant_id,
      startDate,
      endDate,
    );

    return res.status(200).json({
      success: true,
      data: spendChartData,
    });
  } catch (error) {
    console.error("Error in getBillingSpendChartController:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch spend chart data",
      error: error.message,
    });
  }
};

export const getWalletBalanceController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const balanceData = await getWalletBalanceService(tenant_id);

    return res.status(200).json({
      success: true,
      data: balanceData,
    });
  } catch (error) {
    console.error("Error in getWalletBalanceController:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wallet balance",
      error: error.message,
    });
  }
};

export const getWalletTransactionsController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { page, limit, startDate, endDate } = req.query;
    const data = await getWalletTransactionsService(
      tenant_id,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 10,
      startDate,
      endDate,
    );
    return res.status(200).json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Error in getWalletTransactionsController:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wallet transactions",
      error: error.message,
    });
  }
};

export const getPricingTableController = async (req, res) => {
  try {
    const pricingData = await getPricingTableService();
    return res.status(200).json({
      success: true,
      data: pricingData,
    });
  } catch (error) {
    console.error("Error in getPricingTableController:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pricing table",
      error: error.message,
    });
  }
};

export const updatePricingController = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const updatedPricing = await updatePricingService(id, updateData);
    return res.status(200).json({
      success: true,
      data: updatedPricing,
      message: "Pricing updated successfully",
    });
  } catch (error) {
    console.error("Error in updatePricingController:", error);
    return res.status(400).json({
      success: false,
      message: "Failed to update pricing",
      error: error.message,
    });
  }
};

export const getBillingTemplateStatsController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { startDate, endDate } = req.query;
    const stats = await getBillingTemplateStatsService(
      tenant_id,
      startDate,
      endDate,
    );
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getBillingCampaignStatsController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { startDate, endDate } = req.query;
    const stats = await getBillingCampaignStatsService(
      tenant_id,
      startDate,
      endDate,
    );
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAiTokenUsageController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { startDate, endDate } = req.query;
    const data = await getAiTokenUsageService(tenant_id, startDate, endDate);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error in getAiTokenUsageController:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch AI token usage",
      error: error.message,
    });
  }
};

export const getAutoRechargeSettingsController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const data = await getAutoRechargeSettingsService(tenant_id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error in getAutoRechargeSettingsController:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch auto-recharge settings",
      error: error.message,
    });
  }
};

export const updateAutoRechargeSettingsController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const data = await updateAutoRechargeSettingsService(tenant_id, req.body);
    return res.status(200).json({
      success: true,
      data,
      message: "Auto-recharge settings updated successfully",
    });
  } catch (error) {
    console.error("Error in updateAutoRechargeSettingsController:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update auto-recharge settings",
    });
  }
};

export const getAvailableAiModelsController = async (req, res) => {
  try {
    const data = await getAvailableAiModelsService();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error in getAvailableAiModelsController:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
