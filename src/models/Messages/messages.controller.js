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
  createContactService,
  getContactByPhoneAndTenantIdService,
} from "../ContactsModel/contacts.service.js";
import {
  createLiveChatService,
  getLivechatByIdService,
  updateLiveChatTimestampService,
} from "../LiveChatModel/livechat.service.js";
import { renderTemplateContent } from "../../utils/whatsapp/templateRenderer.js";
import { tableNames } from "../../database/tableName.js";
import db from "../../database/index.js";
import { getIO } from "../../middlewares/socket/socket.js";
import { formatPhoneNumber } from "../../utils/helpers/formatPhoneNumber.js";

export const getChatList = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({
      message: "Tenant id missing",
    });
  }

  try {
    const response = await getChatListService(tenant_id);

    return res.status(200).send({
      message: "success",
      data: response,
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
    const formattedPhone = formatPhoneNumber(phone);
    const messages = await getChatByPhoneService(formattedPhone, tenant_id);
    return res.status(200).send({
      message: "success",
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
        message:
          "24-hour window expired. Please send a template message to initiate chat.",
      });
    }

    const formattedPhone = formatPhoneNumber(phone);
    const msgResponse = await sendWhatsAppMessage(
      tenant_id,
      formattedPhone,
      message,
    );

    const savedMsg = await createUserMessageService(
      tenant_id,
      contact_id,
      msgResponse.phone_number_id,
      formattedPhone,
      msgResponse.wamid,
      name,
      "admin",
      req.user.username || "Admin",
      message,
      "text",
      null,
      null,
      "sent",
    );

    await updateAdminLeadService(tenant_id, contact_id);
    await updateLiveChatTimestampService(tenant_id, contact_id);

    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("new-message", {
      tenant_id,
      phone: formattedPhone,
      id: savedMsg?.id,
      contact_id,
      phone_number_id: msgResponse.phone_number_id,
      name,
      message,
      message_type: "text",
      media_url: null,
      status: "sent",
      sender: "admin",
      sender_id: req.user.username || "Admin",
      created_at: new Date(),
    });

    return res.status(200).send({
      message: "Message sent successfully",
    });
  } catch (err) {
    const isMetaError = err.message?.startsWith("Meta API Error:");
    return res.status(isMetaError ? 400 : 500).send({
      message: err.message || "Failed to send message",
    });
  }
};

