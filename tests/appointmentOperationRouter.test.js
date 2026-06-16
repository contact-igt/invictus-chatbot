import test from "node:test";
import assert from "node:assert/strict";
import db from "../src/database/index.js";
import {
  APPOINTMENT_OPERATION_ACTIONS,
  APPOINTMENT_OPERATION_ROUTES,
  APPOINTMENT_OPERATION_SOURCES,
  BOOKING_TO_MANAGE_SWITCH_REPLY_IDS,
  PREVIOUS_BOT_CONTEXTS,
  canonicalizeManageOperationMessage,
  detectPreviousBotContextFromText,
  getAppointmentOperationRouterMode,
  isBookingToManageSwitchReplyId,
  isAppointmentOperationDecisionEnabled,
  isManageSwitchRequestFromBookingReplyId,
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
  buildBookingToManageSwitchConfirmPayload,
  buildConfirmPayload,
} from "../src/models/AppointmentModel/whatsappAppointmentTemplates.service.js";
import {
  buildManageEditMenuPayload,
  buildManageSessionExpiredPayload,
} from "../src/models/AppointmentModel/manageAppointmentTemplates.service.js";
import {
  APPOINTMENT_STATES,
  getEditResetForTarget,
  getInSessionBookingOverrideType,
  getNextIncompleteAppointmentState,
  handleAdvancedAppointmentBooking,
  isReplyValidForBookingState,
} from "../src/models/AppointmentModel/Advanced_Appointment_Booking.service.js";
import {
  ADVANCED_SESSION_STATUS,
  SESSION_TTL_MS,
} from "../src/models/AppointmentModel/appointmentSession.service.js";
import {
  buildManageEditRowsForAppointment,
  handleManageBookedAppointments,
  resolveManageDateReplyIdFromText,
  resolveManageDoctorReplyIdFromText,
  resolveManageEditFieldReplyIdFromText,
  resolveManageSlotReplyIdFromText,
  getManageEditFieldFromReplyId,
  getManageEditableFieldsForAppointment,
  isManageEditFieldAllowed,
  isManageScheduleEditPending,
} from "../src/models/AppointmentModel/Manage_Booked_Appointments.service.js";
import {
  MANAGE_APPOINTMENT_SESSION_STATUS,
  MANAGE_APPOINTMENT_SESSION_TTL_MS,
  MANAGE_APPOINTMENT_STATES,
} from "../src/models/AppointmentModel/manageAppointmentSession.service.js";
import {
  buildAvailabilityUnavailableMessage,
  buildAvailabilityUnavailableMessageForTenant,
  extractAvailabilityContactNumbers,
  setAvailabilityContactSearchForTest,
} from "../src/models/AppointmentModel/appointmentAvailabilityContact.service.js";

const withAvailabilityContactSearch = async (searchFn, callback) => {
  setAvailabilityContactSearchForTest(searchFn);
  try {
    return await callback();
  } finally {
    setAvailabilityContactSearchForTest(null);
  }
};

const noAvailabilityContactSearch = async () => ({ chunks: [], sources: [] });

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

const makeFakeBookingSession = ({
  currentStep,
  draft = {},
  sessionId = "AS_TEST",
  expiresAt = new Date(Date.now() + SESSION_TTL_MS),
} = {}) => ({
  session_id: sessionId,
  tenant_id: "TENANT1",
  contact_id: "CONTACT1",
  user_phone: "919999999999",
  flow_type: "book",
  current_step: currentStep,
  last_valid_state: currentStep,
  draft_json: draft,
  status: ADVANCED_SESSION_STATUS.IN_PROGRESS,
  expires_at: expiresAt,
  updateCalls: [],
  async update(patch) {
    this.updateCalls.push(patch);
    Object.assign(this, patch);
    return this;
  },
  async reload() {
    return this;
  },
});

