import { sendWhatsAppMessage } from "../AuthWhatsapp/AuthWhatsapp.service.js";
import {
  createUserMessageService,
  getChatByPhoneService,
  getChatListService,
  markSeenMessageService,
  suggestReplyService,
} from "./messages.service.js";

export const getChatList = async (req, res) => {
  try {
    const chatlist = await getChatListService();

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
  try {
    const messages = await getChatByPhoneService(phone);
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

  try {
    await sendWhatsAppMessage(phone, message);
    // await createUserMessageService(null, phone, "admin", message);

    await createUserMessageService(null, phone, null, "admin", null, message);

    return res.status(200).send({
      message: "Message sended successfully",
    });
  } catch (err) {
    throw err;
  }
};

export const markSeenMessage = async (req, res) => {
  const { phone } = req.query;

  try {
    await markSeenMessageService(phone);
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
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "phone is required",
      });
    }

    const reply = await suggestReplyService(phone);

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