export const markSeenMessage = async (req, res) => {
  const { phone } = req.query;

  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const formattedPhone = formatPhoneNumber(phone);
    await markSeenMessageService(tenant_id, formattedPhone);
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
  const { getTenantSettingsService } =
    await import("../TenantModel/tenant.service.js");
  const tenantSettings = await getTenantSettingsService(tenant_id);

  if (tenantSettings?.ai_settings?.smart_reply === false) {
    return res.status(403).json({
      success: false,
      message:
        "Smart Reply is disabled for your organization. Please enable it in Settings.",
    });
  }

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
    const formattedPhone = formatPhoneNumber(phone);
    const reply = await suggestReplyService(tenant_id, formattedPhone);

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

    // Check template approval status
    if (template.status !== "APPROVED" && template.status !== "approved") {
      return res.status(400).send({
        message: `Template is not approved (current status: ${template.status}). Only approved templates can be sent.`,
      });
    }

    // 2. Render content for DB
    const messageContent = await renderTemplateContent(template_id, components);

    // Extract media_url and type from header component if present in request
    const headerComp = components?.find((c) => c.type === "header");
    let templateMediaUrl = null;
    let templateMediaType = "template";
    if (headerComp?.parameters?.[0]) {
      const p = headerComp.parameters[0];
      if (p.type === "location" && p.location) {
        // Location header — no media URL, just mark as location type
        templateMediaType = "location";
      } else if (p.image?.link) {
        templateMediaUrl = p.image.link;
        templateMediaType = "image";
      } else if (p.video?.link) {
        templateMediaUrl = p.video.link;
        templateMediaType = "video";
      } else if (p.document?.link) {
        templateMediaUrl = p.document.link;
        templateMediaType = "document";
      }
    }

    // If no media provided in request, fetch from template definition
    if (!templateMediaUrl && templateMediaType === "template") {
      const [headerComponents] = await db.sequelize.query(
        `SELECT header_format, media_url FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} 
         WHERE template_id = ? AND component_type = 'header'`,
        { replacements: [template_id] },
      );
      const templateHeader = headerComponents?.[0];
      if (templateHeader?.header_format?.toLowerCase() === "location") {
        templateMediaType = "location";
      } else if (templateHeader?.media_url) {
        templateMediaUrl = templateHeader.media_url;
        const headerFormat = templateHeader.header_format?.toLowerCase();
        if (headerFormat === "image") templateMediaType = "image";
        else if (headerFormat === "video") templateMediaType = "video";
        else if (headerFormat === "document") templateMediaType = "document";
      }
    }

    const formattedPhone = formatPhoneNumber(phone);
    // 2. Send via Meta
    const metaResponse = await sendWhatsAppTemplate(
      tenant_id,
      formattedPhone,
      template.template_name,
      template.language,
      components,
    );

    // Extract document filename from header component if present
    let templateMediaFilename = null;
    if (
      templateMediaType === "document" &&
      headerComp?.parameters?.[0]?.document?.filename
    ) {
      templateMediaFilename = headerComp.parameters[0].document.filename;
    }

    // Derive MIME type from filename for document templates
    let templateMediaMimeType = null;
    if (templateMediaType === "document" && templateMediaFilename) {
      const ext = templateMediaFilename.split(".").pop()?.toLowerCase();
      const mimeMap = {
        pdf: "application/pdf",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
      templateMediaMimeType = mimeMap[ext] || "application/octet-stream";
    }

    // 3. Log to Messages
    const savedMsg = await createUserMessageService(
      tenant_id,
      contact_id,
      metaResponse.phone_number_id,
      formattedPhone,
      metaResponse.meta_message_id,
      "System",
      "admin",
      null,
      messageContent,
      templateMediaType,
      templateMediaUrl,
      templateMediaMimeType,
      "sent",
      template.template_name,
      templateMediaFilename,
    );

    await updateAdminLeadService(tenant_id, contact_id);

    // 4. Activate Live Chat
    const livelist = await getLivechatByIdService(tenant_id, contact_id);

    if (!livelist) {
      await createLiveChatService(tenant_id, contact_id);
    } else {
      await updateLiveChatTimestampService(tenant_id, contact_id);
    }

    // Fetch contact name for socket emit
    let templateContactName = formattedPhone;
    try {
      const templateContact = await db.Contacts.findOne({
        where: { contact_id, tenant_id },
        attributes: ["name"],
        raw: true,
      });
      if (templateContact?.name) templateContactName = templateContact.name;
    } catch (dbErr) {
      console.error(
        "[DB] Failed to fetch contact name for template emit:",
        dbErr.message,
      );
    }

    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("new-message", {
      tenant_id,
      phone: formattedPhone,
      id: savedMsg?.id,
      contact_id,
      name: templateContactName,
      message: messageContent,
      sender: "admin",
      message_type: templateMediaType,
      media_url: templateMediaUrl,
      media_filename: templateMediaFilename,
      status: "sent",
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
    const isMetaError = err?.message?.startsWith("Meta API Error:");
    return res.status(isMetaError ? 400 : 500).send({
      message: err?.message || "Failed to send template message",
    });
  }
};

// ─── Send Test Message ───
export const sendTestMessageController = async (req, res) => {
  const { phone, message_type, message, template_id, components } = req.body;
  console.log("req.body", JSON.stringify(req.body, null, 2));
  const tenant_id = req.user.tenant_id;
  console.log("components", JSON.stringify(components, null, 2));
  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  if (!phone) {
    return res.status(400).send({ message: "Phone number is required" });
  }

  if (!message_type || !["text", "template"].includes(message_type)) {
    return res.status(400).send({
      message: "message_type is required and must be 'text' or 'template'",
    });
  }

  try {
    const formattedPhone = formatPhoneNumber(phone);
    console.log("[TEST-MSG] Starting test message flow:", {
      tenant_id,
      phone,
      formattedPhone,
      message_type,
    });

    // ── Text Message ──
    if (message_type === "text") {
      if (!message || !message.trim()) {
        return res.status(400).send({ message: "Message text is required" });
      }

      const msgResponse = await sendWhatsAppMessage(
        tenant_id,
        formattedPhone,
        message,
      );
      console.log("[TEST-MSG] WhatsApp response:", msgResponse);

      // Contact & Chat management
      let contact = await getContactByPhoneAndTenantIdService(
        tenant_id,
        formattedPhone,
      );
      console.log("[TEST-MSG] Contact lookup (before create):", contact);

      if (!contact) {
        await createContactService(
          tenant_id,
          formattedPhone,
          formattedPhone,
          null,
        );
        contact = await getContactByPhoneAndTenantIdService(
          tenant_id,
          formattedPhone,
        );
        console.log("[TEST-MSG] Contact lookup (after create):", contact);
      }

      const livelist = await getLivechatByIdService(
        tenant_id,
        contact?.contact_id,
      );
      if (!livelist)
        await createLiveChatService(tenant_id, contact?.contact_id);
      else await updateLiveChatTimestampService(tenant_id, contact?.contact_id);

      const savedMsg = await createUserMessageService(
        tenant_id,
        contact?.contact_id,
        msgResponse?.phone_number_id,
        formattedPhone,
        msgResponse?.wamid,
        contact?.name || formattedPhone,
        "admin",
        null,
        message,
        "text",
        null,
        null,
        "sent",
      );
      console.log("[TEST-MSG] Saved message result:", savedMsg);

      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("new-message", {
        tenant_id,
        phone: formattedPhone,
        id: savedMsg?.id,
        contact_id: contact?.contact_id,
        name: contact?.name || formattedPhone,
        message,
        message_type: "text",
        media_url: null,
        status: "sent",
        sender: "admin",
        created_at: new Date(),
      });

      return res.status(200).send({
        message: "Test text message sent successfully",
      });
    }

    // ── Template Message ──
    if (message_type === "template") {
      if (!template_id) {
        return res
          .status(400)
          .send({ message: "template_id is required for template messages" });
      }

      const [[template]] = await db.sequelize.query(
        `SELECT template_id, template_name, language, status FROM ${tableNames.WHATSAPP_TEMPLATE}
         WHERE (template_id = ? OR template_name = ?) AND tenant_id = ? AND is_deleted = false
         LIMIT 1`,
        { replacements: [template_id, template_id, tenant_id] },
      );

      // Handle special case for Meta's built-in `hello_world` template
      const isHelloWorld =
        template_id === "hello_world" ||
        template?.template_name === "hello_world";
      const helloWorldContent =
        "Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta. Thank you for taking the time to test with us.";

      if (!template && !isHelloWorld) {
        return res.status(404).send({ message: "Template not found" });
      }

      // Skip approval check for hello_world (Meta's built-in template)
      if (template && template.status !== "approved" && !isHelloWorld) {
        return res.status(400).send({
          message: `Template is not approved (current status: ${template.status}). Only approved templates can be sent.`,
        });
      }

      const templateName = template?.template_name || "hello_world";
      const templateLanguage = template?.language || "en_US";

      const metaResponse = await sendWhatsAppTemplate(
        tenant_id,
        formattedPhone,
        templateName,
        templateLanguage,
        components || [],
      );

      // 2. Contact & Chat management
      let contact = await getContactByPhoneAndTenantIdService(
        tenant_id,
        formattedPhone,
      );
      if (!contact) {
        await createContactService(
          tenant_id,
          formattedPhone,
          formattedPhone,
          null,
        );
        contact = await getContactByPhoneAndTenantIdService(
          tenant_id,
          formattedPhone,
        );
      }

      const livelist = await getLivechatByIdService(
        tenant_id,
        contact?.contact_id,
      );
      if (!livelist)
        await createLiveChatService(tenant_id, contact?.contact_id);
      else await updateLiveChatTimestampService(tenant_id, contact?.contact_id);

      // 1. Render message content - use actual template_id from DB, fallback for hello_world
      const actualTemplateId = template?.template_id || template_id;
      let messageContent = await renderTemplateContent(
        actualTemplateId,
        components || [],
      );

      // If no content rendered and it's hello_world, use default message
      if (!messageContent && isHelloWorld) {
        messageContent = helloWorldContent;
      }

      const savedMsg = await createUserMessageService(
        tenant_id,
        contact?.contact_id,
        metaResponse.phone_number_id,
        formattedPhone,
        metaResponse.meta_message_id,
        contact?.name || formattedPhone,
        "admin",
        null,
        messageContent,
        "template",
        null,
        null,
        "sent",
        templateName,
      );

      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("new-message", {
        tenant_id,
        phone: formattedPhone,
        id: savedMsg?.id,
        contact_id: contact?.contact_id,
        name: contact?.name || formattedPhone,
        message: messageContent,
        sender: "admin",
        message_type: "template",
        media_url: null,
        status: "sent",
        created_at: new Date(),
      });

      return res.status(200).send({
        message: "Test template message sent successfully",
        data: {
          meta_message_id: metaResponse.meta_message_id,
        },
      });
    }
  } catch (err) {
    const isMetaError = err.message?.startsWith("Meta API Error:");
    const metaErrorMsg = isMetaError
      ? err.message
      : `Failed to send test message: ${err.message}`;
    console.log(metaErrorMsg);
    return res.status(isMetaError ? 400 : 500).send({ message: metaErrorMsg });
  }
};
