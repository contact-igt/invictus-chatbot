import db from "../database/index.js";

const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeCost = (estimatedCost) => {
  const value = Number(estimatedCost);
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("estimated_cost must be a finite non-negative number");
  }
  return value;
};

const response = ({
  allowed,
  billingMode,
  totalCost,
  available,
  walletBalance,
  blockedReason = null,
  heldAmount = 0,
  creditLimit = null,
  currentUsage = 0,
}) => ({
  allowed,
  blocked: !allowed,
  billing_mode: billingMode,
  total_cost_inr: totalCost,
  available_amount: Math.max(0, available),
  available: Math.max(0, available),
  balance: walletBalance,
  required: totalCost,
  limit: creditLimit,
  usage: currentUsage,
  wallet_balance: walletBalance,
  is_sufficient: allowed,
  shortfall: Math.max(0, totalCost - Math.max(0, available)),
  blocked_reason: blockedReason,
  reason: blockedReason,
  held_amount: heldAmount,
});

/** Canonical, database-authoritative access check for every billable flow. */
export const checkBillingAccess = async (
  tenantId,
  estimatedCost,
  { transaction = null, lock = false } = {},
) => {
  const totalCost = normalizeCost(estimatedCost);
  const queryOptions = {
    where: { tenant_id: tenantId },
    attributes: ["billing_mode", "postpaid_credit_limit"],
    transaction,
  };
  if (lock && transaction) queryOptions.lock = transaction.LOCK.UPDATE;

  const tenant = await db.Tenants.findOne(queryOptions);
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  const billingMode = tenant.billing_mode || "prepaid";
  const wallet = await db.Wallets.findOne({
    where: { tenant_id: tenantId },
    attributes: ["balance"],
    transaction,
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  const walletBalance = money(wallet?.balance);

  const heldAmount = money(
    await db.BillingHolds.sum("remaining_amount", {
      where: {
        tenant_id: tenantId,
        billing_mode: billingMode,
        status: "active",
      },
      transaction,
    }),
  );

  if (billingMode === "prepaid") {
    const available = walletBalance - heldAmount;
    const allowed = totalCost <= Math.max(0, available);
    return response({
      allowed,
      billingMode,
      totalCost,
      available,
      walletBalance,
      heldAmount,
      blockedReason: allowed
        ? null
        : `Insufficient balance. Required: ₹${totalCost.toFixed(2)}, Available: ₹${Math.max(0, available).toFixed(2)}`,
    });
  }

  const overdueInvoice = await db.MonthlyInvoices.findOne({
    where: {
      tenant_id: tenantId,
      [db.Sequelize.Op.or]: [
        { status: "overdue" },
        { status: "unpaid", due_date: { [db.Sequelize.Op.lt]: new Date() } },
      ],
    },
    attributes: ["invoice_number"],
    transaction,
    raw: true,
  });

  const configuredLimit = Number(tenant.postpaid_credit_limit);
  const creditLimit = Number.isFinite(configuredLimit) ? configuredLimit : 5000;
  const activeCycle = await db.BillingCycles.findOne({
    where: { tenant_id: tenantId, status: "active" },
    attributes: ["total_cost_inr"],
    transaction,
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
    raw: true,
  });
  const currentUsage = money(activeCycle?.total_cost_inr);
  const available = creditLimit - currentUsage - heldAmount;

  if (overdueInvoice) {
    return response({
      allowed: false,
      billingMode,
      totalCost,
      available,
      walletBalance,
      heldAmount,
      creditLimit,
      currentUsage,
      blockedReason: `Invoice ${overdueInvoice.invoice_number || ""} is overdue. Please pay it to continue.`.trim(),
    });
  }

  const allowed = totalCost <= Math.max(0, available);
  return response({
    allowed,
    billingMode,
    totalCost,
    available,
    walletBalance,
    heldAmount,
    creditLimit,
    currentUsage,
    blockedReason: allowed
      ? null
      : `Available postpaid credit is insufficient. Required: ₹${totalCost.toFixed(2)}, Available: ₹${Math.max(0, available).toFixed(2)}`,
  });
};