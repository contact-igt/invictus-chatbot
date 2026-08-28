import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  APPOINTMENT_BOOKING_TYPES,
  buildAppointmentIntakeAgentInstructions,
  collectAppointmentFieldsFromHistory,
  DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT,
  DEFAULT_APPOINTMENT_INTAKE_COMPLETION_REPLY,
  deriveAppointmentRequiredFields,
  ensureAppointmentIntakeProgress,
  getAppointmentIntakeLifecycle,
  getCurrentAppointmentIntakeHistory,
  getSafeAppointmentIntakeReply,
  isValidAppointmentIntakeFieldValue,
  normalizeAppointmentAiResponse,
  selectAppointmentIntakeInstructions,
  shouldUseAppointmentAiAgent,
} from "./src/models/AppointmentModel/appointmentBookingAiAgent.service.js";
import {
  APPOINTMENT_OPERATION_ROUTES,
  APPOINTMENT_OPERATION_SOURCES,
  buildPreviousBotContextFromHistory,
  PREVIOUS_BOT_CONTEXTS,
  resolveActiveAiIntakeContinuation,
  resolveAppointmentOperationDecision,
} from "./src/models/AppointmentModel/appointmentOperationRouter.service.js";
import { buildChatHistory } from "./src/utils/chat/buildChatHistory.js";

test("default instructions collect only name, email, and reason", () => {
  assert.match(DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT, /1\. Name/);
  assert.match(DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT, /2\. Email/);
  assert.match(DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT, /3\. Reason for visit/);
  assert.match(
    DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT,
    /Ask only one missing question at a time/,
  );
  assert.match(
    DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT,
    /Do not add unnecessary acknowledgements before every question/,
  );
  assert.match(
    DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT,
    /When all required details are collected, return `intake_complete`/,
  );
  assert.match(DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT, /Never invent missing information/);
});

test("AI intake owns the conversation immediately and asks the first field", () => {
  const requiredFields = deriveAppointmentRequiredFields({
    tenantInstructions: DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT,
    usesDefaultPrompt: true,
  });
  const result = ensureAppointmentIntakeProgress({
    result: normalizeAppointmentAiResponse(
      {
        action: "answer",
        reply:
          "I'm here to help collect your appointment request details. Let's get started!",
        intake: { collected_fields: {} },
      },
      { usesDefaultPrompt: true, requiredFields },
    ),
    usesDefaultPrompt: true,
    isStart: true,
  });
  const lifecycle = getAppointmentIntakeLifecycle(result);

  assert.equal(result.action, "ask_details");
  assert.equal(
    getSafeAppointmentIntakeReply({
      ...result,
      usesDefaultPrompt: true,
    }),
    "Sure. May I know your name?",
  );
  assert.deepEqual(lifecycle, { active: true, complete: false });
  assert.equal(
    shouldUseAppointmentAiAgent({
      appointmentBookingType: APPOINTMENT_BOOKING_TYPES.AI_AGENT,
    }),
    true,
  );
  assert.equal(
    shouldUseAppointmentAiAgent({
      appointmentBookingType: APPOINTMENT_BOOKING_TYPES.STATE_MACHINE,
      appointmentIntake: lifecycle,
    }),
    true,
  );

  const completed = normalizeAppointmentAiResponse({
    action: "answer",
    intake: {
      required_fields: ["patient_name"],
      collected_fields: { patient_name: "Veeravel" },
    },
  });
  assert.equal(completed.action, "intake_complete");
  assert.deepEqual(getAppointmentIntakeLifecycle(completed), {
    active: false,
    complete: true,
  });
});

