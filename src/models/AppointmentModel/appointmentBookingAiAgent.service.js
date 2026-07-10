import { callAI } from "../../utils/ai/coreAi.js";
import { buildChatHistory } from "../../utils/chat/buildChatHistory.js";
import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { getDoctorListService } from "../DoctorModel/doctor.service.js";
import { getTenantSettingsService } from "../TenantModel/tenant.service.js";
import { buildTextPayload } from "./whatsappAppointmentTemplates.service.js";
import { createAppointmentService } from "./appointment.service.js";

export const APPOINTMENT_BOOKING_TYPES = {
  STATE_MACHINE: "state_machine",
  AI_AGENT: "ai_agent",
};

const DEFAULT_APPOINTMENT_BOOKING_AI_PROMPT =
  "Help patients book appointments for this organization. Ask for one missing detail at a time. Use the knowledge base and available doctor list only. Do not answer unrelated questions.";

const parseAiSettings = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
};

const normalizeAppointmentBookingType = (value) =>
  value === APPOINTMENT_BOOKING_TYPES.AI_AGENT
    ? APPOINTMENT_BOOKING_TYPES.AI_AGENT
    : APPOINTMENT_BOOKING_TYPES.STATE_MACHINE;

export const getAppointmentBookingAutomationSettings = async (tenantId) => {
  const tenantSettings = await getTenantSettingsService(tenantId).catch(
    () => null,
  );
  const aiSettings = parseAiSettings(tenantSettings?.ai_settings);
  const appointmentBookingType = normalizeAppointmentBookingType(
    aiSettings.appointment_booking_type,
  );
  const appointmentBookingAiPrompt =
    typeof aiSettings.appointment_booking_ai_prompt === "string" &&
    aiSettings.appointment_booking_ai_prompt.trim()
      ? aiSettings.appointment_booking_ai_prompt.trim()
      : DEFAULT_APPOINTMENT_BOOKING_AI_PROMPT;

  return {
    appointment_booking_type: appointmentBookingType,
    appointment_booking_ai_prompt: appointmentBookingAiPrompt,
    tenantSettings,
  };
};

export const isAiAppointmentBookingEnabled = async (tenantId) => {
  const settings = await getAppointmentBookingAutomationSettings(tenantId);
  return (
    settings.appointment_booking_type === APPOINTMENT_BOOKING_TYPES.AI_AGENT
  );
};

