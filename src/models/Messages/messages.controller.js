import { sendWhatsAppMessage } from "../AuthWhatsapp/AuthWhatsapp.service.js";
import {
  createUserMessageService,
  getChatByPhoneService,
  getChatListService,
  markSeenMessageService,
  suggestReplyService,
} from "./messages.service.js";

export const getChatList = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const chatlist = await getChatListService(tenant_id);

    return res.status(200).send({
      message: "success",
      data: chatlist,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const getChatByPhone = async (req, res) => {
  const { phone } = req.params;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const messages = await getChatByPhoneService(phone, tenant_id);
    return res.status(200).send({
      messages: "Number successfully listed",
      data: messages,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const sendAdminMessage = async (req, res) => {
  const { phone, name, message } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    await sendWhatsAppMessage(tenant_id, phone, message);

    await createUserMessageService(
      tenant_id,
      phone_number_id,
      phone,
      null,
      name,
      "admin",
      null,
      message,
    );

    return res.status(200).send({
      message: "Message sended successfully",
    });
  } catch (err) {
    throw err;
  }
};

export const markSeenMessage = async (req, res) => {
  const { phone } = req.query;

  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    await markSeenMessageService(tenant_id, phone);
    return res.status(200).send({
      message: "message updated seen",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const suggestReplyController = async (req, res) => {
  const { phone } = req.body;

  const tenant_id = req.user.tenant_id;

  if (!phone) {
    return res.status(400).json({
      success: false,
      message: "phone is required",
    });
  }

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const reply = await suggestReplyService(tenant_id, phone);

    return res.status(200).json({
      success: true,
      data: reply,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
