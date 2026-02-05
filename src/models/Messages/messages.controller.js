import {
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
} from "../AuthWhatsapp/AuthWhatsapp.service.js";
import { updateAdminLeadService } from "../LeadsModel/leads.service.js";
import {
  createUserMessageService,
  getChatByPhoneService,
  getChatListService,
  markSeenMessageService,
  suggestReplyService,
} from "./messages.service.js";
import {
  createLiveChatService,
  getLivechatByIdService,
  updateLiveChatTimestampService,
} from "../LiveChatModel/livechat.service.js";
import { tableNames } from "../../database/tableName.js";
import db from "../../database/index.js";
import { getIO } from "../../middlewares/socket/socket.js";

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
  const { phone_number_id, contact_id, phone, name, message } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !contact_id) {
    return res
      .status(400)
      .send({ message: "Invalid tenant id or contact id context" });
  }

  try {
    const activeChat = await getLivechatByIdService(tenant_id, contact_id);

    if (!activeChat) {
      return res.status(403).send({
        message: "24-hour window expired. Please send a template message to initiate chat.",
      });
    }

    await createUserMessageService(
      tenant_id,
      contact_id,
      phone_number_id,
      phone,
      null,
      name,
      "admin",
      null,
      message,
    );

    await sendWhatsAppMessage(tenant_id, phone, message);

    await updateAdminLeadService(tenant_id, contact_id);

    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("new-message", {
      tenant_id,
      phone,
      contact_id,
      name,
      message,
      sender: "admin",
      created_at: new Date(),
    });

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

export const sendTemplateMessageController = async (req, res) => {
  const { phone, contact_id, template_id, components } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!tenant_id || !phone || !template_id) {
    return res.status(400).send({ message: "Missing required fields" });
  }

  try {
    // 1. Fetch template
    const [[template]] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE template_id = ? AND tenant_id = ?`,
      { replacements: [template_id, tenant_id] },
    );

    const [[headerComponent]] = await db.sequelize.query(
      `SELECT text_content FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id = ? AND component_type = 'header' LIMIT 1`,
      { replacements: [template_id] },
    );

    const [[bodyComponent]] = await db.sequelize.query(
      `SELECT text_content FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id = ? AND component_type = 'body' LIMIT 1`,
      { replacements: [template_id] },
    );

    const [[contact]] = await db.sequelize.query(
      `SELECT name FROM contacts WHERE contact_id = ?`,
      { replacements: [contact_id] },
    );

    let messageContent = "";

    // 1. Handle Header
    if (headerComponent && headerComponent.text_content) {
      let headerText = headerComponent.text_content;
      const headerParams = components?.find((c) => c.type === "header")?.parameters || [];
      headerParams.forEach((param, index) => {
        if (param.type === "text") {
          headerText = headerText.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, "g"), param.text);
        }
      });
      messageContent += headerText + "\n";
    }

    // 2. Handle Body
    if (bodyComponent && bodyComponent.text_content) {
      let bodyText = bodyComponent.text_content;
      const bodyParams = components?.find((c) => c.type === "body")?.parameters || [];
      bodyParams.forEach((param, index) => {
        if (param.type === "text") {
          bodyText = bodyText.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, "g"), param.text);
        }
      });
      messageContent += bodyText;
    }

    if (!messageContent) {
      messageContent = `Template: ${template?.template_name}`;
    }

    if (!template) {
      return res.status(404).send({ message: "Template not found" });
    }

    // 2. Send via Meta
    const metaResponse = await sendWhatsAppTemplate(
      tenant_id,
      phone,
      template.template_name,
      template.language,
      components,
    );

    // 3. Log to Messages
    await createUserMessageService(
      tenant_id,
      contact_id,
      metaResponse.phone_number_id,
      phone,
      metaResponse.meta_message_id,
      "System",
      "admin",
      null,
      messageContent,
      "template",
      null,
      null,
      "sent"
    );

    await updateAdminLeadService(tenant_id, contact_id);

    // 4. Activate Live Chat
    const livelist = await getLivechatByIdService(tenant_id, contact_id);

    if (!livelist) {
      await createLiveChatService(tenant_id, contact_id);
    } else {
      await updateLiveChatTimestampService(tenant_id, contact_id);
    }

    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("new-message", {
      tenant_id,
      phone,
      contact_id,
      name: contact?.name || phone,
      message: messageContent,
      sender: "admin",
      message_type: "template",
      created_at: new Date(),
    });

    io.to(`tenant-${tenant_id}`).emit("session-activated", {
      tenant_id,
      contact_id,
      phone,
    });

    return res.status(200).send({
      message: "Template sent successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};
