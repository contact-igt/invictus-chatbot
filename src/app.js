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
import LiveChatRouter from "./models/LiveChatModel/livechat.routes.js"
import TenantInvitationRouter from "./models/TenantInvitationModel/tenantinvitation.routes.js";
import TenantUserRouter from "./models/TenantUserModel/tenantuser.routes.js";
import WhatsappTemplateRouter from "./models/WhatsappTemplateModel/whatsapptemplate.routes.js"
import WhatsappCampaignRouter from "./models/WhatsappCampaignModel/whatsappcampaign.routes.js"
import ContactGroupRouter from "./models/ContactGroupModel/contactGroup.routes.js"
import { startCampaignSchedulerService } from "./models/WhatsappCampaignModel/whatsappcampaign.service.js";
import { startLeadHeatDecayCronService } from "./models/LeadsModel/leads.service.js";
import { startLiveChatCleanupService } from "./models/LiveChatModel/livechat.service.js";
import AiAnalysisLogRouter from "./models/AiAnalysisLog/aiAnalysisLog.routes.js";
import DoctorRouter from "./models/DoctorModel/doctor.routes.js";
import SpecializationRouter from "./models/SpecializationModel/specialization.routes.js";
import AppointmentRouter from "./models/AppointmentModel/appointment.routes.js";
import DashboardRouter from "./models/DashboardModel/dashboard.routes.js";
import { startAppointmentSchedulerService } from "./models/AppointmentModel/appointment.service.js";
import PlaygroundRouter from "./models/Playground/playground.routes.js";
import BillingRouter from "./models/BillingModel/billing.routes.js";
import WhatsappOtpRouter from "./models/OtpVerificationModel/otpverification.routes.js";
import PaymentRouter from "./models/PaymentModel/payment.routes.js";
import SuperAdminDashboardRouter from "./models/SuperAdminDashboardModel/superAdminDashboard.routes.js";


dns.setDefaultResultOrder("ipv4first");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-meta-token", "ngrok-skip-browser-warning"],
  credentials: false,
}));

// Handle preflight requests explicitly
app.options("*", cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  fileUpload({
    limits: { fileSize: 20 * 1024 * 1024 },
    abortOnLimit: true,
  }),
);

app.use((req, res, next) => {
  console.log("➡️ Incoming:", req.method, req.url);
  next();
});

app.use("/api/management", SuperAdminDashboardRouter, ManagementRouter);

app.use(
  "/api/tenant",
  TenantRouter,
  TenantUserRouter,
  TenantInvitationRouter
);

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
  WhatsappTemplateRouter,
  WhatsappCampaignRouter,
  ContactGroupRouter,
  AiAnalysisLogRouter,
  DoctorRouter,
  SpecializationRouter,
  AppointmentRouter,
  PlaygroundRouter,
  DashboardRouter,
  BillingRouter,
  WhatsappOtpRouter,
  PaymentRouter,
);


app.get("/", (req, res) => {
  res.json({ status: "OK" });
});


await db.sequelize.sync();
console.log("DB connected");

startLeadHeatDecayCronService();
startLiveChatCleanupService();
startCampaignSchedulerService();
startAppointmentSchedulerService();


const PORT = process.env.PORT || 8000;
const server = http.createServer(app);

initSocket(server);

server.listen(PORT, () => {
  console.log("✅ Server + Socket running on", PORT);
});
