import express from "express";
import * as AppointmentController from "./appointment.controller.js";
import {
    authenticate,
    authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

router.use(authenticate);
router.use(authorize({ user_type: "tenant", roles: tenantRoles }));

router.post("/", AppointmentController.createAppointment);
router.get("/contact/:contact_id", AppointmentController.getContactAppointments);
router.patch("/status/:appointment_id", AppointmentController.updateStatus);
router.get("/availability", AppointmentController.checkAvailability);

export default router;
