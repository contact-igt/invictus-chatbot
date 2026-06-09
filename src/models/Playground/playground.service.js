import { buildAiSystemPrompt } from "../../utils/ai/aiFlowHelper.js";
import { processResponse } from "../../utils/ai/aiTagHandlers/index.js";
import { callAI } from "../../utils/ai/coreAi.js";
import {
  APPOINTMENT_OPERATION_ACTIONS,
  APPOINTMENT_OPERATION_ROUTES,
  APPOINTMENT_OPERATION_SOURCES,
  BOOKING_TO_MANAGE_SWITCH_REPLY_IDS,
  canonicalizeManageOperationMessage,
  getAppointmentOperationRouterMode,
  isAppointmentOperationDecisionEnabled,
  isManageSwitchRequestFromBookingReplyId,
  normalizeAppointmentOperationInput,
  routeAppointmentOperation,
} from "../AppointmentModel/appointmentOperationRouter.service.js";
import {
  handleAdvancedAppointmentBooking,
} from "../AppointmentModel/Advanced_Appointment_Booking.service.js";
import {
  handleManageBookedAppointments,
} from "../AppointmentModel/Manage_Booked_Appointments.service.js";
import {
  cancelAppointmentSession,
  getActiveAppointmentSession,
} from "../AppointmentModel/appointmentSession.service.js";
import { releaseLockedSlots } from "../AppointmentModel/appointmentSlotLock.service.js";
import {
  clearManageAppointmentSession,
  getActiveManageAppointmentSession,
  MANAGE_APPOINTMENT_SESSION_STATUS,
} from "../AppointmentModel/manageAppointmentSession.service.js";
import {
  buildBookingToManageSwitchConfirmPayload,
  buildTextPayload,
} from "../AppointmentModel/whatsappAppointmentTemplates.service.js";

/**
 * Main playground chat service.
 * Takes a user message + conversation history, runs it through AI with knowledge base,
 * and returns the response along with knowledge sources used.
 */
export const playgroundChatService = async (
  tenant_id,
  message,
  conversationHistory = [],
  contact_id = null,
) => {
  try {
    // Always define sources and chunks to avoid reference errors
    const languageInfo = {
      language: "detected English",
      style: "helpful and professional",
      label: "playground_sim",
    };

    // Use centralized AI flow helper for parity with production WhatsApp
    const { systemPrompt, knowledgeSources, chunks, resolvedContext } =
      await buildAiSystemPrompt(tenant_id, contact_id, languageInfo, message);

    const sources = knowledgeSources;

    // Build message array for OpenAI
    const messages = [{ role: "system", content: systemPrompt }];

    // Add conversation history
    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.forEach((msg) => {
        messages.push({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.message,
        });
      });
    }

    // Add current user message
    messages.push({ role: "user", content: message });

    const aiResult = await callAI({
      messages,
      tenant_id,
      source: "playground",
      temperature: 0.1,
      topP: 0.9,
    });

    const rawReply = aiResult.content;
    const tokenUsage = aiResult.usage;

    

    // Process tags
    const processed = await processResponse(rawReply, {
      tenant_id,
      userMessage: message,
    });

    let finalReply = processed.message;
    let tagExecutionLog = [];

    // If tags detected, simulate execution log (without actually persisting)
    if (processed.tagDetected) {
      tagExecutionLog.push(
        `Detected tag: [${processed.tagDetected}${processed.tagPayload ? ": " + processed.tagPayload : ""}]`,
      );
    }

    return {
      reply: finalReply,
      technicalLogs: {
        systemPrompt: systemPrompt,
        userMessage: message,
        rawAIResponse: rawReply,
        knowledgeChunksUsed: chunks || [],
        resolvedLogsUsed: resolvedContext || "",
        detectedTags: processed.tagDetected
          ? {
              tag: processed.tagDetected,
              payload: processed.tagPayload,
            }
          : null,
        tagExecutionHistory: tagExecutionLog,
      },
      knowledgeSources: sources,
      responseOrigin:
        chunks && chunks.length > 0 ? "knowledge_base" : "ai_generated",
      tokenUsage: {
        prompt_tokens: tokenUsage.prompt_tokens || 0,
        completion_tokens: tokenUsage.completion_tokens || 0,
        total_tokens: tokenUsage.total_tokens || 0,
      },
    };
  } catch (err) {
    console.error("[PLAYGROUND] Error:", err.message);
    throw err;
  }
};

