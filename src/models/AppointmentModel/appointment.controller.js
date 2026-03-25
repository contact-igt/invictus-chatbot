import * as AppointmentService from "./appointment.service.js";

const VALID_STATUSES = [
  "Pending",
  "Confirmed",
  "Completed",
  "Cancelled",
  "Noshow",
];

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
    const { search, status, date, doctor_id } = req.query;
    const appointments = await AppointmentService.getAllAppointmentsService(
      req.user.tenant_id,
      { search, status, date, doctor_id },
    );
    return res.status(200).json({ success: true, data: appointments });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getContactAppointments = async (req, res) => {
  try {
    const { contact_id } = req.params;
    const appointments =
      await AppointmentService.getAppointmentsByContactIdService(
        req.user.tenant_id,
        contact_id,
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
