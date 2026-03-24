import { createRazorpayOrderService, verifyRazorpayPaymentService } from "./payment.service.js";

export const createRazorpayOrderController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
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
