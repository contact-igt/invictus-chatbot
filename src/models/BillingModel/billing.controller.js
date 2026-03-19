import {
  getBillingKpiService,
  getBillingLedgerService,
  getBillingSpendChartService,
} from "./billing.service.js";

export const getBillingKpiController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { startDate, endDate } = req.query;

    const kpiData = await getBillingKpiService(tenant_id, startDate, endDate);

    return res.status(200).json({
      success: true,
      data: kpiData,
      message: "Billing KPIs fetched successfully"
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

    const ledgerData = await getBillingLedgerService(tenant_id, page, limit, category, startDate, endDate);

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
    
    const spendChartData = await getBillingSpendChartService(tenant_id, startDate, endDate);

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