test("short acknowledgement does not satisfy name, email, or age", () => {
  assert.equal(isValidAppointmentIntakeFieldValue("patient_name", "okay"), false);
  assert.equal(isValidAppointmentIntakeFieldValue("email", "okay"), false);
  assert.equal(isValidAppointmentIntakeFieldValue("age", "okay"), false);
  assert.equal(isValidAppointmentIntakeFieldValue("age", "23"), true);
  assert.equal(
    isValidAppointmentIntakeFieldValue("email", "veeravel.igt@gmail.com"),
    true,
  );

  const retained = collectAppointmentFieldsFromHistory(
    [{ key: "age", label: "Age" }],
    [
      { sender: "ai", message: "What is your age?" },
      { sender: "user", message: "okay" },
    ],
  );
  const result = ensureAppointmentIntakeProgress({
    result: normalizeAppointmentAiResponse(
      {
        action: "intake_complete",
        reply: "Done",
        intake: { collected_fields: { age: "okay" } },
      },
      {
        requiredFields: [{ key: "age", label: "Age" }],
        previousCollectedFields: retained,
      },
    ),
  });

  assert.deepEqual(retained, {});
  assert.deepEqual(result.intake.missing_fields, ["age"]);
  assert.equal(result.action, "ask_details");
  assert.equal(result.reply, "What is your age?");
  assert.deepEqual(getAppointmentIntakeLifecycle(result), {
    active: true,
    complete: false,
  });
});

test("custom grouped question is preserved when it requests the next field", () => {
  const requiredFields = deriveAppointmentRequiredFields({
    tenantInstructions: `REQUIRED FIELDS:
- Name
- City`,
  });
  const result = ensureAppointmentIntakeProgress({
    result: normalizeAppointmentAiResponse({
      action: "ask_details",
      reply: "Please share your name and city.",
      intake: {
        required_fields: requiredFields,
        collected_fields: {},
      },
    }),
  });

  assert.deepEqual(
    requiredFields.map((field) => field.key),
    ["patient_name", "city_location"],
  );
  assert.equal(
    getSafeAppointmentIntakeReply({
      ...result,
      usesDefaultPrompt: false,
    }),
    "Please share your name and city.",
  );
});

test("custom instructions control question grouping without a fixed one-at-a-time rule", () => {
  const prompt = buildAppointmentIntakeAgentInstructions({
    tenantInstructions:
      "Collect Name, Email, Age, and Reason. Ask all fields together.",
    userMessage: "Book an appointment",
  });

  assert.match(prompt, /Ask all fields together/);
  assert.match(prompt, /ACTIVE INSTRUCTION SOURCE: CUSTOM/);
  assert.doesNotMatch(prompt, /By default, collect only/);
  assert.doesNotMatch(
    prompt.split("DEDICATED APPOINTMENT INTAKE INSTRUCTIONS:")[0],
    /one missing detail at a time/i,
  );
  assert.match(prompt, /additional_fields/);
});

test("blank custom prompt selects default while custom prompt replaces it", () => {
  const blank = selectAppointmentIntakeInstructions("   ");
  const custom = selectAppointmentIntakeInstructions(
    "Collect only Name, Age, and City.",
  );

  assert.equal(blank.uses_default_appointment_booking_ai_prompt, true);
  assert.equal(
    blank.appointment_booking_ai_prompt,
    DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT,
  );
  assert.equal(custom.uses_default_appointment_booking_ai_prompt, false);
  assert.equal(
    custom.appointment_booking_ai_prompt,
    "Collect only Name, Age, and City.",
  );
  assert.doesNotMatch(custom.appointment_booking_ai_prompt, /Email|Reason/);
  assert.deepEqual(
    deriveAppointmentRequiredFields({
      tenantInstructions: custom.appointment_booking_ai_prompt,
    }).map((field) => field.key),
    ["patient_name", "age", "city_location"],
  );

  const customState = normalizeAppointmentAiResponse({
    action: "ask_details",
    intake: {
      required_fields: ["patient_name", "age", "city"],
      collected_fields: { patient_name: "Veeravel" },
    },
  });
  assert.deepEqual(
    customState.intake.required_fields.map((field) => field.key),
    ["patient_name", "age", "city_location"],
  );
  assert.deepEqual(customState.intake.missing_fields, [
    "age",
    "city_location",
  ]);
});