const makeFakeManageSession = ({
  state = MANAGE_APPOINTMENT_STATES.EDIT_MENU,
  sessionId = "MS_TEST",
  expiresAt = new Date(Date.now() + MANAGE_APPOINTMENT_SESSION_TTL_MS),
  selectedAppointmentId = "AP001",
  appointmentIds = ["AP001"],
  pendingEditField = null,
  pendingEditValue = null,
} = {}) => ({
  session_id: sessionId,
  tenant_id: "TENANT1",
  contact_id: "CONTACT1",
  user_phone: "919999999999",
  state,
  selected_appointment_id: selectedAppointmentId,
  appointment_ids: appointmentIds,
  pending_edit_field: pendingEditField,
  pending_edit_value: pendingEditValue,
  status: MANAGE_APPOINTMENT_SESSION_STATUS.ACTIVE,
  expires_at: expiresAt,
  updateCalls: [],
  async update(patch) {
    this.updateCalls.push(patch);
    Object.assign(this, patch);
    return this;
  },
  async reload() {
    return this;
  },
});

const withAdvancedBookingDbStubs = async (
  {
    session,
    specializationRows = [],
    doctorRows = [],
  },
  callback,
) => {
  const originals = {
    findOne: db.BookingSessions.findOne,
    create: db.BookingSessions.create,
    query: db.sequelize.query,
    slotUpdate: db.AppointmentSlots.update,
    logFindOne: db.AppointmentStateLogs.findOne,
    logCreate: db.AppointmentStateLogs.create,
  };
  const slotReleaseCalls = [];
  const stateLogRows = [];
  const createCalls = [];

  db.BookingSessions.findOne = async () =>
    session.status === ADVANCED_SESSION_STATUS.IN_PROGRESS ? session : null;
  db.BookingSessions.create = async (values) => {
    createCalls.push(values);
    throw new Error("Booking session should not be created in this test");
  };
  db.sequelize.query = async (sql) => {
    const normalizedSql = String(sql).toLowerCase();
    if (normalizedSql.includes("from specializations")) {
      return [specializationRows];
    }
    if (normalizedSql.includes("from doctors")) {
      return [doctorRows];
    }
    throw new Error(`Unexpected test query: ${String(sql).slice(0, 120)}`);
  };
  db.AppointmentSlots.update = async (values, options) => {
    slotReleaseCalls.push({ values, options });
    return [1];
  };
  db.AppointmentStateLogs.findOne = async () => null;
  db.AppointmentStateLogs.create = async (row) => {
    stateLogRows.push(row);
    return row;
  };

  try {
    return await callback({ slotReleaseCalls, stateLogRows, createCalls });
  } finally {
    db.BookingSessions.findOne = originals.findOne;
    db.BookingSessions.create = originals.create;
    db.sequelize.query = originals.query;
    db.AppointmentSlots.update = originals.slotUpdate;
    db.AppointmentStateLogs.findOne = originals.logFindOne;
    db.AppointmentStateLogs.create = originals.logCreate;
  }
};

const withManageSessionDbStubs = async (
  {
    session,
    specializationRows = [],
    doctorRows = [],
    appointment = {
      appointment_id: "AP001",
      tenant_id: "TENANT1",
      status: "Pending",
      is_deleted: false,
      patient_name: "Naveen",
      email: "naveen@example.com",
      country_code: "+91",
      contact_number: "9999999999",
      doctor_id: "DOC001",
      appointment_date: "2026-05-30",
      appointment_time: "09:00 AM",
    },
  },
  callback,
) => {
  const originals = {
    findOne: db.ManageAppointmentSessions.findOne,
    create: db.ManageAppointmentSessions.create,
    appointmentFindOne: db.Appointments.findOne,
    query: db.sequelize.query,
    slotUpdate: db.AppointmentSlots.update,
    logFindOne: db.AppointmentStateLogs.findOne,
    logCreate: db.AppointmentStateLogs.create,
  };
  const slotReleaseCalls = [];
  const createCalls = [];
  const stateLogRows = [];

  db.ManageAppointmentSessions.findOne = async () =>
    session.status === MANAGE_APPOINTMENT_SESSION_STATUS.ACTIVE
      ? session
      : null;
  db.ManageAppointmentSessions.create = async (values) => {
    createCalls.push(values);
    throw new Error("Manage appointment session should not be created in this test");
  };
  db.Appointments.findOne = async () => appointment;
  db.AppointmentSlots.update = async (values, options) => {
    slotReleaseCalls.push({ values, options });
    return [1];
  };
  db.AppointmentStateLogs.findOne = async () => null;
  db.AppointmentStateLogs.create = async (row) => {
    stateLogRows.push(row);
    return row;
  };
  db.sequelize.query = async (sql) => {
    const normalizedSql = String(sql).toLowerCase();
    if (normalizedSql.includes("from specializations")) {
      return [specializationRows];
    }
    if (normalizedSql.includes("from doctors")) {
      return [doctorRows];
    }
    if (
      normalizedSql.includes("from doctor_specializations") ||
      normalizedSql.includes("from doctor_availability")
    ) {
      return [[]];
    }
    throw new Error(`Unexpected test query: ${String(sql).slice(0, 120)}`);
  };

  try {
    return await callback({ slotReleaseCalls, createCalls, stateLogRows });
  } finally {
    db.ManageAppointmentSessions.findOne = originals.findOne;
    db.ManageAppointmentSessions.create = originals.create;
    db.Appointments.findOne = originals.appointmentFindOne;
    db.sequelize.query = originals.query;
    db.AppointmentSlots.update = originals.slotUpdate;
    db.AppointmentStateLogs.findOne = originals.logFindOne;
    db.AppointmentStateLogs.create = originals.logCreate;
  }
};

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

