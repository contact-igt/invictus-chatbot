import { Op } from "sequelize";
import db from "../database/index.js";
import { sendWhatsAppTemplate } from "../models/AuthWhatsapp/AuthWhatsapp.service.js";

// Build Meta API body components from appointment data for templates that have variables.
// Convention: {{1}} = patient name, {{2}} = appointment date, {{3}} = doctor name.
async function buildFollowUpComponents(templateId, appointmentId) {
  const varCount = await db.WhatsappTemplateVariables.count({
    where: { template_id: templateId },
  });
  if (!varCount) return [];

  const appointment = await db.Appointments.findOne({
    where: { appointment_id: appointmentId },
    attributes: ["patient_name", "appointment_date", "doctor_id"],
  });
  if (!appointment) return [];

  let doctorName = "";
  if (appointment.doctor_id) {
    const doctor = await db.Doctors.findOne({
      where: { doctor_id: appointment.doctor_id },
      attributes: ["name"],
    });
    doctorName = doctor?.name || "";
  }

  const allValues = [
    appointment.patient_name || "",
    appointment.appointment_date || "",
    doctorName,
  ];

  const parameters = allValues
    .slice(0, varCount)
    .map((v) => ({ type: "text", text: String(v) }));

  return [{ type: "body", parameters }];
}

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

      // Build body components from appointment data if the template has variables
      const components = await buildFollowUpComponents(msg.template_id, msg.appointment_id);

      await sendWhatsAppTemplate(
        msg.tenant_id,
        toPhone,
        template.template_name,
        template.language,
        components,
      );

      await msg.update({ status: "sent", sent_at: new Date() });
    } catch (err) {
      await msg.update({
        status: "failed",
        error_log: err.message,
        sent_at: new Date(),
      });
    }
  }
};
