import db from "../../database/index.js";

export const MANAGE_APPOINTMENT_AUDIT_ACTIONS = {
  VIEWED: "VIEWED",
  UPDATED_NAME: "UPDATED_NAME",
  UPDATED_PHONE: "UPDATED_PHONE",
  UPDATED_EMAIL: "UPDATED_EMAIL",
  UPDATED_REASON: "UPDATED_REASON",
  RESCHEDULED: "RESCHEDULED",
  CANCELLED: "CANCELLED",
};

export const logManageAppointmentAudit = async ({
  appointmentId,
  tenantId,
  actionType,
  oldValue = null,
  newValue = null,
  changedBy,
  changedFrom = "WHATSAPP",
}) => {
  try {
    if (!db.AppointmentAuditLogs) return null;
    return await db.AppointmentAuditLogs.create({
      appointment_id: appointmentId,
      tenant_id: tenantId,
      action_type: actionType,
      old_value: oldValue,
      new_value: newValue,
      changed_by: changedBy,
      changed_from: changedFrom,
    });
  } catch (err) {
    console.error("[MANAGE-APPT-AUDIT] Failed to write audit log:", err.message);
    return null;
  }
};