test("main tenant prompt cannot add an age field to default intake", () => {
  const mainPrompt =
    "MAIN_PROMPT_CONFLICT: Appointment booking must collect Name, Email, Age and Reason.";
  const prompt = buildAppointmentIntakeAgentInstructions({
    tenantInstructions: DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT,
    usesDefaultPrompt: true,
    mainPrompt,
  });

  assert.doesNotMatch(prompt, /MAIN_PROMPT_CONFLICT/);
  assert.match(prompt, /Required intake fields come ONLY from the DEDICATED/);
  assert.equal(
    getSafeAppointmentIntakeReply({
      action: "ask_details",
      reply: "How old are you?",
      intake: {
        patient_name: "Rahul",
        email: "rahul@example.com",
        reason: "Eye checkup",
      },
      usesDefaultPrompt: true,
    }),
    DEFAULT_APPOINTMENT_INTAKE_COMPLETION_REPLY,
  );
});

test("knowledge base is factual reference and cannot add default intake fields", () => {
  const prompt = buildAppointmentIntakeAgentInstructions({
    tenantInstructions: DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT,
    usesDefaultPrompt: true,
    knowledgeChunks: [
      "Appointment booking requires Name, Email, Age and Reason.",
    ],
  });

  assert.match(prompt, /KNOWLEDGE BASE — FACTUAL REFERENCE ONLY/);
  assert.match(
    prompt,
    /Never use it to determine which appointment intake fields are required/,
  );
  assert.equal(
    getSafeAppointmentIntakeReply({
      action: "ask_details",
      reply: "How old are you?",
      intake: {
        patient_name: "Rahul",
        email: "rahul@example.com",
      },
      usesDefaultPrompt: true,
    }),
    "What is the reason for your visit?",
  );
});

test("custom appointment prompt alone controls additional intake fields", () => {
  const customPrompt =
    "Collect Name, Email, Reason and Preferred Callback Time.";
  const prompt = buildAppointmentIntakeAgentInstructions({
    tenantInstructions: customPrompt,
    mainPrompt:
      "MAIN_PROMPT_AGE_ONLY: Ask Name, Email, Age and Reason.",
  });

  assert.match(prompt, new RegExp(customPrompt.replaceAll(".", "\\.")));
  assert.doesNotMatch(prompt, /MAIN_PROMPT_AGE_ONLY/);
  assert.equal(
    getSafeAppointmentIntakeReply({
      action: "ask_details",
      reply: "Please share your preferred callback time.",
      intake: {},
      usesDefaultPrompt: false,
    }),
    "Please share your preferred callback time.",
  );
});

test("default intake stops after name, email, and reason", () => {
  const replyFor = (intake) =>
    getSafeAppointmentIntakeReply({
      action: "ask_details",
      reply: "How old are you?",
      intake,
      usesDefaultPrompt: true,
    });

  assert.equal(replyFor({}), "Sure. May I know your name?");
  assert.equal(
    replyFor({ patient_name: "Rahul" }),
    "Please share your email address.",
  );
  assert.equal(
    replyFor({ patient_name: "Rahul", email: "rahul@example.com" }),
    "What is the reason for your visit?",
  );
  assert.equal(
    replyFor({
      patient_name: "Rahul",
      email: "rahul@example.com",
      reason: "Eye checkup",
    }),
    DEFAULT_APPOINTMENT_INTAKE_COMPLETION_REPLY,
  );
});