const PLAYGROUND_SOURCES = new Set([
  "text",
  "quick_reply",
  "button_reply",
  "list_reply",
]);

const stableNumericHash = (value = "", digits = 8) => {
  let hash = 2166136261;
  const input = String(value || "playground");
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return String(hash >>> 0).padStart(digits, "0").slice(-digits);
};

const buildPlaygroundIdentity = ({ tenantId, user = {}, playgroundSessionId = null }) => {
  const userKey =
    user?.user_id ||
    user?.tenant_user_id ||
    user?.id ||
    user?.email ||
    user?.username ||
    "user";
  const identityKey = `${tenantId}:${userKey}`;
  const phoneSuffix = stableNumericHash(identityKey, 8);
  const virtualPhone = `9198${phoneSuffix}`;
  const contactHash = stableNumericHash(`${identityKey}:${playgroundSessionId || "default"}`, 12);

  return {
    phone: virtualPhone,
    contact: {
      contact_id: `PLAYGROUND_${contactHash}`,
      name: "Playground User",
      phone: virtualPhone.slice(-10),
      country_code: "+91",
      email: null,
      isPlayground: true,
    },
  };
};

const buildPlaygroundInbound = ({
  message = "",
  interactiveReplyId = null,
  replyTitle = "",
  source = "text",
  playgroundSessionId = null,
} = {}) => {
  const normalizedSource = PLAYGROUND_SOURCES.has(source) ? source : "text";
  const replyId = interactiveReplyId ? String(interactiveReplyId).trim() : null;
  const messageText = String(message || replyTitle || "").trim();

  return normalizeAppointmentOperationInput({
    messageText,
    buttonReplyId: replyId,
    messageType: replyId ? "interactive" : "text",
    rawPayload: {
      source: normalizedSource,
      playgroundSessionId: playgroundSessionId || null,
      replyTitle: replyTitle || null,
    },
  });
};

const canonicalizeBookingOperationMessage = ({ decision, normalizedMessage }) => {
  const input = normalizeAppointmentOperationInput(normalizedMessage);
  if (input.buttonReplyId) return input.effectiveText;
  switch (decision?.action) {
    case APPOINTMENT_OPERATION_ACTIONS.CONFIRM:
      return "confirm_booking";
    case APPOINTMENT_OPERATION_ACTIONS.REJECT:
    case APPOINTMENT_OPERATION_ACTIONS.CANCEL:
    case APPOINTMENT_OPERATION_ACTIONS.EXIT:
      return "cancel_booking";
    case APPOINTMENT_OPERATION_ACTIONS.CONTINUE:
      return "continue_appointment";
    case APPOINTMENT_OPERATION_ACTIONS.EDIT:
      return "edit_details";
    default:
      return input.effectiveText || "create_appointment";
  }
};

const isManageCanonicalReplyId = (value = "") => {
  const id = String(value || "").trim();
  return (
    id === "view_my_appointments" ||
    id.startsWith("manage_appt_") ||
    id.startsWith("appt_") ||
    id.startsWith("confirm_cancel_") ||
    id.startsWith("confirm_reschedule_")
  );
};

const closeBookingSessionForPlayground = async (session) => {
  if (!session) return null;
  await releaseLockedSlots(session.session_id);
  return cancelAppointmentSession(session);
};

const closeManageSessionForPlayground = async (session) => {
  if (!session) return null;
  await releaseLockedSlots(session.session_id);
  return clearManageAppointmentSession(
    session,
    MANAGE_APPOINTMENT_SESSION_STATUS.CANCELLED,
  );
};

