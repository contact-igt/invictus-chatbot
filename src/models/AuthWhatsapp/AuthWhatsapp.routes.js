import express from "express";
import {
    receiveMessage,
    verifyWebhook,
} from "./AuthWhatsapp.controller.js";

const Router = express.Router();

Router.get("/webhook/:tenantId?", verifyWebhook);
Router.post("/webhook/:tenantId?", receiveMessage);


export default Router;