test("eight custom fields must all be collected before completion", () => {
  const customPrompt = `REQUIRED FIELDS:

- Full Name
- Email
- Age
- Reason for Visit
- Existing Patient
- Preferred Callback Time
- Preferred Language
- City / Location

CONVERSATION STYLE:
Ask one missing field at a time.
Keep replies short.`;
  const requiredFields = deriveAppointmentRequiredFields({
    tenantInstructions: customPrompt,
  });
  const expectedKeys = [
    "patient_name",
    "email",
    "age",
    "reason",
    "existing_patient",
    "preferred_callback_time",
    "preferred_language",
    "city_location",
  ];
  const expectedQuestions = [
    "Sure. May I know your name?",
    "Please share your email address.",
    "What is your age?",
    "What is the reason for your visit?",
    "Are you an existing patient?",
    "What is your preferred callback time — Morning, Afternoon, or Evening?",
    "Which language do you prefer?",
    "Which city/location are you from?",
  ];
  const values = [
    "Veeravel",
    "veeravel.igt@gmail.com",
    "23",
    "checkup",
    "yes",
    "morning",
    "English",
    "Indore",
  ];
  const collectedFields = {};
  const askedQuestions = [];

  const startDecision = resolveAppointmentOperationDecision({
    normalizedMessage: { messageText: "book appointment" },
  });
  assert.equal(startDecision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);

  assert.deepEqual(
    requiredFields.map((field) => field.key),
    expectedKeys,
  );

  for (let index = 0; index < expectedKeys.length; index += 1) {
    const continuationContext = buildPreviousBotContextFromHistory([
      {
        sender: "ai",
        message: expectedQuestions[Math.max(0, index - 1)],
        event: "appointment_ai_agent",
        appointmentAiAction: "ask_details",
        appointment_intake: { active: true },
      },
    ]);
    const continuation = resolveActiveAiIntakeContinuation({
      aiAppointmentIntake: continuationContext.aiAppointmentIntake,
    });
    assert.equal(continuation.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
    assert.equal(
      continuation.source,
      APPOINTMENT_OPERATION_SOURCES.AI_INTAKE_CONTINUATION,
    );

    const normalized = normalizeAppointmentAiResponse(
      {
        action: "intake_complete",
        reply: "Thank you. We will confirm your appointment.",
        intake: {
          // Simulate the model incorrectly omitting the last three fields.
          required_fields: expectedKeys.slice(0, 5),
          collected_fields: collectedFields,
          missing_fields: [],
        },
      },
      { requiredFields },
    );
    const question = getSafeAppointmentIntakeReply({
      ...normalized,
      usesDefaultPrompt: false,
    });

    assert.equal(normalized.action, "ask_details");
    assert.equal(normalized.intake.missing_fields[0], expectedKeys[index]);
    assert.equal(question, expectedQuestions[index]);
    askedQuestions.push(question);
    collectedFields[expectedKeys[index]] = values[index];

    if (values[index] === "yes") {
      const afterYes = normalizeAppointmentAiResponse(
        {
          action: "intake_complete",
          intake: { collected_fields: collectedFields },
        },
        { requiredFields },
      );
      assert.deepEqual(afterYes.intake.missing_fields, [
        "preferred_callback_time",
        "preferred_language",
        "city_location",
      ]);
      assert.equal(
        getSafeAppointmentIntakeReply({
          ...afterYes,
          usesDefaultPrompt: false,
        }),
        expectedQuestions[5],
      );
    }
  }

  assert.equal(new Set(askedQuestions).size, 8);
  const complete = normalizeAppointmentAiResponse(
    {
      action: "intake_complete",
      reply: "Thank you. We will confirm your appointment.",
      intake: { collected_fields: collectedFields },
    },
    { requiredFields },
  );
  assert.equal(complete.action, "intake_complete");
  assert.deepEqual(complete.intake.missing_fields, []);
  assert.equal(
    getSafeAppointmentIntakeReply({
      ...complete,
      usesDefaultPrompt: false,
    }),
    DEFAULT_APPOINTMENT_INTAKE_COMPLETION_REPLY,
  );

  const closedContext = buildPreviousBotContextFromHistory([
    {
      sender: "ai",
      message: DEFAULT_APPOINTMENT_INTAKE_COMPLETION_REPLY,
      event: "appointment_ai_agent",
      appointmentAiAction: "intake_complete",
      appointment_intake: { active: false },
    },
  ]);
  assert.equal(
    resolveActiveAiIntakeContinuation({
      aiAppointmentIntake: closedContext.aiAppointmentIntake,
    }),
    null,
  );
});

test("Stage numbered custom format derives all eight authoritative fields", () => {
  const requiredFields = deriveAppointmentRequiredFields({
    tenantInstructions: `For this test, collect the following information:

1. Patient full name
2. Email address
3. Age
4. Reason for visit
5. Existing patient — Yes or No
6. Preferred callback time — Morning / Afternoon / Evening
7. Preferred language — English / Hindi / Other
8. City / Location

Ask one missing field at a time.`,
  });

  assert.deepEqual(
    requiredFields.map((field) => field.key),
    [
      "patient_name",
      "email",
      "age",
      "reason",
      "existing_patient",
      "preferred_callback_time",
      "preferred_language",
      "city_location",
    ],
  );
  assert.deepEqual(
    requiredFields.map((field) => field.label),
    [
      "Patient full name",
      "Email address",
      "Age",
      "Reason for visit",
      "Existing patient",
      "Preferred callback time",
      "Preferred language",
      "City / Location",
    ],
  );
});

test("current intake history retains early fields beyond the old eight-message window", () => {
  const history = [
    { sender: "ai", message: "Unrelated old conversation" },
    { sender: "user", message: "Book appointment" },
    { sender: "ai", message: "May I know your name?" },
    { sender: "user", message: "Veeravel" },
    { sender: "ai", message: "Please share your email address." },
    { sender: "user", message: "veeravel.igt@gmail.com" },
    ...Array.from({ length: 12 }, (_, index) => ({
      sender: index % 2 ? "user" : "ai",
      message: `Intake message ${index + 1}`,
    })),
  ];
  const intakeHistory = getCurrentAppointmentIntakeHistory(history);

  assert.equal(intakeHistory[0].content, "Book appointment");
  assert.equal(
    intakeHistory.some((entry) => entry.content === "Veeravel"),
    true,
  );
  assert.equal(
    intakeHistory.some(
      (entry) => entry.content === "veeravel.igt@gmail.com",
    ),
    true,
  );
  assert.equal(intakeHistory.length, 17);

  const prompt = buildAppointmentIntakeAgentInstructions({
    tenantInstructions: "Collect Name, Email, Age, and Reason.",
    chatHistory: intakeHistory,
  });
  assert.match(prompt, /Veeravel/);
  assert.match(prompt, /veeravel\.igt@gmail\.com/);
  assert.match(prompt, /Never ask again for a field whose value is already available/);
});

test("current intake history is capped at forty messages", () => {
  const history = [
    { sender: "user", message: "Book appointment" },
    ...Array.from({ length: 45 }, (_, index) => ({
      sender: index % 2 ? "user" : "ai",
      message: `Long intake ${index + 1}`,
    })),
  ];

  assert.equal(getCurrentAppointmentIntakeHistory(history).length, 40);
});

test("collected fields survive later model responses that shrink their state", () => {
  const requiredFields = deriveAppointmentRequiredFields({
    tenantInstructions: `REQUIRED FIELDS:
- Name
- Email
- Age
- Reason for Visit
- Existing Patient
- Preferred Callback Time
- Preferred Language
- City / Location`,
  });
  const history = [
    { sender: "user", message: "Book appointment" },
    { sender: "ai", message: "Sure. May I know your name?" },
    { sender: "user", message: "Veeravel" },
    { sender: "ai", message: "Please share your email address." },
    { sender: "user", message: "veeravel.igt@gmail.com" },
    { sender: "ai", message: "What is your age?" },
    { sender: "user", message: "23" },
    { sender: "ai", message: "What is the reason for your visit?" },
    { sender: "user", message: "Checkup" },
    { sender: "ai", message: "Are you an existing patient?" },
    { sender: "user", message: "Yes" },
  ];
  const retained = collectAppointmentFieldsFromHistory(requiredFields, history);
  const normalized = normalizeAppointmentAiResponse(
    {
      action: "intake_complete",
      intake: {
        // Simulate a later model turn returning an incomplete/shrunk state.
        required_fields: requiredFields.slice(0, 5),
        collected_fields: { existing_patient: "Yes" },
      },
    },
    { requiredFields, previousCollectedFields: retained },
  );

  assert.deepEqual(retained, {
    patient_name: "Veeravel",
    email: "veeravel.igt@gmail.com",
    age: "23",
    reason: "Checkup",
    existing_patient: "Yes",
  });
  assert.equal(normalized.action, "ask_details");
  assert.deepEqual(normalized.intake.missing_fields, [
    "preferred_callback_time",
    "preferred_language",
    "city_location",
  ]);
});

test("multiple configured values from one message remain collected", () => {
  const normalized = normalizeAppointmentAiResponse({
    action: "ask_details",
    intake: {
      required_fields: ["patient_name", "age", "email", "city"],
      collected_fields: {
        patient_name: "Veeravel",
        age: "23",
        email: "veeravel.igt@gmail.com",
      },
    },
  });

  assert.deepEqual(normalized.intake.collected_fields, {
    patient_name: "Veeravel",
    age: "23",
    email: "veeravel.igt@gmail.com",
  });
  assert.deepEqual(normalized.intake.missing_fields, ["city_location"]);
});

test("factual interruption can answer and resume the same missing field", () => {
  const normalized = normalizeAppointmentAiResponse({
    action: "answer",
    reply:
      "We offer eye checkups and cataract care. When you're ready, please share your email address.",
    intake: {
      required_fields: ["patient_name", "email", "reason"],
      collected_fields: { patient_name: "Veeravel" },
    },
  });

  assert.deepEqual(normalized.intake.missing_fields, ["email", "reason"]);
  assert.match(
    getSafeAppointmentIntakeReply({
      ...normalized,
      usesDefaultPrompt: false,
    }),
    /eye checkups.*share your email address/i,
  );
});

test("legacy book_appointment output is normalized and never treated as booking", () => {
  const complete = normalizeAppointmentAiResponse({
    action: "book_appointment",
    booking: {
      patient_name: "Rahul",
      email: "rahul@example.com",
      notes: "Eye checkup",
    },
  });
  const incomplete = normalizeAppointmentAiResponse({
    action: "book_appointment",
    booking: { patient_name: "Rahul" },
  });

  assert.equal(complete.action, "intake_complete");
  assert.equal(complete.intake.reason, "Eye checkup");
  assert.equal(incomplete.action, "ask_details");
});

test("intake response preserves tenant-specific additional fields", () => {
  const normalized = normalizeAppointmentAiResponse({
    action: "intake_complete",
    intake: {
      patient_name: "Rahul",
      email: "rahul@example.com",
      reason: "Eye checkup",
      additional_fields: {
        age: "35",
        preferred_callback_time: "Evening",
      },
    },
  });

  assert.deepEqual(normalized.intake.additional_fields, {
    age: "35",
    preferred_callback_time: "Evening",
  });
});

test("completion fallback cannot claim a real booking", () => {
  for (const unsafeReply of [
    "Your appointment has been confirmed. Appointment ID: APT-1",
    "Appointment confirmed.",
    "We booked your appointment successfully.",
    "Thank you. We will confirm your appointment.",
    "Your token number is 12.",
  ]) {
    const reply = getSafeAppointmentIntakeReply({
      action: "intake_complete",
      reply: unsafeReply,
      intake: {
        patient_name: "Rahul",
        email: "rahul@example.com",
        reason: "Eye checkup",
      },
      usesDefaultPrompt: true,
    });

    assert.equal(reply, DEFAULT_APPOINTMENT_INTAKE_COMPLETION_REPLY);
  }
});

test("Playground conversation history keeps default intake replies in booking routing", () => {
  const context = buildPreviousBotContextFromHistory([
    { sender: "ai", message: "Please share your email address." },
  ]);

  assert.equal(
    context.previousBotContext,
    PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_EMAIL,
  );
});

test("default name question keeps the next message in booking routing", () => {
  const context = buildPreviousBotContextFromHistory([
    { sender: "ai", message: "Sure. May I know your name?" },
  ]);

  assert.equal(
    context.previousBotContext,
    PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_NAME,
  );
});

test("default reason question keeps checkup inside booking routing", () => {
  const context = buildPreviousBotContextFromHistory([
    { sender: "ai", message: "What is the reason for your visit?" },
  ]);
  const decision = resolveAppointmentOperationDecision({
    normalizedMessage: { messageText: "checkup" },
    previousBotContext: context.previousBotContext,
  });

  assert.equal(
    context.previousBotContext,
    PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_SERVICE,
  );
  assert.equal(decision.shouldHandle, true);
  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
});

test("custom intake questions retain booking routing through the intake marker", () => {
  const context = buildPreviousBotContextFromHistory([
    {
      sender: "ai",
      message:
        "For your appointment request, please provide your age and preferred callback time.",
    },
  ]);

  assert.equal(
    context.previousBotContext,
    PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_SERVICE,
  );
});

test("yes after existing-patient question stays in active AI intake", () => {
  const context = buildPreviousBotContextFromHistory([
    {
      sender: "ai",
      message: "Are you an existing patient?",
      event: "appointment_ai_agent",
      appointmentAiAction: "ask_details",
      appointment_intake: {
        active: true,
        missing_fields: [
          "existing_patient",
          "preferred_callback_time",
          "preferred_language",
          "city_location",
        ],
      },
    },
  ]);
  const decision = resolveActiveAiIntakeContinuation({
    aiAppointmentIntake: context.aiAppointmentIntake,
  });

  assert.equal(
    context.previousBotContext,
    PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_SERVICE,
  );
  assert.equal(decision.shouldHandle, true);
  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
  assert.equal(
    decision.source,
    APPOINTMENT_OPERATION_SOURCES.AI_INTAKE_CONTINUATION,
  );
});

test("persisted WhatsApp intake metadata restores routing continuity", () => {
  const history = buildChatHistory([
    {
      sender: "ai",
      message: "Are you an existing patient?",
      message_type: "text",
      interactive_payload: JSON.stringify({
        event: "appointment_ai_agent",
        appointmentAiAction: "ask_details",
        appointment_intake: { active: true },
      }),
    },
  ]);
  const context = buildPreviousBotContextFromHistory(history);

  assert.equal(
    resolveActiveAiIntakeContinuation({
      aiAppointmentIntake: context.aiAppointmentIntake,
    })?.source,
    APPOINTMENT_OPERATION_SOURCES.AI_INTAKE_CONTINUATION,
  );
});

test("active structured ownership survives an intervening non-intake bot reply", () => {
  const context = buildPreviousBotContextFromHistory([
    {
      sender: "ai",
      message: "Sure. May I know your name?",
      event: "appointment_ai_agent",
      appointmentAiAction: "ask_details",
      appointment_intake: { active: true, complete: false },
    },
    {
      sender: "ai",
      message: "This unrelated fallback must not take ownership.",
      event: "knowledge_base_response",
    },
  ]);
  const decision = resolveActiveAiIntakeContinuation({
    aiAppointmentIntake: context.aiAppointmentIntake,
  });

  assert.equal(decision.route, APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT);
  assert.equal(
    decision.source,
    APPOINTMENT_OPERATION_SOURCES.AI_INTAKE_CONTINUATION,
  );
  assert.equal(
    shouldUseAppointmentAiAgent({
      appointmentBookingType: APPOINTMENT_BOOKING_TYPES.STATE_MACHINE,
      appointmentIntake: context.aiAppointmentIntake,
    }),
    true,
  );
});

test("AI intake answer stays active but completion returns to general routing", () => {
  const activeAnswer = buildPreviousBotContextFromHistory([
    {
      sender: "ai",
      message:
        "We offer eye checkups. When you're ready, please share your email address.",
      event: "appointment_ai_agent",
      appointmentAiAction: "answer",
      appointment_intake: { active: true },
    },
  ]);
  assert.equal(
    resolveActiveAiIntakeContinuation({
      aiAppointmentIntake: activeAnswer.aiAppointmentIntake,
    })?.route,
    APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
  );

  const explicitlyClosedAnswer = buildPreviousBotContextFromHistory([
    {
      sender: "ai",
      message: "The appointment request intake has been closed.",
      event: "appointment_ai_agent",
      appointmentAiAction: "answer",
      appointment_intake: { active: false },
    },
  ]);
  assert.equal(
    resolveActiveAiIntakeContinuation({
      aiAppointmentIntake: explicitlyClosedAnswer.aiAppointmentIntake,
    }),
    null,
  );

  const closed = buildPreviousBotContextFromHistory([
    {
      sender: "ai",
      message: DEFAULT_APPOINTMENT_INTAKE_COMPLETION_REPLY,
      event: "appointment_ai_agent",
      appointmentAiAction: "intake_complete",
      appointment_intake: { active: false },
    },
  ]);
  assert.equal(
    resolveActiveAiIntakeContinuation({
      aiAppointmentIntake: closed.aiAppointmentIntake,
    }),
    null,
  );
  assert.equal(
    resolveAppointmentOperationDecision({
      normalizedMessage: { messageText: "Tell me about services" },
      previousBotContext: closed.previousBotContext,
    }).route,
    APPOINTMENT_OPERATION_ROUTES.GENERAL_QUESTION,
  );
});

test("AI intake service has no appointment creation or doctor dependency", async () => {
  const source = await readFile(
    new URL(
      "./src/models/AppointmentModel/appointmentBookingAiAgent.service.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.doesNotMatch(source, /createAppointmentService/);
  assert.doesNotMatch(source, /appointment\.service\.js/);
  assert.doesNotMatch(source, /getDoctorListService/);
  assert.doesNotMatch(source, /booking_sessions/);
  assert.doesNotMatch(source, /createAppointmentSession/);
  assert.doesNotMatch(source, /getActiveAppointmentSession/);
  assert.doesNotMatch(source, /appointmentSlotLock/);
  assert.doesNotMatch(source, /No doctors are available right now/);
  assert.doesNotMatch(
    source,
    /\$\{(?:mainPrompt|tenantPrompt|generalAiPrompt|systemTenantPrompt)\}/,
  );
  assert.match(source, /role: "system"/);
});

test("general AI still builds its system prompt from the active tenant prompt", async () => {
  const source = await readFile(
    new URL(
      "./src/models/AuthWhatsapp/AuthWhatsapp.service.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /getActivePromptService\(tenant_id\)/);
  assert.match(source, /buildAiSystemPrompt\(/);
});

test("state-machine booking dispatch remains available", async () => {
  const source = await readFile(
    new URL(
      "./src/models/AuthWhatsapp/AuthWhatsapp.controller.js",
      import.meta.url,
    ),
    "utf8",
  );
  const decisionHandler = source.indexOf(
    "async function handleAppointmentOperationDecision",
  );
  const bookingRoute = source.indexOf(
    "decision.route === APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT",
    decisionHandler,
  );
  const stateMachineDispatch = source.indexOf(
    "await handleAdvancedAppointmentBooking({",
    bookingRoute,
  );

  assert.notEqual(decisionHandler, -1);
  assert.notEqual(bookingRoute, -1);
  assert.notEqual(stateMachineDispatch, -1);
  assert.match(source, /shouldUseAppointmentAiAgent\(/);
});

test("Playground preserves the original short reply for AI intake continuation", async () => {
  const source = await readFile(
    new URL(
      "./src/models/Playground/playground.service.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    source,
    /decision\?\.source === APPOINTMENT_OPERATION_SOURCES\.AI_INTAKE_CONTINUATION[\s\S]{0,120}return input\.effectiveText/,
  );
  assert.match(source, /shouldUseAppointmentAiAgent\(/);
});
