import * as AppointmentService from "../../../models/AppointmentModel/appointment.service.js";

export const execute = async (payload, context, cleanMessage) => {
    try {
        const { tenant_id, contact_id, contact_number } = context;
        if (!payload) return;

        const data = JSON.parse(payload);

        // Ensure required fields are present
        const appointmentData = {
            tenant_id,
            contact_id,
            patient_name: data.patient_name || context.name || "Guest",
            contact_number: data.contact_number || contact_number || context.phone,
            appointment_date: data.date,
            appointment_time: data.time,
            doctor_id: data.doctor_id || null,
            status: "Confirmed" // AI bookings are usually auto-confirmed in this flow
        };

        console.log(`[TAG-HANDLER-APPOINTMENT] Executing for tenant ${tenant_id}, contact ${contact_id}`);

        const appointment = await AppointmentService.createAppointmentService(appointmentData);

        // Optional: Send a custom WhatsApp message or update the log
        console.log(`[TAG-HANDLER-APPOINTMENT] Successfully booked. ID: ${appointment.appointment_id}, Token: ${appointment.token_number}`);

    } catch (err) {
        console.error("[TAG-HANDLER-APPOINTMENT] Execution error:", err.message);
    }
};
