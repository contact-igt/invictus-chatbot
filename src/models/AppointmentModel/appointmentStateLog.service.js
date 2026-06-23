import db from "../../database/index.js";

export const logAppointmentStateTransition = async ({
  tenantId,
  userPhone,
  sessionId,
  fromState = null,
  toState = null,
  message = null,
  replyId = null,
  whatsappMessageId = null,
}) => {
  try {
    if (!db.AppointmentStateLogs) return null;
    
    return await db.AppointmentStateLogs.create({
      tenant_id: tenantId,
      user_phone: userPhone,
      session_id: sessionId,
      from_state: fromState,
      to_state: toState,
      message,
      reply_id: replyId,
      whatsapp_message_id: whatsappMessageId,
    });
  } catch (err) {
    console.error("[ADV-APPT-LOG] Failed to write state log:", err.message);
    return null;
  }
};

export const hasProcessedAppointmentMessage = async (tenantId, whatsappMessageId) => {
  if (!whatsappMessageId || !db.AppointmentStateLogs) return false;
  const row = await db.AppointmentStateLogs.findOne({
    where: {
      tenant_id: tenantId,
      whatsapp_message_id: whatsappMessageId,
    },
    attributes: ["id"],
  });
  return Boolean(row);
};
