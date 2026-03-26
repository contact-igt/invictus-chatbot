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

router.post("/appointment", AppointmentController.createAppointment);
router.get("/appointment", AppointmentController.getAllAppointments);
router.get(
  "/appointment/contact/:contact_id",
  AppointmentController.getContactAppointments,
);
router.patch(
  "/appointment/status/:appointment_id",
  AppointmentController.updateStatus,
);
router.get(
  "/appointment/availability",
  AppointmentController.checkAvailability,
);
router.get("/appointment/slots", AppointmentController.getAvailableSlots);
router.put(
  "/appointment/:appointment_id",
  AppointmentController.updateAppointment,
);
router.delete(
  "/appointment/:appointment_id",
  AppointmentController.deleteAppointment,
);

export default router;
