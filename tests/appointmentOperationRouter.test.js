import test from "node:test";
import assert from "node:assert/strict";
import {
  APPOINTMENT_OPERATION_ACTIONS,
  APPOINTMENT_OPERATION_ROUTES,
  APPOINTMENT_OPERATION_SOURCES,
  PREVIOUS_BOT_CONTEXTS,
  canonicalizeManageOperationMessage,
  detectPreviousBotContextFromText,
  getAppointmentOperationRouterMode,
  isAppointmentOperationDecisionEnabled,
  normalizeAppointmentOperationInput,
  resolveAppointmentOperationDecision,
} from "../src/models/AppointmentModel/appointmentOperationRouter.service.js";
import {
  APPOINTMENT_REPLY_TYPES,
  decodeAppointmentReply,
} from "../src/models/AppointmentModel/appointmentReplyDecoder.js";
import {
  hasManageAppointmentStartSignal,
  shouldRouteActiveManageAppointmentMessage,
} from "../src/models/AppointmentModel/manageAppointmentRoutingGuard.service.js";
import {
  buildBookingSessionExpiredPayload,
  buildConfirmPayload,
} from "../src/models/AppointmentModel/whatsappAppointmentTemplates.service.js";
import { buildManageSessionExpiredPayload } from "../src/models/AppointmentModel/manageAppointmentTemplates.service.js";
import {
  APPOINTMENT_STATES,
  getInSessionBookingOverrideType,
  getNextIncompleteAppointmentState,
} from "../src/models/AppointmentModel/Advanced_Appointment_Booking.service.js";

const decisionFor = (messageText, overrides = {}) =>
  resolveAppointmentOperationDecision({
    normalizedMessage: normalizeAppointmentOperationInput({
      messageText,
      buttonReplyId: overrides.buttonReplyId || null,
      messageType: "text",
    }),
    previousBotContext: overrides.previousBotContext || PREVIOUS_BOT_CONTEXTS.NONE,
    classifierResult: overrides.classifierResult || null,
    activeBookingSession: overrides.activeBookingSession || null,
    activeManageSession: overrides.activeManageSession || null,
  });

test("booking phrases route to booking state machine", () => {
  for (const phrase of [
    "book",
    "appointment",
    "book appointment",
    "need doctor",
    "create appointment",
  ]) {
    const decision = decisionFor(phrase);
    assert.equal(decision.shouldHandle, true, phrase);
    assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
    assert.equal(decision.action, APPOINTMENT_OPERATION_ACTIONS.BOOK);
    assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.DETERMINISTIC_PHRASE);
  }
});

test("booking reply ids win over visible title", () => {
  for (const replyId of [
    "create_appointment",
    "doctor_DOC123",
    "date_2026-05-22",
    "slot_09-00-AM",
    "SLOT_09_00_AM",
    "confirm_booking",
    "confirm_booking_AS0001",
    "edit_details_AS0001",
    "cancel_booking_AS0001",
  ]) {
    const decision = decisionFor("Visible title", { buttonReplyId: replyId });
    assert.equal(decision.shouldHandle, true, replyId);
    assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
    assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.INTERACTIVE_REPLY);
  }
});

test("confirmation buttons are scoped to the booking session", () => {
  const payload = buildConfirmPayload(
    "919999999999",
    {
      name: "Naveen",
      email: "naveen@example.com",
      doctorName: "Asha",
      date: "2026-05-22",
      time: "09:00 AM",
      reason: "Lasik",
    },
    "AS0001",
  );
  const ids = payload.interactive.action.buttons.map((button) => button.reply.id);
  assert.deepEqual(ids, [
    "confirm_booking_AS0001",
    "edit_details_AS0001",
    "cancel_booking_AS0001",
  ]);

  const decoded = decodeAppointmentReply("edit_details_AS0001");
  assert.equal(decoded.type, APPOINTMENT_REPLY_TYPES.EDIT_DETAILS);
  assert.equal(decoded.sessionId, "AS0001");
});

