import express from "express";
import {
  getBillingKpiController,
  getBillingLedgerController,
  getBillingSpendChartController
} from "./billing.controller.js";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";

const router = express.Router();

router.get("/billing/kpi", authenticate, getBillingKpiController);
router.get("/billing/ledger", authenticate, getBillingLedgerController);
router.get("/billing/spend-chart", authenticate, getBillingSpendChartController);

export default router;
