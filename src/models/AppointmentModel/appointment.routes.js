import express from "express";
import * as AppointmentController from "./appointment.controller.js";
import {
  softDeleteAppointmentController,
  hardDeleteAppointmentController,
  restoreAppointmentController,
  getDeletedAppointmentsController,
} from "./appointment.lifecycle.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

const tenantAuth = [authenticate, authorize({ user_type: "tenant", roles: tenantRoles })];

router.post("/appointment", ...tenantAuth, AppointmentController.createAppointment);
router.get("/appointment", ...tenantAuth, AppointmentController.getAllAppointments);
router.get(
  "/appointment/contact/:contact_id",
  ...tenantAuth,
  AppointmentController.getContactAppointments,
);
router.patch(
  "/appointment/status/:appointment_id",
  ...tenantAuth,
  AppointmentController.updateStatus,
);
router.get(
  "/appointment/availability",
  ...tenantAuth,
  AppointmentController.checkAvailability,
);
router.get("/appointment/slots", ...tenantAuth, AppointmentController.getAvailableSlots);
router.put(
  "/appointment/:appointment_id",
  ...tenantAuth,
  AppointmentController.updateAppointment,
);
router.delete(
  "/appointment/:appointment_id",
  ...tenantAuth,
  AppointmentController.deleteAppointment,
);
router.delete(
  "/appointment/:appointment_id/soft",
  ...tenantAuth,
  softDeleteAppointmentController,
);

router.delete(
  "/appointment/:appointment_id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  hardDeleteAppointmentController,
);

router.post(
  "/appointment/:appointment_id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  restoreAppointmentController,
);

router.get(
  "/appointments/deleted/list",
  ...tenantAuth,
  getDeletedAppointmentsController,
);

export default router;
