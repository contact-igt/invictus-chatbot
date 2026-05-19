import * as AppointmentService from "./appointment.service.js";

const VALID_STATUSES = [
  "Pending",
  "Confirmed",
  "Rescheduled",
  "Completed",
  "Cancelled",
  "Expired",
  "Noshow",
];

const parseBooleanQueryFlag = (value) =>
  value === true || value === "true" || value === "1";


export const createAppointment = async (req, res) => {
  try {
    const {
      patient_name,
      age,
      country_code,
      contact_number,
      appointment_date,
      appointment_time,
    } = req.body;

    // Validate required fields
    if (!patient_name || !appointment_date || !appointment_time) {
      return res.status(400).json({
        success: false,
        message:
          "patient_name, appointment_date, and appointment_time are required.",
      });
    }

    if ((!contact_number || !country_code) && !req.body.contact_id) {
      return res.status(400).json({
        success: false,
        message:
          "Either (country_code + contact_number) or contact_id is required.",
      });
    }

    const data = { ...req.body, tenant_id: req.user.tenant_id };
    const appointment = await AppointmentService.createAppointmentService(data);
    return res.status(201).json({
      success: true,
      data: appointment,
      message: "Appointment created successfully.",
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const getAllAppointments = async (req, res) => {
  try {
    const { search, status, date, doctor_id, lead_id, include_lead } = req.query;
    const appointments = await AppointmentService.getAllAppointmentsService(
      req.user.tenant_id,
      {
        search,
        status,
        date,
        doctor_id,
        lead_id,
        includeLead: parseBooleanQueryFlag(include_lead),
      },
    );
    return res.status(200).json({ success: true, data: appointments });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getContactAppointments = async (req, res) => {
  try {
    const { contact_id } = req.params;
    const { include_lead } = req.query;
    const appointments =
      await AppointmentService.getAppointmentsByContactIdService(
        req.user.tenant_id,
        contact_id,
        { includeLead: parseBooleanQueryFlag(include_lead) },
      );
    return res.status(200).json({ success: true, data: appointments });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { appointment_id } = req.params;
    const { status } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    await AppointmentService.updateAppointmentStatusService(
      req.user.tenant_id,
      appointment_id,
      status,
      { allowTerminalStatuses: false },
    );
    return res.status(200).json({
      success: true,
      message: `Appointment status updated to ${status}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const checkAvailability = async (req, res) => {
  try {
    const { doctor_id, date, time } = req.query;

    if (!doctor_id || !date || !time) {
      return res.status(400).json({
        success: false,
        message: "doctor_id, date, and time query parameters are required.",
      });
    }

    const available = await AppointmentService.checkAvailabilityService(
      req.user.tenant_id,
      doctor_id,
      date,
      time,
    );
    return res.status(200).json({ success: true, available });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateAppointment = async (req, res) => {
  try {
    const { appointment_id } = req.params;
    const updated = await AppointmentService.updateAppointmentService(
      req.user.tenant_id,
      appointment_id,
      req.body,
    );
    return res.status(200).json({
      success: true,
      data: updated,
      message: "Appointment updated successfully.",
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteAppointment = async (req, res) => {
  try {
    const { appointment_id } = req.params;
    await AppointmentService.deleteAppointmentService(
      req.user.tenant_id,
      appointment_id,
    );
    return res.status(200).json({
      success: true,
      message: "Appointment deleted successfully.",
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const getAvailableSlots = async (req, res) => {
  try {
    const { doctor_id, date } = req.query;

    if (!doctor_id || !date) {
      return res.status(400).json({
        success: false,
        message: "doctor_id and date query parameters are required.",
      });
    }

    const result = await AppointmentService.getAvailableSlotsService(
      req.user.tenant_id,
      doctor_id,
      date,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const completeWithOutcome = async (req, res) => {
  try {
    const {
      appointment_id,
      notes,
      follow_up_required,
      follow_up_date,
      follow_up_time,
      follow_up_type,
      follow_up_reason,
      template_id,
    } = req.body;

    if (!appointment_id) {
      return res.status(400).json({
        success: false,
        message: "appointment_id is required.",
      });
    }

    if (!notes || !String(notes).trim()) {
      return res.status(400).json({
        success: false,
        message: "Visit outcome notes are required.",
      });
    }

    const result = await AppointmentService.completeAppointmentWithOutcomeService(
      {
        tenant_id: req.user.tenant_id,
        appointment_id,
        notes,
        follow_up_required,
        follow_up_date,
        follow_up_time,
        follow_up_type,
        follow_up_reason,
        template_id,
      },
    );

    return res.status(200).json({
      success: true,
      data: result,
      message: "Appointment completed successfully with outcome.",
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const noShowWithAction = async (req, res) => {
  try {
    const { appointment_id, mode, follow_up_date, follow_up_time, follow_up_type, template_id } = req.body;

    if (!appointment_id) {
      return res.status(400).json({
        success: false,
        message: "appointment_id is required.",
      });
    }

    const result = await AppointmentService.markNoShowWithActionService({
      tenant_id: req.user.tenant_id,
      appointment_id,
      mode,
      follow_up_date,
      follow_up_time,
      follow_up_type,
      template_id,
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: "Appointment marked as no-show.",
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const createAppointmentOutcome = async (req, res) => {
  try {
    const {
      appointment_id,
      notes,
      follow_up_required,
      follow_up_date,
      follow_up_type,
    } = req.body;

    if (!appointment_id) {
      return res.status(400).json({
        success: false,
        message: "appointment_id is required.",
      });
    }

    if (!notes || !String(notes).trim()) {
      return res.status(400).json({
        success: false,
        message: "Visit outcome notes are required.",
      });
    }

    const outcome = await AppointmentService.createAppointmentOutcomeService({
      tenant_id: req.user.tenant_id,
      appointment_id,
      notes,
      follow_up_required,
      follow_up_date,
      follow_up_type,
    });

    return res.status(201).json({
      success: true,
      data: outcome,
      message: "Appointment outcome saved successfully.",
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-UP HUB CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

export const getFollowUpHub = async (req, res) => {
  try {
    const { search, type, status, send_type, date_from, date_to } = req.query;
    const result = await AppointmentService.getFollowUpHubService(
      req.user.tenant_id,
      { search, type, status, send_type, date_from, date_to },
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getPendingFollowUpCount = async (req, res) => {
  try {
    const result = await AppointmentService.getPendingFollowUpCountService(
      req.user.tenant_id,
    );
    return res.status(200).json({ success: true, data: { count: result.count } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const retryFollowUp = async (req, res) => {
  try {
    const scheduled_message_id = req.params.id;
    if (!scheduled_message_id) {
      return res.status(400).json({ success: false, message: "Scheduled message ID is required" });
    }
    const result = await AppointmentService.retryFollowUpService(
      req.user.tenant_id,
      scheduled_message_id,
    );
    return res.status(200).json({ success: true, message: "Follow-up queued for retry", data: result });
  } catch (err) {
    if (err.message === "Scheduled message not found") {
      return res.status(404).json({ success: false, message: err.message });
    }
    if (err.message === "Only failed messages can be retried") {
      return res.status(400).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const rescheduleFollowUp = async (req, res) => {
  try {
    const scheduled_message_id = req.params.id;
    const { scheduled_at: new_scheduled_at } = req.body;
    if (!new_scheduled_at) {
      return res.status(400).json({ success: false, message: "New scheduled time is required" });
    }
    const result = await AppointmentService.rescheduleFollowUpService(
      req.user.tenant_id,
      scheduled_message_id,
      new_scheduled_at,
    );
    return res.status(200).json({ success: true, message: "Follow-up rescheduled", data: result });
  } catch (err) {
    if (err.message === "Scheduled message not found") {
      return res.status(404).json({ success: false, message: err.message });
    }
    if (
      err.message === "Cannot reschedule a sent message" ||
      err.message === "Scheduled time must be in the future" ||
      err.message === "Invalid scheduled time"
    ) {
      return res.status(400).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const sendNowFollowUp = async (req, res) => {
  try {
    const scheduled_message_id = req.params.id;
    if (!scheduled_message_id) {
      return res.status(400).json({ success: false, message: "Scheduled message ID is required" });
    }
    const result = await AppointmentService.sendNowFollowUpService(
      req.user.tenant_id,
      scheduled_message_id,
    );
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.status(200).json({ success: true, message: "Message sent successfully", data: result });
  } catch (err) {
    if (err.message === "Scheduled message not found") {
      return res.status(404).json({ success: false, message: err.message });
    }
    if (err.message === "Message already sent") {
      return res.status(400).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};
