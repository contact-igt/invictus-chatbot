import { Op } from "sequelize";
import db from "../database/index.js";
import { sendWhatsAppTemplate } from "../models/AuthWhatsapp/AuthWhatsapp.service.js";
import {
  buildFollowUpTemplateComponentsService,
  persistFollowUpSentMessageService,
} from "../models/AppointmentModel/appointment.service.js";

const stringifyMetaError = (err) => {
  if (err?.meta_error_response) {
    try {
      return JSON.stringify(err.meta_error_response);
    } catch {
      return String(err?.message || "Unknown error");
    }
  }
  return String(err?.message || "Unknown error");
};

const APPOINTMENT_REMINDER_ACTIVE_STATUSES = new Set([
  "Pending",
  "Confirmed",
  "Rescheduled",
]);

export const runScheduledMessageCron = async () => {
  const now = new Date();

  const pending = await db.ScheduledMessages.findAll({
    where: {
      status: "pending",
      scheduled_at: { [Op.lte]: now },
    },
    limit: 50,
  });

  if (!pending.length) return;

  for (const msg of pending) {
    try {
      if (msg.send_type === "appointment_reminder") {
        const appointment = await db.Appointments.findOne({
          where: {
            tenant_id: msg.tenant_id,
            appointment_id: msg.appointment_id,
          },
          attributes: ["appointment_id", "status", "is_deleted"],
          raw: true,
        });

        const shouldSkipReminder =
          !appointment ||
          appointment.is_deleted === true ||
          !APPOINTMENT_REMINDER_ACTIVE_STATUSES.has(appointment.status);

        if (shouldSkipReminder) {
          await msg.update({
            status: "failed",
            error_log: appointment
              ? `Skipped appointment_reminder: appointment status=${appointment.status}, is_deleted=${appointment.is_deleted}`
              : "Skipped appointment_reminder: appointment not found",
          });
          continue;
        }
      }

      if (msg.meta_message_id) {
        const existingByWamid = await db.Messages.findOne({
          where: { wamid: msg.meta_message_id },
          attributes: ["id"],
          raw: true,
        });
        if (existingByWamid?.id) {
          await msg.update({
            status: "sent",
            sent_at: msg.sent_at || new Date(),
            error_log: null,
          });
          continue;
        }
      }

      const template = await db.WhatsappTemplates.findOne({
        where: { template_id: msg.template_id, tenant_id: msg.tenant_id },
        attributes: ["template_name", "language"],
      });

      if (!template) {
        await msg.update({
          status: "failed",
          error_log: `Template not found: ${msg.template_id}`,
          sent_at: new Date(),
        });
        continue;
      }

      // Strip leading + so Meta API receives E.164 without the plus sign
      const toPhone = msg.to_phone.replace(/^\+/, "");

      const components = await buildFollowUpTemplateComponentsService({
        tenant_id: msg.tenant_id,
        template_id: msg.template_id,
        appointment_id: msg.appointment_id,
        header_media_url: msg.header_media_url || null,
        header_file_name: msg.header_file_name || null,
      });
      
      await persistFollowUpSentMessageService({
        tenant_id: msg.tenant_id,
        scheduledMessage: msg,
        template,
        components,
        meta_message_id: sendResult?.meta_message_id || null,
        phone_number_id: sendResult?.phone_number_id || null,
      });
    } catch (err) {
      await msg.update({
        status: "failed",
        error_log: stringifyMetaError(err),
        // sent_at intentionally NOT set — only written on successful delivery
      });
      console.error(
        `[FOLLOWUP-CRON] Send failed for scheduled_message=${msg.id}:`,
        stringifyMetaError(err),
      );
    }
  }
};