const safeParseJson = (raw = "") => {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const normalizeText = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const normalizeDateOnly = (value) => {
  const text = normalizeText(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

const findDoctorForBooking = (doctors = [], booking = {}) => {
  const doctorId = normalizeText(booking.doctor_id);
  if (doctorId) {
    const byId = doctors.find((doctor) => doctor.doctor_id === doctorId);
    if (byId) return byId;
  }

  const doctorName = normalizeText(booking.doctor_name)
    .replace(/^dr\.?\s+/i, "")
    .toLowerCase();
  if (!doctorName) return null;

  return (
    doctors.find((doctor) =>
      normalizeText(doctor.name).toLowerCase().includes(doctorName),
    ) || null
  );
};

const formatDoctorForPrompt = (doctor) => {
  const specs = (doctor.specializations || [])
    .map((spec) => spec.name)
    .filter(Boolean)
    .join(", ");
  const days = (doctor.availabilityDays || [])
    .filter((day) => day.enabled !== false)
    .map((day) => day.day_of_week)
    .filter(Boolean)
    .join(", ");
  const availability = (doctor.availability || [])
    .map((row) =>
      [row.day_of_week, `${row.start_time || ""}-${row.end_time || ""}`]
        .filter(Boolean)
        .join(": "),
    )
    .filter(Boolean)
    .join("; ");
  return [
    `Doctor ID: ${doctor.doctor_id}`,
    `Name: ${doctor.title || "Dr."} ${doctor.name}`,
    `Status: ${doctor.status || "unknown"}`,
    specs ? `Specializations: ${specs}` : null,
    days ? `Available days: ${days}` : null,
    availability ? `Availability: ${availability}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
};

const buildAppointmentAgentInstructions = ({
  tenantInstructions,
  userMessage,
  chatHistory,
  knowledgeChunks,
  doctors,
  contact,
}) => {
  const doctorContext = doctors.length
    ? doctors.map(formatDoctorForPrompt).join("\n")
    : "No active doctors are configured.";
  const knowledgeContext = knowledgeChunks.length
    ? knowledgeChunks.join("\n\n")
    : "No relevant knowledge base content found.";
  const recentContext = chatHistory
    .slice(-8)
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join("\n");

  return `You are a dedicated Appointment Booking AI Agent.

Rules:
- Handle ONLY new appointment booking conversations.
- Do not answer unrelated general questions; reply that you can help only with appointment booking.
- Use the organization appointment instructions, knowledge base, doctor list, and chat history as context.
- Ask for one missing booking detail at a time.
- Do not invent doctors, dates, times, services, prices, or policies.
- Return ONLY valid JSON with this shape:
{
  "action": "ask_details" | "answer" | "book_appointment" | "out_of_scope",
  "reply": "customer-facing WhatsApp reply",
  "booking": {
    "patient_name": "string or null",
    "doctor_id": "string or null",
    "doctor_name": "string or null",
    "appointment_date": "YYYY-MM-DD or null",
    "appointment_time": "HH:MM AM/PM or null",
    "email": "string or null",
    "notes": "reason/service need or null",
    "service_name": "string or null"
  }
}

ORGANIZATION APPOINTMENT INSTRUCTIONS:
${tenantInstructions}

CONTACT:
- Name: ${contact?.name || "Unknown"}
- Phone: ${contact?.phone || contact?.mobile || "Known WhatsApp number"}
- Email: ${contact?.email || "Unknown"}

AVAILABLE DOCTORS:
${doctorContext}

KNOWLEDGE BASE:
${knowledgeContext}

RECENT CHAT:
${recentContext || "No recent chat."}

LATEST CUSTOMER MESSAGE:
${userMessage}`;
};

const makeTextResult = (to, message, extra = {}) => ({
  success: true,
  message,
  payload: buildTextPayload(to, message),
  messageType: "text",
  event: "appointment_ai_agent",
  ...extra,
});

const hasCompleteBookingDetails = (booking = {}) =>
  Boolean(
    normalizeText(booking.patient_name) &&
      normalizeText(booking.doctor_id) &&
      normalizeDateOnly(booking.appointment_date) &&
      normalizeText(booking.appointment_time),
  );

const buildMissingDetailsReply = (booking = {}) => {
  if (!normalizeText(booking.patient_name)) {
    return "Sure, I can help you book an appointment. Please share the patient name.";
  }
  if (!normalizeText(booking.doctor_id) && !normalizeText(booking.doctor_name)) {
    return "Please share the preferred doctor or service for the appointment.";
  }
  if (!normalizeDateOnly(booking.appointment_date)) {
    return "Please share the preferred appointment date.";
  }
  if (!normalizeText(booking.appointment_time)) {
    return "Please share the preferred appointment time.";
  }
  return "Please share the remaining appointment details.";
};

export const handleAppointmentBookingAiAgent = async ({
  tenantId,
  userPhone,
  contact = null,
  message,
}) => {
  const cleanMessage = normalizeText(message);
  const settings = await getAppointmentBookingAutomationSettings(tenantId);

  const [memory, knowledgeResult, doctors] = await Promise.all([
    getConversationMemory(tenantId, userPhone, contact?.contact_id).catch(
      () => [],
    ),
    searchKnowledgeChunks(tenantId, cleanMessage).catch(() => ({
      chunks: [],
      resolvedLogs: [],
      sources: [],
    })),
    getDoctorListService(tenantId).catch(() => []),
  ]);

  const activeDoctors = doctors.filter(
    (doctor) => String(doctor.status || "").toLowerCase() === "available",
  );
  const chatHistory = buildChatHistory(memory);

  if (!activeDoctors.length) {
    return makeTextResult(
      userPhone,
      "No doctors are available right now. Please try again later.",
      { appointmentAiAction: "no_doctors" },
    );
  }

  const aiResult = await callAI({
    messages: [
      {
        role: "user",
        content: buildAppointmentAgentInstructions({
          tenantInstructions: settings.appointment_booking_ai_prompt,
          userMessage: cleanMessage,
          chatHistory,
          knowledgeChunks: knowledgeResult.chunks || [],
          doctors: activeDoctors,
          contact,
        }),
      },
    ],
    tenant_id: tenantId,
    source: "appointment_agent",
    temperature: 0,
    responseFormat: { type: "json_object" },
  });

  const parsed = safeParseJson(aiResult.content) || {};
  const action = normalizeText(parsed.action) || "ask_details";
  const booking = parsed.booking && typeof parsed.booking === "object"
    ? { ...parsed.booking }
    : {};

  const matchedDoctor = findDoctorForBooking(activeDoctors, booking);
  if (matchedDoctor) {
    booking.doctor_id = matchedDoctor.doctor_id;
    booking.doctor_name = matchedDoctor.name;
  }

  const reply = normalizeText(parsed.reply);

  if (action === "out_of_scope") {
    return makeTextResult(
      userPhone,
      reply || "I can help only with appointment booking here.",
      { appointmentAiAction: "out_of_scope" },
    );
  }

  if (action !== "book_appointment") {
    return makeTextResult(
      userPhone,
      reply || buildMissingDetailsReply(booking),
      { appointmentAiAction: action || "ask_details" },
    );
  }

  if (!matchedDoctor) {
    return makeTextResult(
      userPhone,
      "Please choose one of the available doctors for the appointment.",
      { appointmentAiAction: "missing_doctor" },
    );
  }

  if (!hasCompleteBookingDetails(booking)) {
    return makeTextResult(userPhone, reply || buildMissingDetailsReply(booking), {
      appointmentAiAction: "missing_details",
    });
  }

  try {
    const appointment = await createAppointmentService({
      tenant_id: tenantId,
      contact_id: contact?.contact_id || null,
      doctor_id: booking.doctor_id,
      patient_name: normalizeText(booking.patient_name),
      contact_number: userPhone,
      appointment_date: normalizeDateOnly(booking.appointment_date),
      appointment_time: normalizeText(booking.appointment_time),
      notes: normalizeText(booking.notes) || null,
      email: normalizeText(booking.email) || contact?.email || null,
      service_name: normalizeText(booking.service_name) || null,
      send_creation_email: false,
    });

    const messageText =
      reply ||
      `Your appointment request has been submitted successfully.\n\nAppointment ID: ${appointment.appointment_id}\nDoctor: Dr. ${matchedDoctor.name}\nDate: ${String(appointment.appointment_date).slice(0, 10)}\nTime: ${appointment.appointment_time}`;

    return makeTextResult(userPhone, messageText, {
      appointmentAiAction: "booked",
      appointment,
    });
  } catch (err) {
    return makeTextResult(
      userPhone,
      `I could not book that appointment: ${err.message}. Please share another date or time.`,
      { appointmentAiAction: "booking_failed", error: err.message },
    );
  }
};
