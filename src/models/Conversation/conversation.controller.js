import {
  findConversationByPhoneService,
  processConversationService,
} from "./conversation.service.js";

export const processConversationController = async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).send({
        success: false,
        message: "phone and message required",
      });
    }

    const reply = await processConversationService(phone, message);

    return res.status(200).send({
      success: true,
      reply,
    });
  } catch (err) {
    return res.status(500).send({
      success: false,
      message: err.message,
    });
  }
};

// optional debug
export const findConversationByPhoneController = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).send({
        success: false,
        message: "phone is required",
      });
    }

    const conversation = await findConversationByPhoneService(phone);

    return res.status(200).send({
      success: true,
      data: conversation,
    });
  } catch (err) {
    return res.status(500).send({
      success: false,
      message: err.message,
    });
  }
};
