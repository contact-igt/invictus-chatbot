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
import AiPropmtRouter from "./models/AiPrompt/aiprompt.routes.js";
import ConversationRouter from "./models/Conversation/conversation.routes.js";
import AppSettingRouter from "./models/AppSettings/appsetting.routes.js";
import ManagementRouter from "./models/Management/management.routes.js";
import TenantRouter from "./models/TenantModel/tenant.routes.js";
import WhatsappAccountRouter from "./models/WhatsappAccountModel/whatsappAccount.routes.js";
import ChatStateRouter from "./models/ChatStateModel/chatState.routes.js";
import { startChatStateHeatDecayCronService } from "./models/ChatStateModel/chatState.service.js";

dns.setDefaultResultOrder("ipv4first");

const app = express();

app.use(cors());
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

app.use(
  "/api/whatsapp",
  AuthWhatsappRouter,
  WhatsappMessageRouter,
  KnowledgeRouter,
  AiPropmtRouter,
  ConversationRouter,
  AppSettingRouter,
  ManagementRouter,
  TenantRouter,
  WhatsappAccountRouter,
  ChatStateRouter,
);

startChatStateHeatDecayCronService();

app.get("/", (req, res) => {
  res.json({ status: "OK" });
});

await db.sequelize.sync();
console.log("DB connected");

const PORT = process.env.PORT || 8000;
const server = http.createServer(app);

initSocket(server);

server.listen(PORT, () => {
  console.log("✅ Server + Socket running on", PORT);
});