test("booking always requires email collected inside current session", () => {
  assert.equal(
    getNextIncompleteAppointmentState({
      name: "Naveen",
      email: "old-contact@example.com",
      reason: "Lasik",
      doctorId: "DOC123",
      doctorName: "Dr Asha",
      date: "2026-05-22",
      time: "09:00 AM",
    }),
    APPOINTMENT_STATES.COLLECT_EMAIL,
  );

  assert.equal(
    getNextIncompleteAppointmentState({
      name: "Naveen",
      email: "fresh@example.com",
      emailCollectedInSession: true,
      reason: "Lasik",
      doctorId: "DOC123",
      doctorName: "Dr Asha",
      date: "2026-05-22",
      time: "09:00 AM",
    }),
    APPOINTMENT_STATES.CONFIRM_BOOKING,
  );
});

test("same active booking session accepts older menu replies as overwrites", () => {
  const cases = [
    {
      state: APPOINTMENT_STATES.SELECT_TIME,
      replyId: "date_2026-05-30",
      override: "date",
    },
    {
      state: APPOINTMENT_STATES.SELECT_TIME,
      replyId: "doctor_DOC123",
      override: "doctor",
    },
    {
      state: APPOINTMENT_STATES.SELECT_DOCTOR,
      replyId: "reason_SPEC001",
      override: "reason",
    },
    {
      state: APPOINTMENT_STATES.CONFIRM_BOOKING,
      replyId: "slot_09-15-AM",
      override: "time",
    },
    {
      state: APPOINTMENT_STATES.CONFIRM_BOOKING,
      replyId: "reason_SPEC001",
      override: "reason",
    },
  ];

  for (const item of cases) {
    assert.equal(
      getInSessionBookingOverrideType({
        decodedReply: decodeAppointmentReply(item.replyId),
        state: item.state,
      }),
      item.override,
      `${item.state} + ${item.replyId}`,
    );
  }

  assert.equal(
    getInSessionBookingOverrideType({
      decodedReply: decodeAppointmentReply("date_2026-05-30"),
      state: APPOINTMENT_STATES.SELECT_DATE,
    }),
    null,
  );
  assert.equal(
    getInSessionBookingOverrideType({
      decodedReply: decodeAppointmentReply("date_2026-05-30"),
      state: APPOINTMENT_STATES.COLLECT_EMAIL,
    }),
    null,
  );
});

test("expired booking and manage sessions use restart-specific templates", () => {
  const booking = buildBookingSessionExpiredPayload("919999999999");
  assert.equal(booking.interactive.body.text.includes("booking session has expired"), true);
  assert.deepEqual(
    booking.interactive.action.buttons.map((button) => button.reply.id),
    ["create_appointment", "view_my_appointments"],
  );

  const manage = buildManageSessionExpiredPayload("919999999999");
  assert.equal(manage.interactive.body.text.includes("Manage Appointment session has expired"), true);
  assert.deepEqual(
    manage.interactive.action.sections[0].rows.map((row) => row.id),
    ["view_my_appointments", "manage_appt_book_new", "manage_appt_main_menu"],
  );
});

test("active booking session keeps user replies inside booking flow", () => {
  const decision = decisionFor("test@example.com", {
    activeBookingSession: {
      session_id: "AS0001",
      current_step: "COLLECT_EMAIL",
    },
  });
  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
  assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION);
  assert.equal(decision.confidence, 1);
});

test("previous bot booking offer plus yes routes to booking", () => {
  const context = detectPreviousBotContextFromText(
    "Would you like to book a new appointment?",
  );
  const decision = decisionFor("yes", { previousBotContext: context });
  assert.equal(context, PREVIOUS_BOT_CONTEXTS.OFFERED_BOOKING);
  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
  assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.PREVIOUS_BOT_CONTEXT);
});

test("manage phrases route to manage appointment state machine", () => {
  const cases = [
    ["show my appointment", APPOINTMENT_OPERATION_ACTIONS.VIEW],
    ["my bookings", APPOINTMENT_OPERATION_ACTIONS.VIEW],
    ["edit appointment", APPOINTMENT_OPERATION_ACTIONS.EDIT],
    ["I want to edit", APPOINTMENT_OPERATION_ACTIONS.EDIT],
    ["reschedule appointment", APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE],
    ["I want to reschedule", APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE],
    ["I want to re schedule my appointment", APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE],
    ["cancel appointment", APPOINTMENT_OPERATION_ACTIONS.CANCEL],
    ["I want to cancel", APPOINTMENT_OPERATION_ACTIONS.CANCEL],
    ["change time", APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE],
    ["not coming", APPOINTMENT_OPERATION_ACTIONS.CANCEL],
  ];
  for (const [phrase, action] of cases) {
    const decision = decisionFor(phrase);
    assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT, phrase);
    assert.equal(decision.action, action, phrase);
    assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.DETERMINISTIC_PHRASE);
  }
});

