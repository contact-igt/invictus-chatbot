import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";

import db from "./database/index.js";
import AuthWhatsappRouter from "./models/AuthWhatsapp/AuthWhatsapp.routes.js";
import WhatsappMessageRouter from "./models/Messages/messages.routes.js";
import KnowledgeRouter from "./models/Knowledge/knowledge.routes.js";

import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  fileUpload({
    limits: { fileSize: 20 * 1024 * 1024 },
    abortOnLimit: true,
  })
);

app.use((req, res, next) => {
  console.log("➡️ Incoming:", req.method, req.url);
  next();
});

app.use(
  "/api/whatsapp",
  AuthWhatsappRouter,
  WhatsappMessageRouter,
  KnowledgeRouter
);

app.get("/", (req, res) => {
  res.json({ status: "OK" });
});

await db.sequelize.sync();
console.log("DB connected");

app.listen(8000, "0.0.0.0", () => {
  console.log("🚀 Server running on 8000");
});
