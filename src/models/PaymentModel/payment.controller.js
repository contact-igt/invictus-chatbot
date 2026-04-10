import {
  createRazorpayOrderService,
  verifyRazorpayPaymentService,
  getPaymentHistoryService,
  handleRazorpayWebhookService,
} from "./payment.service.js";
import { logger } from "../../utils/logger.js";

export const createRazorpayOrderController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid amount" });
    }

    // Minimum and maximum amount validation
    if (amount < 100) {
      return res
        .status(400)
        .json({ success: false, message: "Minimum recharge amount is ₹100" });
    }
    if (amount > 500000) {
      return res.status(400).json({
        success: false,
        message: "Maximum recharge amount is ₹5,00,000",
      });
    }

    const order = await createRazorpayOrderService(tenant_id, amount);

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to create payment order",
      error: error.message,
    });
  }
};

export const verifyRazorpayPaymentController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const paymentData = req.body;

    const result = await verifyRazorpayPaymentService(tenant_id, paymentData);

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Payment verification failed",
      error: error.message,
    });
  }
};

export const getPaymentHistoryController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { page = 1, limit = 50 } = req.query;

    const result = await getPaymentHistoryService(tenant_id, page, limit);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment history",
      error: error.message,
    });
  }
};

/**
 * Razorpay webhook handler — NO auth middleware.
 * Signature verification is done inside handleRazorpayWebhookService using
 * the raw request body.
 *
 * IMPORTANT: This route must receive the raw body (Buffer), not JSON-parsed.
 * The route is registered BEFORE express.json() is applied to it.
 */
export const razorpayWebhookController = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    if (!signature) {
      return res.status(400).json({ success: false, message: "Missing signature header" });
    }

    // rawBody is populated by the express.raw() middleware applied only on this route
    const rawBody = req.rawBody;
    if (!rawBody) {
      return res.status(400).json({ success: false, message: "Empty webhook body" });
    }

    const result = await handleRazorpayWebhookService(rawBody, signature);
    logger.debug("[PAYMENT-WEBHOOK] Processed:", result);

    // Always return 200 to Razorpay to prevent retries on business-logic outcomes
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    // Invalid signature → 400, so Razorpay knows not to retry
    if (error.message === "Invalid webhook signature") {
      logger.warn("[PAYMENT-WEBHOOK] Invalid signature attempt");
      return res.status(400).json({ success: false, message: error.message });
    }
    logger.error("[PAYMENT-WEBHOOK] Error:", error.message);
    // Return 500 so Razorpay retries
    return res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
};
