// backend/src/services/savedPayment.service.js

import db from "../database/index.js";
import Razorpay from "razorpay";
import { verifyRazorpayPaymentService } from "../models/PaymentModel/payment.service.js";
import { recordHealthEvent } from "../utils/billing/billingHealthMonitor.js";

const { SavedPaymentMethod, Tenants: Tenant } = db;

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export async function createRazorpayCustomer(tenantId, email, name, contact) {
  const customer = await razorpay.customers.create({ name, email, contact });
  await Tenant.update(
    { razorpay_customer_id: customer.id },
    { where: { id: tenantId } },
  );
  return customer.id;
}

export async function savePaymentMethod(
  tenantId,
  { razorpay_payment_id, razorpay_order_id },
) {
  const payment = await razorpay.payments.fetch(razorpay_payment_id);
  if (!payment.token)
    throw {
      code: "NO_TOKEN",
      message: "No recurring token found",
      statusCode: 400,
    };
  const token = await razorpay.tokens.fetch(payment.token);
  const method_type = token.method;
  let method_display = "";
  if (method_type === "card") {
    method_display = `${token.card.network} **** ${token.card.last4}`;
  } else if (method_type === "upi") {
    method_display = token.upi && token.upi.vpa ? token.upi.vpa : "UPI";
  } else {
    method_display = method_type;
  }
  await SavedPaymentMethod.upsert({
    tenant_id: tenantId,
    razorpay_customer_id: payment.customer_id,
    razorpay_token_id: token.id,
    method_type,
    method_display,
    is_active: true,
    last_used_at: null,
    failure_count: 0,
  });
}

export async function chargeWithSavedMethod(tenantId, amountInr, description) {
  const method = await SavedPaymentMethod.findOne({
    where: { tenant_id: tenantId, is_active: true },
  });
  if (!method)
    throw {
      code: "NO_SAVED_METHOD",
      message: "No active saved payment method",
      statusCode: 400,
    };
  const tenant = await Tenant.findOne({ where: { id: tenantId } });
  const gross = Number(amountInr);
  try {
    const payment = await razorpay.payments.createRecurringPayment({
      email: tenant.email,
      contact: tenant.contact,
      amount: Math.round(gross * 100),
      currency: "INR",
      token: method.razorpay_token_id,
      recurring: 1,
      description,
      notify: { sms: true, email: true },
    });
    await verifyRazorpayPaymentService({
      payment_id: payment.id,
      order_id: null,
      tenantId,
    });
    await method.update({ last_used_at: new Date(), failure_count: 0 });
    return { success: true };
  } catch (error) {
    await method.increment("failure_count");
    if (method.failure_count >= 3) {
      await method.update({ is_active: false });
      // emit socket 'saved-method-failed'
    }
    await recordHealthEvent("payment_failure", tenantId, error);
    return { success: false, reason: error.message };
  }
}

export async function removeSavedMethod(tenantId) {
  await SavedPaymentMethod.update(
    { is_active: false },
    { where: { tenant_id: tenantId } },
  );
}

export async function getSavedMethod(tenantId) {
  const method = await SavedPaymentMethod.findOne({
    where: { tenant_id: tenantId },
  });
  if (!method) return null;
  return {
    method_type: method.method_type,
    method_display: method.method_display,
    is_active: method.is_active,
    last_used_at: method.last_used_at,
  };
}
