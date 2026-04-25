import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import http from "http";
import dns from "dns";
import db from "./database/index.js";
import { initSocket } from "./middlewares/socket/socket.js";
import AuthWhatsappRouter from "./models/AuthWhatsapp/AuthWhatsapp.routes.js";
import WhatsappMessageRouter from "./models/Messages/messages.routes.js";
import KnowledgeRouter from "./models/Knowledge/knowledge.routes.js";
import AiPromptRouter from "./models/AiPrompt/aiprompt.routes.js";
import ManagementRouter from "./models/ManagementModel/management.routes.js";
import TenantRouter from "./models/TenantModel/tenant.routes.js";
import WhatsappAccountRouter from "./models/WhatsappAccountModel/whatsappAccount.routes.js";
import ContactRouter from "./models/ContactsModel/contacts.routes.js";
import LeadRouter from "./models/LeadsModel/leads.routes.js";
import LiveChatRouter from "./models/LiveChatModel/livechat.routes.js";
import TenantInvitationRouter from "./models/TenantInvitationModel/tenantinvitation.routes.js";
import TenantUserRouter from "./models/TenantUserModel/tenantuser.routes.js";
import WhatsappTemplateRouter from "./models/WhatsappTemplateModel/whatsapptemplate.routes.js";
import WhatsappCampaignRouter from "./models/WhatsappCampaignModel/whatsappcampaign.routes.js";
import GalleryRouter from "./models/GalleryModel/gallery.routes.js";
import ContactGroupRouter from "./models/ContactGroupModel/contactGroup.routes.js";
import AppointmentRouter from "./models/AppointmentModel/appointment.routes.js";
import { startCampaignSchedulerService } from "./models/WhatsappCampaignModel/whatsappcampaign.service.js";
import { startLeadHeatDecayCronService } from "./models/LeadsModel/leads.service.js";
import { startLiveChatCleanupService } from "./models/LiveChatModel/livechat.service.js";
import DoctorRouter from "./models/DoctorModel/doctor.routes.js";
import SpecializationRouter from "./models/SpecializationModel/specialization.routes.js";
import DashboardRouter from "./models/DashboardModel/dashboard.routes.js";
import PlaygroundRouter from "./models/Playground/playground.routes.js";
import BillingRouter from "./models/BillingModel/billing.routes.js";
import WhatsappOtpRouter from "./models/OtpVerificationModel/otpverification.routes.js";
import PaymentRouter from "./models/PaymentModel/payment.routes.js";
import SuperAdminDashboardRouter from "./models/SuperAdminDashboardModel/superAdminDashboard.routes.js";
import {
  runBillingCycleCron,
  runAutoRechargeCron,
  runInvoiceRetryCron,
} from "./models/BillingModel/billingCycle.service.js";
import FaqRouter from "./models/Faq/faq.routes.js";
import { checkHealthAlerts } from "./utils/billing/billingHealthMonitor.js";
import { runDailyReconciliation } from "./utils/billing/paymentReconciler.js";
import { initBillingQueue } from "./utils/billing/billingQueue.js";
import { validateRazorpayConfig } from "./models/PaymentModel/payment.service.js";
import { logger } from "./utils/logger.js";
import cron from "node-cron";
import { tableNames } from "./database/tableName.js";
import { runHardDeleteCron } from "./utils/lifecycle/hardDeleteCron.js";
import { runMissingMessageBillingReconciliationCron } from "./cron/reconciliationCron.js";
import { cleanupExpiredSessions } from "./models/AppointmentModel/appointmentConversation.service.js"; // NEW

dns.setDefaultResultOrder("ipv4first");

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-meta-token",
      "ngrok-skip-browser-warning",
    ],
    credentials: false,
  }),
);

