import {
  getInvoicesService,
  getInvoiceDetailService,
} from "./billingCycle.service.js";
import { getBillingModeService } from "./billing.service.js";
import {
  payInvoiceService,
  recordInvoicePaymentFailure,
} from "../PaymentModel/payment.service.js";
import {
  forceUnlockAccess,
  manualWalletCredit,
  manualInvoiceClose,
  changeBillingMode,
  getAuditLogService,
} from "./adminBilling.service.js";
import {
  getHealthSummary,
  resolveHealthEvent,
  getUnresolvedEvents,
} from "../../utils/billing/billingHealthMonitor.js";
import db from "../../database/index.js";

// ─── Invoice Controllers ──────────────────────────────────

export const getInvoicesController = async (req, res) => {
  try {
    // Super admins (management users) can view all invoices or filter by tenant_id query param
    const isManagement = req.user.user_type === "management";
    const tenant_id = isManagement
      ? req.query.tenant_id || null
      : req.user.tenant_id;

    if (!isManagement && !tenant_id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const result = await getInvoicesService(
      tenant_id,
      status || null,
      parseInt(page),
      parseInt(limit),
    );
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[INVOICE] getInvoices error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getInvoiceDetailController = async (req, res) => {
  try {
    const isManagement = req.user.user_type === "management";
    const tenant_id = isManagement
      ? req.query.tenant_id || null
      : req.user.tenant_id;

    if (!isManagement && !tenant_id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const result = await getInvoiceDetailService(tenant_id, parseInt(id));
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[INVOICE] getInvoiceDetail error:", error.message);
    res.status(error.message === "Invoice not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

export const payInvoiceController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    if (!tenant_id) {
      return res.status(403).json({
        success: false,
        message: "Only tenant users can pay invoices",
      });
    }
    const { id } = req.params;
    const result = await payInvoiceService(tenant_id, parseInt(id), req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[INVOICE] payInvoice error:", error.message);

    // Record failure for retry tracking
    if (req.params.id && req.user?.tenant_id) {
      try {
        await recordInvoicePaymentFailure(
          req.user.tenant_id,
          parseInt(req.params.id),
        );
      } catch (_) {}
    }

    const status = error.message === "Invalid payment signature" ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const getBillingModeController = async (req, res) => {
  try {
    const isManagement = req.user.user_type === "management";
    const tenant_id = isManagement
      ? req.query.tenant_id || null
      : req.user.tenant_id;

    if (!tenant_id) {
      return res
        .status(400)
        .json({ success: false, message: "tenant_id is required" });
    }

    const result = await getBillingModeService(tenant_id);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[BILLING] getBillingMode error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Admin Controllers ──────────────────────────────────

export const adminForceUnlockController = async (req, res) => {
  try {
    const admin_id = req.user.unique_id;
    const { tenant_id, reason } = req.body;
    if (!tenant_id || !reason) {
      return res
        .status(400)
        .json({ success: false, message: "tenant_id and reason are required" });
    }
    const result = await forceUnlockAccess(admin_id, tenant_id, reason);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[ADMIN-BILLING] forceUnlock error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const adminManualCreditController = async (req, res) => {
  try {
    const admin_id = req.user.unique_id;
    const { tenant_id, amount, reason } = req.body;
    if (!tenant_id || !amount || !reason) {
      return res.status(400).json({
        success: false,
        message: "tenant_id, amount, and reason are required",
      });
    }
    const result = await manualWalletCredit(
      admin_id,
      tenant_id,
      parseFloat(amount),
      reason,
    );
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[ADMIN-BILLING] manualCredit error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const adminInvoiceCloseController = async (req, res) => {
  try {
    const admin_id = req.user.unique_id;
    const { invoice_id, reason } = req.body;
    if (!invoice_id || !reason) {
      return res.status(400).json({
        success: false,
        message: "invoice_id and reason are required",
      });
    }
    const result = await manualInvoiceClose(
      admin_id,
      parseInt(invoice_id),
      reason,
    );
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[ADMIN-BILLING] invoiceClose error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const adminChangeBillingModeController = async (req, res) => {
  try {
    const admin_id = req.user.unique_id;
    const { tenant_id, new_mode, reason } = req.body;
    if (!tenant_id || !new_mode || !reason) {
      return res.status(400).json({
        success: false,
        message: "tenant_id, new_mode, and reason are required",
      });
    }
    const result = await changeBillingMode(
      admin_id,
      tenant_id,
      new_mode,
      reason,
    );
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[ADMIN-BILLING] changeBillingMode error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const adminGetAuditLogController = async (req, res) => {
  try {
    const { tenant_id, page = 1, limit = 50 } = req.query;
    const result = await getAuditLogService(
      tenant_id || null,
      parseInt(page),
      parseInt(limit),
    );
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[ADMIN-BILLING] getAuditLog error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const adminGetHealthSummaryController = async (req, res) => {
  try {
    const result = await getHealthSummary();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[ADMIN-BILLING] getHealthSummary error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Admin: Get Tenant List for Dropdown ──────────────────

export const adminGetTenantsController = async (req, res) => {
  try {
    const { search } = req.query;
    const where = { is_deleted: false };

    if (search) {
      const { Op } = db.Sequelize;
      where[Op.or] = [
        { tenant_id: { [Op.like]: `%${search}%` } },
        { company_name: { [Op.like]: `%${search}%` } },
        { owner_name: { [Op.like]: `%${search}%` } },
      ];
    }

    const tenants = await db.Tenants.findAll({
      where,
      attributes: [
        "tenant_id",
        "company_name",
        "owner_name",
        "billing_mode",
        "status",
        "postpaid_credit_limit",
      ],
      order: [["company_name", "ASC"]],
      limit: 50,
      raw: true,
    });

    // Attach wallet balance for each tenant
    const tenantIds = tenants.map((t) => t.tenant_id);
    const wallets = await db.Wallets.findAll({
      where: { tenant_id: tenantIds },
      attributes: ["tenant_id", "balance"],
      raw: true,
    });
    const walletMap = {};
    for (const w of wallets) {
      walletMap[w.tenant_id] = parseFloat(w.balance) || 0;
    }

    const result = tenants.map((t) => ({
      tenant_id: t.tenant_id,
      company_name: t.company_name,
      owner_name: t.owner_name,
      billing_mode: t.billing_mode,
      status: t.status,
      wallet_balance: walletMap[t.tenant_id] || 0,
      credit_limit: parseFloat(t.postpaid_credit_limit) || 5000,
    }));

    res.json({ success: true, tenants: result });
  } catch (error) {
    console.error("[ADMIN-BILLING] getTenants error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Admin: Resolve Health Event ──────────────────────────

export const adminResolveHealthEventController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Event ID is required" });
    }
    await resolveHealthEvent(parseInt(id));
    res.json({ success: true, message: "Event resolved" });
  } catch (error) {
    console.error("[ADMIN-BILLING] resolveHealthEvent error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Admin: Get Tenant Billing Overview ───────────────────

export const adminGetTenantOverviewController = async (req, res) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res
        .status(400)
        .json({ success: false, message: "tenant_id is required" });
    }

    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: [
        "tenant_id",
        "company_name",
        "billing_mode",
        "status",
        "postpaid_credit_limit",
        "billing_cycle_start",
        "billing_cycle_end",
      ],
      raw: true,
    });

    if (!tenant) {
      return res
        .status(404)
        .json({ success: false, message: "Tenant not found" });
    }

    const wallet = await db.Wallets.findOne({
      where: { tenant_id },
      attributes: ["balance"],
      raw: true,
    });

    const activeCycle = await db.BillingCycles.findOne({
      where: { tenant_id, status: "active" },
      attributes: [
        "id",
        "cycle_number",
        "start_date",
        "end_date",
        "total_cost_inr",
        "is_locked",
      ],
      raw: true,
    });

    const overdueCount = await db.MonthlyInvoices.count({
      where: { tenant_id, status: "overdue" },
    });

    res.json({
      success: true,
      overview: {
        tenant_id: tenant.tenant_id,
        company_name: tenant.company_name,
        billing_mode: tenant.billing_mode,
        status: tenant.status,
        wallet_balance: parseFloat(wallet?.balance) || 0,
        credit_limit: parseFloat(tenant.postpaid_credit_limit) || 5000,
        active_cycle: activeCycle
          ? {
              cycle_number: activeCycle.cycle_number,
              cycle_start: activeCycle.start_date,
              cycle_end: activeCycle.end_date,
              current_usage: parseFloat(activeCycle.total_cost_inr) || 0,
              is_locked: activeCycle.is_locked,
            }
          : null,
        overdue_invoices: overdueCount,
      },
    });
  } catch (error) {
    console.error("[ADMIN-BILLING] getTenantOverview error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Admin: Get Unresolved Health Events ──────────────────

export const adminGetUnresolvedEventsController = async (req, res) => {
  try {
    const events = await getUnresolvedEvents(parseInt(req.query.limit) || 50);
    res.json({ success: true, events });
  } catch (error) {
    console.error("[ADMIN-BILLING] getUnresolvedEvents error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
