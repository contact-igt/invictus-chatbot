import * as AppointmentService from "./appointment.service.js";

export const createAppointment = async (req, res) => {
    try {
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

export const getContactAppointments = async (req, res) => {
    try {
        const { contact_id } = req.params;
        const appointments = await AppointmentService.getAppointmentsByContactIdService(
            req.user.tenant_id,
            contact_id
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
        await AppointmentService.updateAppointmentStatusService(appointment_id, status);
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
        const available = await AppointmentService.checkAvailabilityService(
            req.user.tenant_id,
            doctor_id,
            date,
            time
        );
        return res.status(200).json({ success: true, available });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};
