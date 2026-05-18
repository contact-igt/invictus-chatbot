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
import { checkFeatureAccess } from "../../middlewares/feature/checkFeatureAccess.js";

const router = express.Router();

// [DOCTOR ROLE UNWIRED – 2026-05-13] "doctor" removed from all tenant route access.
const tenantRoles = ["tenant_admin", /* "doctor", */ "staff"];

const tenantAuth = [authenticate, authorize({ user_type: "tenant", roles: tenantRoles })];

router.post(
  "/appointment",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.createAppointment,
);
router.get(
  "/appointment",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.getAllAppointments,
);
router.get(
  "/appointment/contact/:contact_id",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.getContactAppointments,
);
router.patch(
  "/appointment/status/:appointment_id",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.updateStatus,
);
router.post(
  "/appointment-outcome",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.createAppointmentOutcome,
);
router.post(
  "/appointment/complete-with-outcome",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.completeWithOutcome,
);
router.post(
  "/complete-with-outcome",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.completeWithOutcome,
);
router.post(
  "/appointment/noshow-with-action",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.noShowWithAction,
);
router.post(
  "/noshow-with-action",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.noShowWithAction,
);
router.get(
  "/appointment/availability",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.checkAvailability,
);
router.get(
  "/appointment/slots",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.getAvailableSlots,
);
router.put(
  "/appointment/:appointment_id",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.updateAppointment,
);
router.delete(
  "/appointment/:appointment_id",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  AppointmentController.deleteAppointment,
);
router.delete(
  "/appointment/:appointment_id/soft",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  softDeleteAppointmentController,
);

router.delete(
  "/appointment/:appointment_id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  checkFeatureAccess("appointments"),
  hardDeleteAppointmentController,
);

router.post(
  "/appointment/:appointment_id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  checkFeatureAccess("appointments"),
  restoreAppointmentController,
);

router.get(
  "/appointments/deleted/list",
  ...tenantAuth,
  checkFeatureAccess("appointments"),
  getDeletedAppointmentsController,
);

export default router;