test("booking and manage appointment sessions expire after five minutes", () => {
  assert.equal(SESSION_TTL_MS, 5 * 60 * 1000);
  assert.equal(MANAGE_APPOINTMENT_SESSION_TTL_MS, 5 * 60 * 1000);
});

test("availability contact helper extracts and formats knowledge contact numbers", () => {
  const numbers = extractAvailabilityContactNumbers([
    "Reception contact number: +91 90101 23456. Alternate mobile 91-63012-34567.",
    "Duplicate phone: 9010123456. Token 2026 should not be treated as contact.",
  ]);

  assert.deepEqual(numbers, ["91 9010123456", "91 6301234567"]);
  assert.equal(
    buildAvailabilityUnavailableMessage({
      type: "services",
      contacts: numbers,
    }),
    "Sorry, no services are available right now! Please try again later or contact us 91 9010123456 or 91 6301234567. Thank you.",
  );
  assert.equal(
    buildAvailabilityUnavailableMessage({ type: "doctors", contacts: [] }),
    "Sorry, no doctors are available right now! Please try again later. Thank you.",
  );
});

test("availability contact helper ignores invalid numbers and duplicates", () => {
  const numbers = extractAvailabilityContactNumbers([
    "Year 2026, token 12345, repeated 91 90101 23456 and +91 9010123456.",
  ]);

  assert.deepEqual(numbers, ["91 9010123456"]);
});

test("availability contact helper falls back cleanly when knowledge search fails", async () => {
  await withAvailabilityContactSearch(
    async () => {
      throw new Error("knowledge unavailable");
    },
    async () => {
      assert.equal(
        await buildAvailabilityUnavailableMessageForTenant({
          tenantId: "TENANT1",
          type: "services",
        }),
        "Sorry, no services are available right now! Please try again later. Thank you.",
      );
    },
  );
});

test("advanced booking expires and releases ownership when no services are configured", async () => {
  const session = makeFakeBookingSession({
    currentStep: APPOINTMENT_STATES.COLLECT_EMAIL,
    draft: { name: "Naveen" },
  });

  await withAvailabilityContactSearch(noAvailabilityContactSearch, async () =>
    withAdvancedBookingDbStubs(
      { session, specializationRows: [] },
      async ({ slotReleaseCalls, stateLogRows }) => {
        const result = await handleAdvancedAppointmentBooking({
          tenantId: "TENANT1",
          userPhone: "919999999999",
          contact: { contact_id: "CONTACT1", name: "Naveen" },
          message: "naveen@example.com",
          interactiveReplyId: null,
          whatsappMessageId: "wamid-no-services",
        });

        assert.equal(
          result.payload.text.body,
          "Sorry, no services are available right now! Please try again later. Thank you.",
        );
        assert.equal(result.event, "appointment_expired");
        assert.equal(result.expiredBookingSession, true);
        assert.equal(result.reason, "no_services_available");
        assert.equal(session.status, ADVANCED_SESSION_STATUS.EXPIRED);
        assert.equal(session.current_step, null);
        assert.equal(slotReleaseCalls.length, 1);
        assert.equal(
          slotReleaseCalls[0].options.where.locked_by_session_id,
          session.session_id,
        );
        assert.equal(stateLogRows.at(-1).from_state, APPOINTMENT_STATES.COLLECT_REASON);
        assert.equal(stateLogRows.at(-1).to_state, null);
      },
    ),
  );

  const followUpDecision = decisionFor("what are your opening hours?");
  assert.equal(followUpDecision.shouldHandle, false);
});