test("explicit manage operation phrases start manage guard before AI", () => {
  for (const phrase of [
    "I want to reschedule",
    "I want to re schedule my appointment",
    "I want to edit",
    "I want to cancel",
  ]) {
    assert.equal(hasManageAppointmentStartSignal(phrase), true, phrase);
  }
});

test("manage reply ids route to manage appointment state machine", () => {
  const cases = [
    ["view_my_appointments", APPOINTMENT_OPERATION_ACTIONS.VIEW],
    ["manage_appt_edit", APPOINTMENT_OPERATION_ACTIONS.EDIT],
    ["manage_appt_edit_doctor", APPOINTMENT_OPERATION_ACTIONS.EDIT],
    ["manage_appt_reason_SPEC001", APPOINTMENT_OPERATION_ACTIONS.UNKNOWN],
    ["manage_appt_doctor_DOC001", APPOINTMENT_OPERATION_ACTIONS.UNKNOWN],
    ["manage_appt_reschedule", APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE],
    ["manage_appt_cancel", APPOINTMENT_OPERATION_ACTIONS.CANCEL],
    ["manage_appt_confirm_cancel", APPOINTMENT_OPERATION_ACTIONS.CONFIRM],
    ["cancel_appointment", APPOINTMENT_OPERATION_ACTIONS.CANCEL],
    ["reschedule_AP001", APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE],
    ["cancel_AP001", APPOINTMENT_OPERATION_ACTIONS.CANCEL],
    ["confirm_yes", APPOINTMENT_OPERATION_ACTIONS.CONFIRM],
    ["confirm_no", APPOINTMENT_OPERATION_ACTIONS.REJECT],
  ];
  for (const [replyId, action] of cases) {
    const decision = decisionFor("Visible title", { buttonReplyId: replyId });
    assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT, replyId);
    assert.equal(decision.action, action, replyId);
    assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.INTERACTIVE_REPLY);
  }
});

test("previous appointment details context routes short manage replies", () => {
  const context = detectPreviousBotContextFromText(
    "Your Appointment Details\n\nPatient Name: Test\nEdit Appointment\nRe-schedule\nCancel Appointment",
  );
  assert.equal(context, PREVIOUS_BOT_CONTEXTS.SHOWED_APPOINTMENT_DETAILS);

  assert.equal(decisionFor("edit", { previousBotContext: context }).action, APPOINTMENT_OPERATION_ACTIONS.EDIT);
  assert.equal(decisionFor("cancel it", { previousBotContext: context }).action, APPOINTMENT_OPERATION_ACTIONS.CANCEL);
  assert.equal(decisionFor("move it tomorrow", { previousBotContext: context }).action, APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE);
});

test("latest explicit booking signal takes ownership from active manage session", () => {
  const decision = decisionFor("I want to book a new appointment", {
    activeManageSession: {
      session_id: "MS0001",
      state: "SELECT_APPOINTMENT",
    },
  });
  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
  assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.DETERMINISTIC_PHRASE);
  assert.equal(decision.action, APPOINTMENT_OPERATION_ACTIONS.BOOK);
});

test("latest explicit manage signal takes ownership from active booking session", () => {
  for (const input of [
    { messageText: "show my appointment" },
    { messageText: "Visible title", buttonReplyId: "view_my_appointments" },
  ]) {
    const decision = decisionFor(input.messageText, {
      buttonReplyId: input.buttonReplyId,
      activeBookingSession: {
        session_id: "AS0001",
        current_step: "COLLECT_EMAIL",
      },
    });
    assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT);
    assert.notEqual(decision.source, APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION);
  }
});

test("same-flow booking text continues the active booking session", () => {
  const decision = decisionFor("I want check with doctor regarding eye", {
    activeBookingSession: {
      session_id: "AS0001",
      current_step: "COLLECT_REASON",
    },
  });
  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
  assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION);
});

test("latest create appointment button takes ownership from active manage session", () => {
  const decision = decisionFor("Create Appointment", {
    buttonReplyId: "create_appointment",
    activeManageSession: {
      session_id: "MS0001",
      state: "DETAILS",
    },
  });
  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
  assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.INTERACTIVE_REPLY);
});

