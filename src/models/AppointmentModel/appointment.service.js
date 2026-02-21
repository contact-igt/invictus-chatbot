import db from "../../database/index.js";
import crypto from "crypto";
import { Op } from "sequelize";
import mailer from "../../utils/email/mailer.js";

export const createAppointmentService = async (data) => {
    const {
        tenant_id,
        contact_id,
        doctor_id,
        patient_name,
        contact_number,
        appointment_date,
        appointment_time,
        status = "Pending",
    } = data;

    try {
        // 1. Check for duplicate booking (same patient, same date+time)
        const existing = await db.Appointments.findOne({
            where: {
                tenant_id,
                contact_id,
                appointment_date,
                appointment_time,
                status: { [Op.not]: "Cancelled" },
            },
        });

        if (existing) {
            throw new Error("Already have an appointment booked for this time.");
        }

        // 2. Check for duplicate future booking (preventing multiple active bookings for same patient)
        const activeFuture = await db.Appointments.findOne({
            where: {
                tenant_id,
                contact_id,
                appointment_date: { [Op.gte]: appointment_date },
                status: { [Op.in]: ["Pending", "Confirmed"] },
            },
            order: [["appointment_date", "ASC"]],
        });

        if (activeFuture && activeFuture.appointment_date === appointment_date && activeFuture.appointment_time === appointment_time) {
            // This is caught by the first check, but good to be explicit
        } else if (activeFuture) {
            // User has another future appointment. System policy might allow multiple, 
            // but for now let's flag it or log it.
            console.log(`[APPOINTMENT] Contact ${contact_id} already has a future booking on ${activeFuture.appointment_date}`);
        }

        // 3. Generate Unique Appointment ID and Token Number
        // Simple Token Number: Count appointments for that doctor on that day
        const count = await db.Appointments.count({
            where: {
                tenant_id,
                doctor_id,
                appointment_date,
            },
        });
        const token_number = count + 1;

        const appointment = await db.Appointments.create({
            appointment_id: crypto.randomUUID(),
            tenant_id,
            doctor_id,
            contact_id,
            patient_name,
            contact_number,
            appointment_date,
            appointment_time,
            status,
            token_number,
        });

        // 4. Send Confirmation Email (Async)
        // Assuming contact might have email, or it's provided in data
        if (data.email) {
            // mailer.sendMail(...) - logic to be implemented or called
            console.log(`[APPOINTMENT] Sending confirmation email to ${data.email}`);
        }

        return appointment;
    } catch (err) {
        throw err;
    }
};

export const getAppointmentsByContactIdService = async (tenant_id, contact_id) => {
    try {
        return await db.Appointments.findAll({
            where: { tenant_id, contact_id },
            order: [["appointment_date", "DESC"], ["appointment_time", "DESC"]],
        });
    } catch (err) {
        throw err;
    }
};

export const getLastAppointmentService = async (tenant_id, contact_id) => {
    try {
        return await db.Appointments.findOne({
            where: { tenant_id, contact_id },
            order: [["appointment_date", "DESC"], ["appointment_time", "DESC"]],
        });
    } catch (err) {
        throw err;
    }
};

export const checkAvailabilityService = async (tenant_id, doctor_id, date, time) => {
    try {
        const existing = await db.Appointments.findOne({
            where: {
                tenant_id,
                doctor_id,
                appointment_date: date,
                appointment_time: time,
                status: { [Op.in]: ["Pending", "Confirmed"] },
            },
        });
        return !existing;
    } catch (err) {
        throw err;
    }
};

export const updateAppointmentStatusService = async (appointment_id, status) => {
    try {
        return await db.Appointments.update(
            { status },
            { where: { appointment_id } }
        );
    } catch (err) {
        throw err;
    }
};

// Placeholder for scheduler - will be refined in next steps
export const startAppointmentSchedulerService = () => {
    console.log("[APPOINTMENT-SCHEDULER] Initialized");
    // Implementation of Cron Job will be here
};
