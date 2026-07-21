import crypto from "crypto";
import db from "../database/index.js";
import { checkBillingAccess } from "./billingAccess.service.js";

export const createBillingHold = async ({
  tenantId,
  amount,
  campaignId = null,
  ttlSeconds = 86400,
  metadata = null,
}) => {
  const holdAmount = Number(amount);
  if (!Number.isFinite(holdAmount) || holdAmount < 0) {
    throw new TypeError(
      "Billing hold amount must be a finite non-negative number",
    );
  }

  if (holdAmount === 0) {
    const access = await checkBillingAccess(tenantId, 0);
    return { success: access.allowed, hold: null, access };
  }

  return db.sequelize.transaction(async (transaction) => {
    const access = await checkBillingAccess(tenantId, holdAmount, {
      transaction,
      lock: true,
    });
    if (!access.allowed) return { success: false, hold: null, access };

    const holdId = `bh_${crypto.randomUUID()}`;
    const hold = await db.BillingHolds.create(
      {
        hold_id: holdId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        billing_mode: access.billing_mode,
        amount: holdAmount,
        remaining_amount: holdAmount,
        status: "active",
        expires_at: new Date(Date.now() + ttlSeconds * 1000),
        metadata,
      },
      { transaction },
    );
    return { success: true, hold, access };
  });
};

export const releaseBillingHold = async (holdId, reason = "released") =>
  db.sequelize.transaction(async (transaction) => {
    const hold = await db.BillingHolds.findOne({
      where: { hold_id: holdId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!hold || hold.status !== "active") return false;
    await hold.update(
      {
        remaining_amount: 0,
        status: "released",
        released_at: new Date(),
        release_reason: reason,
      },
      { transaction },
    );
    return true;
  });

export const releaseRecipientBillingAllocation = async (
  recipientId,
  reason = "send_not_completed",
) => db.sequelize.transaction(async (transaction) => {
  const recipient = await db.WhatsappCampaignRecipients.findByPk(recipientId, {
    attributes: ["id", "billing_hold_id", "authorized_cost_inr"],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!recipient?.billing_hold_id) return false;

  const released = await consumeBillingHoldAllocation(
    recipient.billing_hold_id,
    recipient.authorized_cost_inr,
    transaction,
    reason,
  );
  if (released) {
    await recipient.update(
      { billing_hold_id: null, authorized_cost_inr: null },
      { transaction },
    );
  }
  return released;
});
/** Removes one recipient's estimated allocation after its actual usage is recorded. */
export const consumeBillingHoldAllocation = async (
  holdId,
  allocation,
  transaction,
  reason = "usage_recorded",
) => {
  if (!holdId || !db.BillingHolds) return false;
  const hold = await db.BillingHolds.findOne({
    where: { hold_id: holdId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!hold || hold.status !== "active") return false;

  const remaining = Number(hold.remaining_amount) || 0;
  const consumed = Math.min(remaining, Math.max(0, Number(allocation) || 0));
  const nextRemaining = Math.max(0, remaining - consumed);
  await hold.update(
    {
      remaining_amount: nextRemaining,
      status: nextRemaining <= 0.000001 ? "consumed" : "active",
      ...(nextRemaining <= 0.000001
        ? { released_at: new Date(), release_reason: reason }
        : {}),
    },
    { transaction },
  );
  return true;
};