test("manage edit waiting states keep typed values inside manage flow", () => {
  for (const state of [
    "AWAITING_EDIT_VALUE",
    "WAITING_FOR_NAME_UPDATE",
    "WAITING_FOR_EMAIL_UPDATE",
    "WAITING_FOR_PHONE_UPDATE",
    "WAITING_FOR_REASON_UPDATE",
    "WAITING_FOR_DOCTOR_UPDATE",
    "WAITING_FOR_SERVICE_UPDATE",
    "WAITING_FOR_DATE_UPDATE",
    "WAITING_FOR_SLOT_UPDATE",
  ]) {
    assert.equal(
      shouldRouteActiveManageAppointmentMessage({
        state,
        message: "naveen@example.com",
      }),
      true,
      state,
    );
  }
});

test("active manage edit input preserves typed value instead of reopening edit menu", () => {
  const decision = decisionFor("mahi", {
    activeManageSession: {
      session_id: "MS0001",
      state: "WAITING_FOR_NAME_UPDATE",
    },
  });

  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT);
  assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION);
  assert.equal(decision.action, APPOINTMENT_OPERATION_ACTIONS.EDIT);
  assert.equal(
    canonicalizeManageOperationMessage({
      decision,
      normalizedMessage: normalizeAppointmentOperationInput({
        messageText: "mahi",
        messageType: "text",
      }),
    }),
    "mahi",
  );
});

test("active manage edit input keeps reason text out of booking flow", () => {
  const decision = decisionFor("eye pain", {
    activeManageSession: {
      session_id: "MS0001",
      state: "WAITING_FOR_SERVICE_UPDATE",
    },
  });

  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT);
  assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION);
  assert.equal(
    canonicalizeManageOperationMessage({
      decision,
      normalizedMessage: normalizeAppointmentOperationInput({
        messageText: "eye pain",
        messageType: "text",
      }),
    }),
    "eye pain",
  );
});

test("general phrases stay in normal AI route", () => {
  for (const phrase of ["hi", "thanks", "what are your timings", "where is clinic", "services available"]) {
    const decision = decisionFor(phrase);
    assert.equal(decision.shouldHandle, false, phrase);
    assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.GENERAL_QUESTION, phrase);
  }
});

test("classifier appointment intents are blocked from normal AI in classifier mode", () => {
  const booking = decisionFor("I want to proceed", {
    classifierResult: {
      intent: "APPOINTMENT_ACTION",
      requires: { knowledge: true, doctors: true, appointments: true },
    },
  });
  assert.equal(booking.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
  assert.equal(booking.source, APPOINTMENT_OPERATION_SOURCES.CLASSIFIER_INTENT);
  assert.equal(isAppointmentOperationDecisionEnabled(booking, "classifier"), true);

  const manage = decisionFor("that will not work", {
    classifierResult: {
      intent: "MANAGE_APPOINTMENTS_ACTION",
      requires: { knowledge: false, doctors: true, appointments: true },
    },
  });
  assert.equal(manage.route, APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT);
  assert.equal(manage.source, APPOINTMENT_OPERATION_SOURCES.CLASSIFIER_INTENT);
  assert.equal(isAppointmentOperationDecisionEnabled(manage, "classifier"), true);
});

test("shadow mode computes but does not enable handling", () => {
  const decision = decisionFor("book appointment");
  assert.equal(decision.shouldHandle, true);
  assert.equal(isAppointmentOperationDecisionEnabled(decision, "shadow"), false);
  assert.equal(isAppointmentOperationDecisionEnabled(decision, "deterministic"), true);
});

test("router defaults to deterministic unless env overrides it", () => {
  const previous = process.env.APPOINTMENT_OPERATION_ROUTER_MODE;
  delete process.env.APPOINTMENT_OPERATION_ROUTER_MODE;
  assert.equal(getAppointmentOperationRouterMode(), "deterministic");
  process.env.APPOINTMENT_OPERATION_ROUTER_MODE = "shadow";
  assert.equal(getAppointmentOperationRouterMode(), "shadow");
  if (previous === undefined) delete process.env.APPOINTMENT_OPERATION_ROUTER_MODE;
  else process.env.APPOINTMENT_OPERATION_ROUTER_MODE = previous;
});