test("advanced booking expires and releases ownership when no doctors are available", async () => {
  const session = makeFakeBookingSession({
    currentStep: APPOINTMENT_STATES.COLLECT_REASON,
    draft: {
      name: "Naveen",
      email: "naveen@example.com",
      emailCollectedInSession: true,
    },
  });

  await withAvailabilityContactSearch(noAvailabilityContactSearch, async () =>
    withAdvancedBookingDbStubs(
      {
        session,
        specializationRows: [
          {
            specialization_id: "SPEC001",
            name: "Retina",
            description: "Retina care",
          },
        ],
        doctorRows: [],
      },
      async ({ slotReleaseCalls, stateLogRows }) => {
        const result = await handleAdvancedAppointmentBooking({
          tenantId: "TENANT1",
          userPhone: "919999999999",
          contact: { contact_id: "CONTACT1", name: "Naveen" },
          message: "Retina",
          interactiveReplyId: "reason_SPEC001",
          whatsappMessageId: "wamid-no-doctors",
        });

        assert.equal(
          result.payload.text.body,
          "Sorry, no doctors are available right now! Please try again later. Thank you.",
        );
        assert.equal(result.event, "appointment_expired");
        assert.equal(result.expiredBookingSession, true);
        assert.equal(result.reason, "no_doctors_available");
        assert.equal(session.status, ADVANCED_SESSION_STATUS.EXPIRED);
        assert.equal(session.current_step, null);
        assert.equal(slotReleaseCalls.length, 1);
        assert.equal(
          slotReleaseCalls[0].options.where.locked_by_session_id,
          session.session_id,
        );
        assert.equal(stateLogRows.at(-1).from_state, APPOINTMENT_STATES.SELECT_DOCTOR);
        assert.equal(stateLogRows.at(-1).to_state, null);
      },
    ),
  );

  const followUpDecision = decisionFor("what are your opening hours?");
  assert.equal(followUpDecision.shouldHandle, false);
});

test("advanced booking no-availability messages append knowledge contact details", async () => {
  const contactSearch = async () => ({
    chunks: [
      "For appointments contact reception at +91 90101 23456 or mobile 91 63012 34567.",
    ],
    sources: [],
  });
  const serviceSession = makeFakeBookingSession({
    currentStep: APPOINTMENT_STATES.COLLECT_EMAIL,
    draft: { name: "Naveen" },
    sessionId: "AS_CONTACT_SERVICE",
  });
  const doctorSession = makeFakeBookingSession({
    currentStep: APPOINTMENT_STATES.COLLECT_REASON,
    draft: {
      name: "Naveen",
      email: "naveen@example.com",
      emailCollectedInSession: true,
    },
    sessionId: "AS_CONTACT_DOCTOR",
  });

  await withAvailabilityContactSearch(contactSearch, async () => {
    await withAdvancedBookingDbStubs(
      { session: serviceSession, specializationRows: [] },
      async () => {
        const result = await handleAdvancedAppointmentBooking({
          tenantId: "TENANT1",
          userPhone: "919999999999",
          contact: { contact_id: "CONTACT1", name: "Naveen" },
          message: "naveen@example.com",
          whatsappMessageId: "wamid-contact-no-services",
        });

        assert.equal(
          result.payload.text.body,
          "Sorry, no services are available right now! Please try again later or contact us 91 9010123456 or 91 6301234567. Thank you.",
        );
      },
    );

    await withAdvancedBookingDbStubs(
      {
        session: doctorSession,
        specializationRows: [
          {
            specialization_id: "SPEC001",
            name: "Retina",
            description: "Retina care",
          },
        ],
        doctorRows: [],
      },
      async () => {
        const result = await handleAdvancedAppointmentBooking({
          tenantId: "TENANT1",
          userPhone: "919999999999",
          contact: { contact_id: "CONTACT1", name: "Naveen" },
          message: "Retina",
          interactiveReplyId: "reason_SPEC001",
          whatsappMessageId: "wamid-contact-no-doctors",
        });

        assert.equal(
          result.payload.text.body,
          "Sorry, no doctors are available right now! Please try again later or contact us 91 9010123456 or 91 6301234567. Thank you.",
        );
      },
    );
  });
});

