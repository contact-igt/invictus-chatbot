import db from "../database/index.js";
import { createAppointmentService, getLastAppointmentService } from "../models/AppointmentModel/appointment.service.js";
import { processResponse } from "../utils/ai/aiTagHandlers/index.js";
import crypto from "crypto";

const testFlow = async () => {
    try {
        console.log("🚀 Starting Appointment Feature Verification...");

        // Sync database to create tables if they don't exist
        await db.sequelize.sync({ alter: true });
        console.log("✅ Database synced.");

        const tenant_id = "test-tenant-123";
        const contact_id = "test-contact-456";
        const phone = "1234567890";
        const name = "Test Patient";

        // 1. Clear previous test data
        await db.Appointments.destroy({ where: { tenant_id, contact_id } });
        console.log("✅ Cleared test data.");

        // 2. Test AI Tag Processing
        const mockAiResponse = `I've booked your appointment for tomorrow at 10:00 AM. Your token will be generated shortly. [BOOK_APPOINTMENT: {"date": "2026-02-22", "time": "10:00", "patient_name": "Test Patient"}]`;
        const context = {
            tenant_id,
            contact_id,
            phone,
            name
        };

        console.log("Testing AI Tag Interception...");
        const processed = await processResponse(mockAiResponse, context);

        console.log("Clean Message:", processed.message);
        console.log("Tag Detected:", processed.tagDetected);

        // Wait a bit for async execution (if any)
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 3. Verify Database Entry
        const appointment = await db.Appointments.findOne({
            where: { tenant_id, contact_id }
        });

        if (appointment) {
            console.log("✅ Appointment successfully created in DB.");
            console.log(`- ID: ${appointment.appointment_id}`);
            console.log(`- Date: ${appointment.appointment_date}`);
            console.log(`- Time: ${appointment.appointment_time}`);
            console.log(`- Status: ${appointment.status}`);
            console.log(`- Token: ${appointment.token_number}`);
        } else {
            console.error("❌ Appointment NOT found in DB.");
        }

        // 4. Test History Recovery
        console.log("Testing Appointment History Recovery...");
        const lastAppt = await getLastAppointmentService(tenant_id, contact_id);
        if (lastAppt && lastAppt.appointment_id === appointment.appointment_id) {
            console.log("✅ Last appointment correctly retrieved.");
        } else {
            console.error("❌ Failed to retrieve last appointment.");
        }

        // 5. Test Duplicate Prevention
        console.log("Testing Duplicate Prevention...");
        try {
            await createAppointmentService({
                tenant_id,
                contact_id,
                appointment_date: "2026-02-22",
                appointment_time: "10:00",
                patient_name: "Test Patient",
                contact_number: phone
            });
            console.error("❌ Duplicate prevention FAILED.");
        } catch (err) {
            console.log("✅ Duplicate prevention SUCCESSFUL:", err.message);
        }

        console.log("\n✨ Verification Complete!");

    } catch (err) {
        console.error("❌ Verification failed with error:", err.message);
    } finally {
        // process.exit(0);
    }
};

testFlow();