// Handle preflight requests explicitly
app.options("*", cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

app.use(
  fileUpload({
    limits: { fileSize: 20 * 1024 * 1024 },
    abortOnLimit: true,
  }),
);

app.use((req, res, next) => {
  logger.debug("Incoming:", req.method, req.url);
  next();
});

app.use("/api/management", SuperAdminDashboardRouter, ManagementRouter);

app.use("/api/tenant", TenantRouter, TenantUserRouter, TenantInvitationRouter);

app.use(
  "/api/whatsapp",
  AuthWhatsappRouter,
  WhatsappMessageRouter,
  KnowledgeRouter,
  AiPromptRouter,
  WhatsappAccountRouter,
  ContactRouter,
  LeadRouter,
  LiveChatRouter,
  AppointmentRouter,
  WhatsappTemplateRouter,
  WhatsappCampaignRouter,
  GalleryRouter,
  ContactGroupRouter,
  DoctorRouter,
  SpecializationRouter,
  PlaygroundRouter,
  DashboardRouter,
  BillingRouter,
  WhatsappOtpRouter,
  PaymentRouter,
  FaqRouter,
);

app.use(
  "/api/v1",
  WhatsappTemplateRouter,
  WhatsappCampaignRouter,
  GalleryRouter,
);

app.get("/", (req, res) => {
  res.json({ status: "OK" });
});

await db.sequelize.sync({ alter: true });
logger.info("DB connected");

// Validate Razorpay configuration at startup (fail-fast if misconfigured)
try {
  validateRazorpayConfig();
  logger.info("[PAYMENT] Razorpay configuration validated successfully");
} catch (err) {
  logger.warn(
    `[PAYMENT] ${err.message} — payment features will be unavailable until fixed`,
  );
}

startLeadHeatDecayCronService();
startLiveChatCleanupService();
startCampaignSchedulerService();

// Billing system crons
cron.schedule("5 0 * * *", () => {
  logger.debug("[CRON] Running billing cycle cron...");
  runBillingCycleCron();
}); // Daily at 00:05 UTC

cron.schedule("*/5 * * * *", () => {
  runAutoRechargeCron();
}); // Every 5 minutes — check low-balance wallets with auto-recharge enabled

cron.schedule("0 * * * *", () => {
  runInvoiceRetryCron();
}); // Every hour — retry overdue invoice payment reminders

cron.schedule("*/15 * * * *", () => { // NEW
  cleanupExpiredSessions(); // NEW
}); // NEW — every 15 min: mark booking_sessions where expires_at < NOW() as 'expired'

cron.schedule("*/15 * * * *", () => {
  checkHealthAlerts();
}); // Every 15 minutes

cron.schedule("0 2 * * *", () => {
  logger.debug("[CRON] Running daily reconciliation...");
  runDailyReconciliation();
}); // Daily at 02:00 UTC

cron.schedule("*/10 * * * *", () => {
  logger.debug("[CRON] Running missing-message billing reconciliation...");
  void runMissingMessageBillingReconciliationCron().catch((error) => {
    logger.error(
      `[CRON] Unhandled missing-message reconciliation failure: ${error.message}`,
    );
  });
}); // Every 10 minutes — detect outbound messages missing billing artifacts

// Master lifecycle hard-delete cron — runs at 04:00 UTC daily
// Processes ALL Tier 1 tables (campaigns, templates, knowledge, contacts, doctors, etc.)
cron.schedule("0 4 * * *", async () => {
  await runHardDeleteCron();
}); // Daily at 04:00 UTC

// FAQ: purge hard-deleted knowledge chunks older than 30 days
cron.schedule("0 3 * * *", async () => {
  try {
    const [, meta] = await db.sequelize.query(
      `DELETE FROM ${tableNames.KNOWLEDGECHUNKS}
       WHERE is_deleted = true
         AND deleted_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    );
    const removed = meta?.affectedRows ?? 0;
    if (removed > 0) {
      logger.info(`[CRON] Purged ${removed} soft-deleted knowledge chunk(s)`);
    }
  } catch (err) {
    logger.error("[CRON] knowledge-chunk cleanup error:", err.message);
  }
}); // Daily at 03:00 UTC

// Initialize billing queue (optional — requires Redis)
initBillingQueue();

const PORT = process.env.PORT || 8000;
const server = http.createServer(app);

initSocket(server);

server.listen(PORT, () => {
  logger.info("Server + Socket running on", PORT);
});