test("booking simple edit fields enter edit input state without clearing existing draft", () => {
  const draft = {
    name: "Wrong Name",
    email: "wrong@example.com",
    emailCollectedInSession: true,
    reason: "Retina",
    doctorId: "DOC123",
    doctorName: "Dr Asha",
    date: "2026-05-22",
    time: "09:00 AM",
  };

  const nameReset = getEditResetForTarget("edit_name", draft);
  assert.equal(nameReset.nextState, APPOINTMENT_STATES.EDIT_FIELD);
  assert.equal(nameReset.editTarget, "edit_name");
  assert.equal(nameReset.draft.name, "Wrong Name");

  const emailReset = getEditResetForTarget("edit_email", draft);
  assert.equal(emailReset.nextState, APPOINTMENT_STATES.EDIT_FIELD);
  assert.equal(emailReset.editTarget, "edit_email");
  assert.equal(emailReset.draft.email, "wrong@example.com");
  assert.equal(emailReset.draft.emailCollectedInSession, true);
});

test("booking confirmation accepts edit menu field replies", () => {
  for (const replyId of ["edit_name", "edit_email", "edit_reason", "edit_doctor", "edit_date", "edit_time"]) {
    assert.equal(
      isReplyValidForBookingState({
        decodedReply: decodeAppointmentReply(replyId),
        state: APPOINTMENT_STATES.CONFIRM_BOOKING,
      }),
      true,
      replyId,
    );
  }
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

test("expired booking session is terminal until explicit booking intent", async () => {
  const session = makeFakeBookingSession({
    currentStep: APPOINTMENT_STATES.SELECT_TIME,
    expiresAt: new Date(Date.now() - 1000),
  });

  await withAdvancedBookingDbStubs(
    { session },
    async ({ slotReleaseCalls, stateLogRows, createCalls }) => {
      const result = await handleAdvancedAppointmentBooking({
        tenantId: "TENANT1",
        userPhone: "919999999999",
        contact: { contact_id: "CONTACT1", name: "Naveen" },
        message: "10:00 AM",
        interactiveReplyId: "slot_10-00-AM",
        whatsappMessageId: "wamid-expired-booking",
      });

      assert.equal(result.event, "booking_session_expired");
      assert.equal(result.payload.interactive.body.text.includes("booking session has expired"), true);
      assert.equal(session.status, ADVANCED_SESSION_STATUS.EXPIRED);
      assert.equal(session.current_step, null);
      assert.equal(createCalls.length, 0);
      assert.equal(slotReleaseCalls.length, 1);
      assert.equal(
        slotReleaseCalls[0].options.where.locked_by_session_id,
        session.session_id,
      );
      assert.equal(stateLogRows.at(-1).to_state, "BOOKING_SESSION_EXPIRED");
    },
  );

  const generalFollowUp = decisionFor("what are your opening hours?");
  assert.equal(generalFollowUp.shouldHandle, false);
  assert.equal(generalFollowUp.route, APPOINTMENT_OPERATION_ROUTES.GENERAL_QUESTION);

  const explicitBooking = decisionFor("book appointment");
  assert.equal(explicitBooking.shouldHandle, true);
  assert.equal(explicitBooking.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
});

test("expired manage session is terminal until explicit manage intent", async () => {
  const session = makeFakeManageSession({
    state: MANAGE_APPOINTMENT_STATES.EDIT_MENU,
    expiresAt: new Date(Date.now() - 1000),
  });

  await withManageSessionDbStubs(
    { session },
    async ({ slotReleaseCalls, createCalls }) => {
      const result = await handleManageBookedAppointments({
        tenantId: "TENANT1",
        userPhone: "919999999999",
        contact: { contact_id: "CONTACT1", name: "Naveen" },
        message: "doctor",
        interactiveReplyId: null,
      });

      assert.equal(result.event, "manage_session_expired");
      assert.equal(result.payload.interactive.body.text.includes("Manage Appointment session has expired"), true);
      assert.equal(session.status, MANAGE_APPOINTMENT_SESSION_STATUS.EXPIRED);
      assert.equal(createCalls.length, 0);
      assert.equal(slotReleaseCalls.length, 1);
      assert.equal(
        slotReleaseCalls[0].options.where.locked_by_session_id,
        session.session_id,
      );
    },
  );

  const generalFollowUp = decisionFor("what are your opening hours?");
  assert.equal(generalFollowUp.shouldHandle, false);
  assert.equal(generalFollowUp.route, APPOINTMENT_OPERATION_ROUTES.GENERAL_QUESTION);

  const explicitManage = decisionFor("show my appointment");
  assert.equal(explicitManage.shouldHandle, true);
  assert.equal(explicitManage.route, APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT);
});

test("manage service selection no-services expires with dynamic contact message", async () => {
  const session = makeFakeManageSession({
    state: MANAGE_APPOINTMENT_STATES.EDIT_MENU,
  });
  const contactSearch = async () => ({
    chunks: ["Call appointment desk at 91 90101 23456."],
    sources: [],
  });

  await withAvailabilityContactSearch(contactSearch, async () =>
    withManageSessionDbStubs(
      { session, specializationRows: [] },
      async ({ slotReleaseCalls, stateLogRows }) => {
        const result = await handleManageBookedAppointments({
          tenantId: "TENANT1",
          userPhone: "919999999999",
          contact: { contact_id: "CONTACT1", name: "Naveen" },
          message: "Service",
          interactiveReplyId: "manage_appt_edit_service",
        });

        assert.equal(
          result.payload.text.body,
          "Sorry, no services are available right now! Please try again later or contact us 91 9010123456. Thank you.",
        );
        assert.equal(result.event, "manage_session_expired");
        assert.equal(result.reason, "no_services_available");
        assert.equal(session.status, MANAGE_APPOINTMENT_SESSION_STATUS.EXPIRED);
        assert.equal(slotReleaseCalls.length, 1);
        assert.equal(stateLogRows.at(-1).to_state, null);
      },
    ),
  );

  const followUpDecision = decisionFor("what are your opening hours?");
  assert.equal(followUpDecision.shouldHandle, false);
});

test("manage doctor selection no-doctors expires with dynamic contact message", async () => {
  const session = makeFakeManageSession({
    state: MANAGE_APPOINTMENT_STATES.WAITING_FOR_DOCTOR_UPDATE,
    pendingEditField: "doctor",
    pendingEditValue: {
      mode: "MANAGE_APPOINTMENT",
      action: "EDIT_APPOINTMENT",
      appointmentId: "AP001",
      editField: "doctor",
    },
  });
  const contactSearch = async () => ({
    chunks: ["Reception phone +91 63012 34567."],
    sources: [],
  });

  await withAvailabilityContactSearch(contactSearch, async () =>
    withManageSessionDbStubs(
      { session, doctorRows: [] },
      async ({ slotReleaseCalls }) => {
        const result = await handleManageBookedAppointments({
          tenantId: "TENANT1",
          userPhone: "919999999999",
          contact: { contact_id: "CONTACT1", name: "Naveen" },
          message: "doctor",
        });

        assert.equal(
          result.payload.text.body,
          "Sorry, no doctors are available right now! Please try again later or contact us 91 6301234567. Thank you.",
        );
        assert.equal(result.event, "manage_session_expired");
        assert.equal(result.reason, "no_doctors_available");
        assert.equal(session.status, MANAGE_APPOINTMENT_SESSION_STATUS.EXPIRED);
        assert.equal(slotReleaseCalls.length, 1);
      },
    ),
  );

  const followUpDecision = decisionFor("what are your opening hours?");
  assert.equal(followUpDecision.shouldHandle, false);
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
    ["manage_appt_edit_service", APPOINTMENT_OPERATION_ACTIONS.EDIT],
    ["manage_appt_reason_SPEC001", APPOINTMENT_OPERATION_ACTIONS.UNKNOWN],
    ["manage_appt_doctor_DOC001", APPOINTMENT_OPERATION_ACTIONS.UNKNOWN],
    ["manage_appt_date_2026-05-30", APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE],
    ["manage_appt_slot_09-15-AM", APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE],
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

test("manage schedule edit pending is distinct from reschedule", () => {
  for (const editField of ["time", "date", "doctor", "service", "reason"]) {
    assert.equal(
      isManageScheduleEditPending({
        mode: "MANAGE_APPOINTMENT",
        action: "EDIT_APPOINTMENT",
        editField,
      }),
      true,
      editField,
    );
  }

  assert.equal(
    isManageScheduleEditPending({
      mode: "MANAGE_APPOINTMENT",
      action: "RESCHEDULE_APPOINTMENT",
      editField: "time",
    }),
    false,
  );
  assert.equal(
    isManageScheduleEditPending({
      mode: "MANAGE_APPOINTMENT",
      action: "EDIT_APPOINTMENT",
      editField: "email",
    }),
    false,
  );
});

test("manage edit menu is scoped to editable fields on the selected appointment", () => {
  const appointment = {
    appointment_id: "AP001",
    patient_name: "Naveen",
    email: "naveen@example.com",
    country_code: "+91",
    contact_number: "9999999999",
    doctor_id: "DOC001",
    appointment_date: "2026-05-30",
  };

  assert.deepEqual(getManageEditableFieldsForAppointment(appointment), [
    "name",
    "email",
    "reason",
    "service",
    "doctor",
    "date",
    "time",
  ]);
  assert.equal(getManageEditFieldFromReplyId("manage_appt_edit_time"), "time");
  assert.equal(isManageEditFieldAllowed({ appointment, replyId: "manage_appt_edit_time" }), true);

  const rows = buildManageEditRowsForAppointment(appointment);
  assert.deepEqual(
    rows.map((row) => row.id),
    [
      "manage_appt_edit_name",
      "manage_appt_edit_email",
      "manage_appt_edit_reason",
      "manage_appt_edit_service",
      "manage_appt_edit_doctor",
      "manage_appt_edit_date",
      "manage_appt_edit_time",
      "manage_appt_back_details",
    ],
  );

  const payload = buildManageEditMenuPayload("919999999999", rows);
  assert.deepEqual(
    payload.interactive.action.sections[0].rows.map((row) => row.id),
    rows.map((row) => row.id),
  );
});

test("manage edit time is unavailable without current doctor and date context", () => {
  const appointment = {
    appointment_id: "AP001",
    patient_name: "Naveen",
    email: "naveen@example.com",
    country_code: "+91",
    contact_number: "9999999999",
  };

  assert.deepEqual(getManageEditableFieldsForAppointment(appointment), [
    "name",
    "email",
    "reason",
    "service",
    "doctor",
  ]);
  assert.equal(isManageEditFieldAllowed({ appointment, replyId: "manage_appt_edit_time" }), false);
  assert.equal(isManageEditFieldAllowed({ appointment, replyId: "manage_appt_edit_date" }), false);
  assert.equal(isManageEditFieldAllowed({ appointment, replyId: "manage_appt_edit_doctor" }), true);
});

test("manage edit dependent selections resolve visible list text to manage reply ids", () => {
  assert.equal(
    resolveManageEditFieldReplyIdFromText("Time Slot\nChoose a new time"),
    "manage_appt_edit_time",
  );
  assert.equal(
    resolveManageEditFieldReplyIdFromText("Doctor\nChoose another doctor"),
    "manage_appt_edit_doctor",
  );
  assert.equal(
    resolveManageEditFieldReplyIdFromText("Date\nChoose a new date"),
    "manage_appt_edit_date",
  );

  assert.equal(
    resolveManageDoctorReplyIdFromText("Dr. Dr. Ashvin Bafna\nCataract, LASIK", [
      {
        doctor_id: "DOC001",
        name: "Ashvin Bafna",
        specializations: [{ name: "Cataract" }, { name: "LASIK" }],
      },
    ]),
    "manage_appt_doctor_DOC001",
  );

  assert.equal(
    resolveManageDateReplyIdFromText("Sat, 30 May\nSaturday, 30 May", [
      {
        value: "2026-05-30",
        label: "Sat, 30 May",
        description: "Saturday, 30 May",
      },
    ]),
    "manage_appt_date_2026-05-30",
  );

  assert.equal(
    resolveManageSlotReplyIdFromText("09:15 AM", {
      availableSlots: [{ id: "manage_appt_slot_09-15-AM", time: "09:15 AM" }],
      groupedSlots: [],
    }),
    "manage_appt_slot_09-15-AM",
  );

  assert.equal(
    resolveManageSlotReplyIdFromText("09:00 AM-10:00 AM", {
      availableSlots: [],
      groupedSlots: [
        {
          id: "manage_appt_slot_group_1",
          title: "09:00 AM-10:00 AM",
          slots: [],
        },
      ],
    }),
    "manage_appt_slot_group_1",
  );
});

test("active manage edit menu preserves visible doctor field text for manage handler", () => {
  const normalizedMessage = normalizeAppointmentOperationInput({
    messageText: "Doctor",
    buttonReplyId: null,
    messageType: "interactive",
  });
  const decision = resolveAppointmentOperationDecision({
    normalizedMessage,
    previousBotContext: PREVIOUS_BOT_CONTEXTS.ASKED_MANAGE_ACTION,
    activeManageSession: {
      session_id: "MS0001",
      state: "EDIT_MENU",
    },
  });

  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT);
  assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION);
  assert.equal(
    canonicalizeManageOperationMessage({ decision, normalizedMessage }),
    "Doctor",
  );
});

test("previous appointment details context routes short manage replies", () => {
  const context = detectPreviousBotContextFromText(
    "Your Appointment Details\n\nPatient: Test\nUpdate Appointments\nReschedule Appt\nCancel Appointments",
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

test("active booking plus old manage buttons requires switch confirmation", () => {
  for (const replyId of [
    "view_my_appointments",
    "manage_appt_reschedule",
    "manage_appt_cancel",
    "manage_appt_select_AP001",
  ]) {
    assert.equal(isManageSwitchRequestFromBookingReplyId(replyId), true, replyId);
  }

  for (const replyId of ["date_2026-05-30", "doctor_DOC123", "reason_SPEC001", "slot_09-15-AM"]) {
    assert.equal(isManageSwitchRequestFromBookingReplyId(replyId), false, replyId);
  }

  assert.equal(
    isBookingToManageSwitchReplyId(BOOKING_TO_MANAGE_SWITCH_REPLY_IDS.CONFIRM),
    true,
  );
  assert.equal(
    isBookingToManageSwitchReplyId(BOOKING_TO_MANAGE_SWITCH_REPLY_IDS.CANCEL),
    true,
  );

  const payload = buildBookingToManageSwitchConfirmPayload("919999999999");
  assert.equal(payload.interactive.body.text.includes("currently booking"), true);
  assert.deepEqual(
    payload.interactive.action.buttons.map((button) => button.reply.id),
    [
      BOOKING_TO_MANAGE_SWITCH_REPLY_IDS.CONFIRM,
      BOOKING_TO_MANAGE_SWITCH_REPLY_IDS.CANCEL,
    ],
  );
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

test("active manage session owns booking-style dependent replies", () => {
  for (const replyId of ["doctor_DOC001", "date_2026-05-30", "slot_09-15-AM", "reason_SPEC001"]) {
    const decision = decisionFor("Visible title", {
      buttonReplyId: replyId,
      activeManageSession: {
        session_id: "MS0001",
        state: "EDIT_MENU",
      },
    });

    assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT, replyId);
    assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION, replyId);
    assert.notEqual(decision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT, replyId);
  }
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

test("higher-priority appointment routes win over classifier intent", () => {
  const classifierResult = {
    intent: "APPOINTMENT_ACTION",
    requires: { knowledge: true, doctors: true, appointments: true },
  };

  const deterministic = decisionFor("book appointment", { classifierResult });
  assert.equal(deterministic.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
  assert.equal(
    deterministic.source,
    APPOINTMENT_OPERATION_SOURCES.DETERMINISTIC_PHRASE,
  );

  const activeBooking = decisionFor("what are your timings", {
    classifierResult,
    activeBookingSession: {
      session_id: "AS0001",
      current_step: APPOINTMENT_STATES.COLLECT_NAME,
    },
  });
  assert.equal(activeBooking.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
  assert.equal(activeBooking.source, APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION);

  const activeManage = decisionFor("what are your timings", {
    classifierResult,
    activeManageSession: {
      session_id: "MS0001",
      state: "EDIT_MENU",
    },
  });
  assert.equal(activeManage.route, APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT);
  assert.equal(activeManage.source, APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION);
});

test("general classifier intent falls through to normal AI route", () => {
  const decision = decisionFor("what are your timings", {
    classifierResult: {
      intent: "GENERAL_QUESTION",
      requires: { knowledge: true, doctors: false, appointments: false },
    },
  });

  assert.equal(decision.shouldHandle, false);
  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.GENERAL_QUESTION);
  assert.equal(decision.source, APPOINTMENT_OPERATION_SOURCES.GENERAL);
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
