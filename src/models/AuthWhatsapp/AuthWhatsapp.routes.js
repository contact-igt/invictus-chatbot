import express from "express";
import { receiveMessage, verifyWebhook } from "./AuthWhatsapp.controller.js";

const Router = express.Router();

Router.get("/webhook", verifyWebhook);
Router.post("/webhook", receiveMessage);


export default Router;
