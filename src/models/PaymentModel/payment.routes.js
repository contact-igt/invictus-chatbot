import express from "express";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";
import {
  createRazorpayOrderController,
  verifyRazorpayPaymentController
} from "./payment.controller.js";

const router = express.Router();

router.post("/payment/order", authenticate, createRazorpayOrderController);
router.post("/payment/verify", authenticate, verifyRazorpayPaymentController);

export default router;