const closeSupersededPlaygroundSession = async ({ routingResult, normalizedMessage }) => {
  const decision = routingResult?.decision;
  if (!decision?.shouldHandle) return;

  const input = normalizeAppointmentOperationInput(normalizedMessage);
  const activeBookingSession = routingResult?.activeBookingSession || null;
  const activeManageSession = routingResult?.activeManageSession || null;

  if (decision.route === APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT) {
    await closeBookingSessionForPlayground(activeBookingSession);
    return;
  }

  if (decision.route !== APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT) return;

  if (activeManageSession) {
    await closeManageSessionForPlayground(activeManageSession);
    return;
  }

  if (activeBookingSession && input.buttonReplyId === "create_appointment") {
    await closeBookingSessionForPlayground(activeBookingSession);
  }
};

const getAppointmentResponsePayloads = (result, to) => {
  if (Array.isArray(result?.payloads) && result.payloads.length) {
    return result.payloads;
  }
  if (result?.payload) return [result.payload];
  if (result?.message) return [buildTextPayload(to, result.message)];
  return [];
};

const normalizePlaygroundPayload = (payload = {}) => {
  const text =
    payload?.text?.body ||
    payload?.interactive?.body?.text ||
    payload?.message ||
    "";
  return {
    type: payload?.type || "text",
    text,
    interactive: payload?.interactive || null,
    rawPayload: payload,
  };
};

const buildSessionSnapshot = async ({ tenantId, contactId, userPhone }) => {
  const [booking, manage] = await Promise.all([
    getActiveAppointmentSession({ tenantId, contactId, userPhone }).catch(() => null),
    getActiveManageAppointmentSession({ tenantId, userPhone }).catch(() => null),
  ]);
  return {
    booking: booking
      ? {
          session_id: booking.session_id,
          state: booking.current_step,
          status: booking.status,
          expires_at: booking.expires_at,
        }
      : null,
    manage: manage
      ? {
          session_id: manage.session_id,
          state: manage.state,
          status: manage.status,
          expires_at: manage.expires_at,
          selected_appointment_id: manage.selected_appointment_id || null,
        }
      : null,
  };
};

const buildPlaygroundResult = ({
  mode,
  handled,
  contact,
  phone,
  inbound,
  routingResult = null,
  result = null,
  payloads = [],
  aiResult = null,
  sessionBefore = null,
  sessionAfter = null,
}) => ({
  mode,
  handled,
  contact: {
    contact_id: contact.contact_id,
    name: contact.name,
    phone,
  },
  responses: payloads.map(normalizePlaygroundPayload),
  debug: {
    inputSource: inbound.rawPayload?.source || "text",
    messageText: inbound.messageText,
    interactiveReplyId: inbound.buttonReplyId || null,
    routerDecision: routingResult?.decision || null,
    previousBotContext: routingResult?.previousBotContext || null,
    classifierResult: routingResult?.classifierResult || null,
    sessionBefore,
    sessionAfter,
    rawPayloads: payloads,
    appointmentResult: result
      ? {
          event: result.event || null,
          duplicate: Boolean(result.duplicate || result.alreadyProcessed),
          handoverToNormalRouter: Boolean(result.handoverToNormalRouter),
          handoverToBooking: Boolean(result.handoverToBooking),
        }
      : null,
    detectedTag: aiResult?.technicalLogs?.detectedTags?.tag || null,
    sideEffectPreview: aiResult?.technicalLogs?.detectedTags
      ? {
          tag: aiResult.technicalLogs.detectedTags.tag,
          payload: aiResult.technicalLogs.detectedTags.payload,
          executed: false,
          reason: "Playground logs AI tag actions without executing side effects.",
        }
      : null,
    ai: aiResult
      ? {
          responseOrigin: aiResult.responseOrigin,
          tokenUsage: aiResult.tokenUsage,
          technicalLogs: aiResult.technicalLogs,
          knowledgeSources: aiResult.knowledgeSources,
        }
      : null,
  },
});

