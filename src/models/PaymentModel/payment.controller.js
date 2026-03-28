import {
  createRazorpayOrderService,
  verifyRazorpayPaymentService,
  getPaymentHistoryService,
} from "./payment.service.js";

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
