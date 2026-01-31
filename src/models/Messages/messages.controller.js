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
import { tableNames } from "../../database/tableName.js";
import db from "../../database/index.js";

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
      null, // wamid - we don't get it immediately from sendWhatsAppTemplate unless we return it
      "System",
      "admin",
      null,
      `Template: ${template.template_name}`,
      "template",
    );

    await updateAdminLeadService(tenant_id, contact_id);

    return res.status(200).send({
      message: "Template sent successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};