const handlePlaygroundAiFallback = async ({
  tenantId,
  inbound,
  contact,
  phone,
  conversationHistory = [],
  sessionBefore = null,
  routingResult = null,
}) => {
  const aiResult = await playgroundChatService(
    tenantId,
    inbound.messageText || inbound.effectiveText || "Hello",
    conversationHistory,
    contact.contact_id,
  );
  const payloads = [buildTextPayload(phone, aiResult.reply || "Done.")];
  const sessionAfter = await buildSessionSnapshot({
    tenantId,
    contactId: contact.contact_id,
    userPhone: phone,
  });

  return buildPlaygroundResult({
    mode: "AI",
    handled: false,
    contact,
    phone,
    inbound,
    routingResult,
    payloads,
    aiResult,
    sessionBefore,
    sessionAfter,
  });
};

export const playgroundInboundService = async ({
  tenantId,
  user = {},
  message = "",
  interactiveReplyId = null,
  replyTitle = "",
  source = "text",
  playgroundSessionId = null,
  conversationHistory = [],
} = {}) => {
  const { phone, contact } = buildPlaygroundIdentity({
    tenantId,
    user,
    playgroundSessionId,
  });
  const inbound = buildPlaygroundInbound({
    message,
    interactiveReplyId,
    replyTitle,
    source,
    playgroundSessionId,
  });
  const routerMode = getAppointmentOperationRouterMode();
  const sessionBefore = await buildSessionSnapshot({
    tenantId,
    contactId: contact.contact_id,
    userPhone: phone,
  });

  const routingResult = await routeAppointmentOperation({
    tenantId,
    phone,
    contactId: contact.contact_id,
    normalizedMessage: inbound,
  });

  if (!isAppointmentOperationDecisionEnabled(routingResult.decision, routerMode)) {
    return handlePlaygroundAiFallback({
      tenantId,
      inbound,
      contact,
      phone,
      conversationHistory,
      sessionBefore,
      routingResult,
    });
  }

  const activeBookingSession = routingResult?.activeBookingSession || null;
  if (
    activeBookingSession &&
    inbound.buttonReplyId === BOOKING_TO_MANAGE_SWITCH_REPLY_IDS.CONFIRM
  ) {
    await closeBookingSessionForPlayground(activeBookingSession);
    const manageResult = await handleManageBookedAppointments({
      tenantId,
      userPhone: phone,
      contact,
      message: "view_my_appointments",
      interactiveReplyId: "view_my_appointments",
      intent: "MANAGE_APPOINTMENTS_ACTION",
    });
    const payloads = getAppointmentResponsePayloads(manageResult, phone);
    const sessionAfter = await buildSessionSnapshot({
      tenantId,
      contactId: contact.contact_id,
      userPhone: phone,
    });
    return buildPlaygroundResult({
      mode: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
      handled: true,
      contact,
      phone,
      inbound,
      routingResult,
      result: manageResult,
      payloads,
      sessionBefore,
      sessionAfter,
    });
  }

  if (
    activeBookingSession &&
    inbound.buttonReplyId === BOOKING_TO_MANAGE_SWITCH_REPLY_IDS.CANCEL
  ) {
    const bookingResult = await handleAdvancedAppointmentBooking({
      tenantId,
      userPhone: phone,
      contact,
      message: "continue_appointment",
      interactiveReplyId: "continue_appointment",
    });
    const payloads = getAppointmentResponsePayloads(bookingResult, phone);
    const sessionAfter = await buildSessionSnapshot({
      tenantId,
      contactId: contact.contact_id,
      userPhone: phone,
    });
    return buildPlaygroundResult({
      mode: APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
      handled: true,
      contact,
      phone,
      inbound,
      routingResult,
      result: bookingResult,
      payloads,
      sessionBefore,
      sessionAfter,
    });
  }

  if (
    activeBookingSession &&
    routingResult?.decision?.route === APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT &&
    isManageSwitchRequestFromBookingReplyId(inbound.buttonReplyId)
  ) {
    const payloads = [buildBookingToManageSwitchConfirmPayload(phone)];
    const sessionAfter = await buildSessionSnapshot({
      tenantId,
      contactId: contact.contact_id,
      userPhone: phone,
    });
    return buildPlaygroundResult({
      mode: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
      handled: true,
      contact,
      phone,
      inbound,
      routingResult,
      payloads,
      sessionBefore,
      sessionAfter,
    });
  }

  await closeSupersededPlaygroundSession({
    routingResult,
    normalizedMessage: inbound,
  });

  if (routingResult.decision.route === APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT) {
    const bookingMessage = canonicalizeBookingOperationMessage({
      decision: routingResult.decision,
      normalizedMessage: inbound,
    });
    const bookingResult = await handleAdvancedAppointmentBooking({
      tenantId,
      userPhone: phone,
      contact,
      message: bookingMessage,
      interactiveReplyId: inbound.buttonReplyId,
    });
    if (bookingResult?.handoverToNormalRouter) {
      return handlePlaygroundAiFallback({
        tenantId,
        inbound,
        contact,
        phone,
        conversationHistory,
        sessionBefore,
        routingResult,
      });
    }
    const payloads = getAppointmentResponsePayloads(bookingResult, phone);
    const sessionAfter = await buildSessionSnapshot({
      tenantId,
      contactId: contact.contact_id,
      userPhone: phone,
    });
    return buildPlaygroundResult({
      mode: APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
      handled: true,
      contact,
      phone,
      inbound,
      routingResult,
      result: bookingResult,
      payloads,
      sessionBefore,
      sessionAfter,
    });
  }

  if (routingResult.decision.route === APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT) {
    const manageMessage = canonicalizeManageOperationMessage({
      decision: routingResult.decision,
      normalizedMessage: inbound,
    });
    const manageReplyId =
      inbound.buttonReplyId ||
      (isManageCanonicalReplyId(manageMessage) ? manageMessage : null);
    const manageResult = await handleManageBookedAppointments({
      tenantId,
      userPhone: phone,
      contact,
      message: manageMessage,
      interactiveReplyId: manageReplyId,
      intent: "MANAGE_APPOINTMENTS_ACTION",
    });
    if (manageResult?.handoverToNormalRouter) {
      return handlePlaygroundAiFallback({
        tenantId,
        inbound,
        contact,
        phone,
        conversationHistory,
        sessionBefore,
        routingResult,
      });
    }
    if (manageResult?.handoverToBooking) {
      const bookingResult = await handleAdvancedAppointmentBooking({
        tenantId,
        userPhone: phone,
        contact,
        message: "create_appointment",
        interactiveReplyId: "create_appointment",
      });
      const payloads = getAppointmentResponsePayloads(bookingResult, phone);
      const sessionAfter = await buildSessionSnapshot({
        tenantId,
        contactId: contact.contact_id,
        userPhone: phone,
      });
      return buildPlaygroundResult({
        mode: APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
        handled: true,
        contact,
        phone,
        inbound,
        routingResult,
        result: bookingResult,
        payloads,
        sessionBefore,
        sessionAfter,
      });
    }
    const payloads = getAppointmentResponsePayloads(manageResult, phone);
    const sessionAfter = await buildSessionSnapshot({
      tenantId,
      contactId: contact.contact_id,
      userPhone: phone,
    });
    return buildPlaygroundResult({
      mode: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
      handled: true,
      contact,
      phone,
      inbound,
      routingResult,
      result: manageResult,
      payloads,
      sessionBefore,
      sessionAfter,
    });
  }

  return handlePlaygroundAiFallback({
    tenantId,
    inbound,
    contact,
    phone,
    conversationHistory,
    sessionBefore,
    routingResult,
  });
};
