import axios from "axios";
import https from "https";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { getSecret } from "../TenantSecretsModel/tenantSecrets.service.js";
import { encodeSlotTime } from "./appointmentReplyDecoder.js";
import { callAI } from "../../utils/ai/coreAi.js";

const httpsAgent = new https.Agent({ family: 4, keepAlive: true });

const truncate = (value, max) => String(value || "").slice(0, max);
const MAX_LIST_ROWS = 10;
const APPOINTMENT_PROMPT_REWRITE_TIMEOUT_MS = 2500;
const appointmentPromptRewriteCache = new Map();

const PROMPT_LOCALES = {
  ENGLISH: "english",
  HINGLISH: "hinglish",
  TANGLISH: "tanglish",
  HINDI_NATIVE: "hindi_native",
  TAMIL_NATIVE: "tamil_native",
};

const PROMPT_COPY = {
  [PROMPT_LOCALES.ENGLISH]: {
    ask_patient_name:
      "Sure, I can help you book an appointment. Please share the patient name.",
    ask_email: "Please share your email address for confirmation.",
    choose_doctor: "Please choose a doctor for your appointment.",
    choose_date: "Please choose an appointment date.",
    choose_time: "Please choose an available time slot.",
    confirm_appointment: "Please confirm your appointment booking.",
    booking_success:
      "Your appointment request has been submitted successfully.\n\nOur team will review your request shortly. You will receive a confirmation email once it is approved.",
    invalid_reply: "Please choose a valid option from the appointment flow.",
    no_doctors: "No doctors are available right now. Please try again later.",
    no_dates: "No dates are available for this doctor. Please choose another doctor.",
    no_slots: "No slots are available for this date. Please choose another date.",
    slot_unavailable: "Sorry, this slot is no longer available. Please choose another time.",
    missing_details: "Some appointment details are missing. Please review and confirm again.",
    doctor_unavailable: "The selected doctor is no longer available. Please choose another doctor.",
    edit_menu: "Need to change any details? Click Edit to select what to edit.",
    fallback: "How can I help with your appointment?",
  },
  [PROMPT_LOCALES.HINGLISH]: {
    ask_patient_name:
      "Sure, appointment book karne mein help karta hoon. Patient name batayiye.",
    ask_email: "Confirmation ke liye apna email address share kijiye.",
    choose_doctor: "Apni appointment ke liye doctor choose kijiye.",
    choose_date: "Appointment date choose kijiye.",
    choose_time: "Available time slot choose kijiye.",
    confirm_appointment: "Please apni appointment booking confirm kijiye.",
    booking_success:
      "Aapki appointment request successfully submit ho gayi hai.\n\nHamari team request review karegi. Approval ke baad confirmation email milega.",
    invalid_reply: "Please appointment flow se valid option choose kijiye.",
    no_doctors: "Abhi doctors available nahi hain. Please baad mein try kijiye.",
    no_dates: "Is doctor ke liye dates available nahi hain. Please another doctor choose kijiye.",
    no_slots: "Is date ke liye slots available nahi hain. Please another date choose kijiye.",
    slot_unavailable: "Sorry, ye slot ab available nahi hai. Please another time choose kijiye.",
    missing_details: "Kuch appointment details missing hain. Please review karke confirm kijiye.",
    doctor_unavailable: "Selected doctor ab available nahi hain. Please another doctor choose kijiye.",
    edit_menu: "Details change karni hain? Edit click karke field select kijiye.",
    fallback: "Appointment ke liye kaise help kar sakta hoon?",
  },
  [PROMPT_LOCALES.TANGLISH]: {
    ask_patient_name:
      "Sure, appointment book panna help panren. Patient name sollunga.",
    ask_email: "Confirmation ku unga email address share pannunga.",
    choose_doctor: "Appointment ku doctor choose pannunga.",
    choose_date: "Appointment date choose pannunga.",
    choose_time: "Available time slot choose pannunga.",
    confirm_appointment: "Please appointment booking confirm pannunga.",
    booking_success:
      "Unga appointment request successfully submit aagiduchu.\n\nEnga team request review pannum. Approve aana confirmation email varum.",
    invalid_reply: "Please appointment flow la valid option choose pannunga.",
    no_doctors: "Ippo doctors available illa. Please later try pannunga.",
    no_dates: "Indha doctor ku dates available illa. Please vera doctor choose pannunga.",
    no_slots: "Indha date ku slots available illa. Please vera date choose pannunga.",
    slot_unavailable: "Sorry, indha slot ippo available illa. Please vera time choose pannunga.",
    missing_details: "Konjam appointment details missing. Please review panni confirm pannunga.",
    doctor_unavailable: "Selected doctor ippo available illa. Please vera doctor choose pannunga.",
    edit_menu: "Details change pannanuma? Edit click panni field select pannunga.",
    fallback: "Appointment ku eppadi help pannalaam?",
  },
  [PROMPT_LOCALES.HINDI_NATIVE]: {
    ask_patient_name:
      "ज़रूर, मैं appointment book करने में मदद करता हूँ। कृपया patient name बताइए.",
    ask_email: "Confirmation के लिए कृपया अपना email address share कीजिए.",
    choose_doctor: "कृपया appointment के लिए doctor चुनिए.",
    choose_date: "कृपया appointment date चुनिए.",
    choose_time: "कृपया available time slot चुनिए.",
    confirm_appointment: "कृपया अपनी appointment booking confirm कीजिए.",
    booking_success:
      "आपकी appointment request successfully submit हो गई है.\n\nहमारी team request review करेगी। Approval के बाद confirmation email मिलेगा.",
    invalid_reply: "कृपया appointment flow में valid option चुनिए.",
    no_doctors: "अभी doctors available नहीं हैं। कृपया बाद में try कीजिए.",
    no_dates: "इस doctor के लिए dates available नहीं हैं। कृपया दूसरा doctor चुनिए.",
    no_slots: "इस date के लिए slots available नहीं हैं। कृपया दूसरी date चुनिए.",
    slot_unavailable: "Sorry, यह slot अब available नहीं है। कृपया दूसरा time चुनिए.",
    missing_details: "कुछ appointment details missing हैं। कृपया review करके confirm कीजिए.",
    doctor_unavailable: "Selected doctor अब available नहीं हैं। कृपया दूसरा doctor चुनिए.",
    edit_menu: "Details change करनी हैं? Edit click करके field चुनिए.",
    fallback: "Appointment के लिए मैं कैसे help कर सकता हूँ?",
  },
  [PROMPT_LOCALES.TAMIL_NATIVE]: {
    ask_patient_name:
      "சரி, appointment book செய்ய நான் உதவுகிறேன். Patient name சொல்லுங்கள்.",
    ask_email: "Confirmation காக உங்கள் email address share செய்யுங்கள்.",
    choose_doctor: "Appointment காக doctor தேர்வு செய்யுங்கள்.",
    choose_date: "Appointment date தேர்வு செய்யுங்கள்.",
    choose_time: "Available time slot தேர்வு செய்யுங்கள்.",
    confirm_appointment: "உங்கள் appointment booking confirm செய்யுங்கள்.",
    booking_success:
      "உங்கள் appointment request successfully submit ஆகிவிட்டது.\n\nஎங்கள் team request review செய்யும். Approval ஆன பிறகு confirmation email வரும்.",
    invalid_reply: "Appointment flow ல் valid option தேர்வு செய்யுங்கள்.",
    no_doctors: "இப்போது doctors available இல்லை. பின்னர் try செய்யுங்கள்.",
    no_dates: "இந்த doctor க்கு dates available இல்லை. வேறு doctor தேர்வு செய்யுங்கள்.",
    no_slots: "இந்த date க்கு slots available இல்லை. வேறு date தேர்வு செய்யுங்கள்.",
    slot_unavailable: "Sorry, இந்த slot இப்போது available இல்லை. வேறு time தேர்வு செய்யுங்கள்.",
    missing_details: "சில appointment details missing. Review செய்து confirm செய்யுங்கள்.",
    doctor_unavailable: "Selected doctor இப்போது available இல்லை. வேறு doctor தேர்வு செய்யுங்கள்.",
    edit_menu: "Details change செய்ய வேண்டுமா? Edit click செய்து field தேர்வு செய்யுங்கள்.",
    fallback: "Appointment காக எப்படி help செய்யலாம்?",
  },
};

const normalizePromptLocale = (languageContext = {}) => {
  const label = String(languageContext?.label || "").toLowerCase();
  const language = String(languageContext?.language || "").toLowerCase();
  const style = String(languageContext?.style || "").toLowerCase();

  if (label === "hinglish" || (language === "hindi" && style === "romanized")) {
    return PROMPT_LOCALES.HINGLISH;
  }
  if (label === "tanglish" || (language === "tamil" && style === "romanized")) {
    return PROMPT_LOCALES.TANGLISH;
  }
  if (language === "hindi" && style === "native_script") {
    return PROMPT_LOCALES.HINDI_NATIVE;
  }
  if (language === "tamil" && style === "native_script") {
    return PROMPT_LOCALES.TAMIL_NATIVE;
  }
  if (label === "english" || language === "english") {
    return PROMPT_LOCALES.ENGLISH;
  }
  return null;
};

const interpolatePromptVariables = (copy, variables = {}) =>
  Object.entries(variables).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value ?? "-"),
    copy,
  );

const getPromptCacheKey = (key, languageContext = {}) =>
  [
    key,
    String(languageContext?.language || "unknown").toLowerCase(),
    String(languageContext?.style || "unknown").toLowerCase(),
    String(languageContext?.label || "unknown").toLowerCase(),
  ].join("|");

const parseAiRewriteResponse = (raw = "") => {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed?.text === "string" ? parsed.text.trim() : null;
  } catch {
    return text
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim()
      .replace(/^"|"$/g, "")
      .trim();
  }
};

const rewriteAppointmentPromptWithAI = async ({
  key,
  englishText,
  languageContext = {},
  tenantId = null,
} = {}) => {
  const prompt = `You rewrite short WhatsApp appointment-flow prompts.

Target language: ${languageContext?.language || "unknown"}
Target writing style: ${languageContext?.style || "unknown"}
Target normalized label: ${languageContext?.label || "unknown"}

Rewrite only the visible prompt text into the target language/script.
Keep the meaning short and natural for WhatsApp.
Preserve these exactly if present:
- placeholders like {name}
- doctor names, clinic names, patient names
- dates, times, phone numbers
- appointment IDs, token numbers
- service names
- button IDs, list row IDs
- URLs, prices
- English product words already present such as appointment, book, patient name, doctor, email, slot, confirmation

Return only JSON: {"text":"..."}

Prompt key: ${key}
English source of truth:
${englishText}`;

  const helperCall = callAI({
    messages: [{ role: "system", content: prompt }],
    tenant_id: tenantId,
    source: "utility",
    temperature: 0,
    responseFormat: { type: "json_object" },
    maxTokens: 180,
  });
  const timeout = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error("appointment prompt rewrite timeout")),
      APPOINTMENT_PROMPT_REWRITE_TIMEOUT_MS,
    );
  });
  const result = await Promise.race([helperCall, timeout]);
  return parseAiRewriteResponse(result?.content);
};

export const getAppointmentPrompt = (
  key,
  languageContext = {},
  variables = {},
) => {
  const locale = normalizePromptLocale(languageContext);
  const resolvedLocale = locale || PROMPT_LOCALES.ENGLISH;
  const usedFallback = !locale;
  const copy =
    PROMPT_COPY[resolvedLocale]?.[key] ||
    PROMPT_COPY[PROMPT_LOCALES.ENGLISH][key] ||
    PROMPT_COPY[PROMPT_LOCALES.ENGLISH].fallback;

  

  return interpolatePromptVariables(copy, variables);
};

export const getAppointmentPromptAsync = async (
  key,
  languageContext = {},
  variables = {},
  options = {},
) => {
  const locale = normalizePromptLocale(languageContext);
  const englishCopy =
    PROMPT_COPY[PROMPT_LOCALES.ENGLISH][key] ||
    PROMPT_COPY[PROMPT_LOCALES.ENGLISH].fallback;

  if (locale && PROMPT_COPY[locale]?.[key]) {
    
    return interpolatePromptVariables(PROMPT_COPY[locale][key], variables);
  }

  const detectedLabel = String(
    languageContext?.label || languageContext?.language || "",
  ).toLowerCase();
  if (!detectedLabel || detectedLabel === "unknown" || detectedLabel === "english") {
    
    return interpolatePromptVariables(englishCopy, variables);
  }

  const cacheKey = getPromptCacheKey(key, languageContext);
  if (appointmentPromptRewriteCache.has(cacheKey)) {
    
    return interpolatePromptVariables(
      appointmentPromptRewriteCache.get(cacheKey),
      variables,
    );
  }

  

  try {
    const rewritten = await rewriteAppointmentPromptWithAI({
      key,
      englishText: englishCopy,
      languageContext,
      tenantId: options.tenantId || null,
    });
    if (!rewritten) throw new Error("AI rewrite returned empty text");
    appointmentPromptRewriteCache.set(cacheKey, rewritten);
    
    return interpolatePromptVariables(rewritten, variables);
  } catch (err) {
    console.warn("[APPT-LANG-PROMPT]", {
      key,
      locale: PROMPT_LOCALES.ENGLISH,
      source: "ai_rewrite_failed_english_fallback",
      cache: "miss",
      usedFallback: true,
      reason: err.message,
      detectedLanguage: languageContext?.language || "unknown",
      detectedStyle: languageContext?.style || "unknown",
      detectedLabel: languageContext?.label || "unknown",
    });
    return interpolatePromptVariables(englishCopy, variables);
  }
};

const getWhatsAppCredentials = async (tenant_id) => {
  const [rows] = await db.sequelize.query(
    `SELECT phone_number_id
     FROM ${tableNames.WHATSAPP_ACCOUNT}
     WHERE tenant_id = ? AND status IN ('active', 'verified')
     LIMIT 1`,
    { replacements: [tenant_id] },
  );
  if (!rows.length) throw new Error("No active WhatsApp account for tenant");

  const access_token = await getSecret(tenant_id, "whatsapp");
  if (!access_token) throw new Error("WhatsApp access token not found");

  return {
    phone_number_id: rows[0].phone_number_id,
    access_token,
  };
};

export const sendAppointmentPayload = async (tenant_id, payload) => {
  const { phone_number_id, access_token } = await getWhatsAppCredentials(tenant_id);
  const version = process.env.META_API_VERSION || "v25.0";
  try {
    const response = await axios.post(
      `https://graph.facebook.com/${version}/${phone_number_id}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        httpsAgent,
      },
    );

    const wamid = response.data?.messages?.[0]?.id || null;
    if (!wamid) {
      throw new Error("WhatsApp send did not return a message id");
    }
    return wamid;
  } catch (axiosErr) {
    if (axiosErr.response) {
      console.error(
        "[ADV-APPT-WA] Meta API error:",
        JSON.stringify(axiosErr.response.data, null, 2),
      );
      const metaErr = axiosErr.response.data?.error || {};
      const metaMsg = metaErr.message || axiosErr.message;
      const code = metaErr.code ? ` (Code: ${metaErr.code})` : "";
      const subcode = metaErr.error_subcode
        ? ` (Subcode: ${metaErr.error_subcode})`
        : "";

      if (metaErr.code === 190 || metaErr.type === "OAuthException") {
        const tokenErr = new Error(
          `Meta Access Token Error: ${metaMsg}${code}${subcode}`,
        );
        tokenErr.isTokenError = true;
        throw tokenErr;
      }

      throw new Error(`Meta API Error: ${metaMsg}${code}${subcode}`);
    }
    throw axiosErr;
  }
};

export const buildTextPayload = (to, text) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "text",
  text: {
    preview_url: false,
    body: truncate(text, 4096),
  },
});

const buildButtonPayload = (to, text, buttons) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: truncate(text, 1024) },
    action: {
      buttons: buttons.slice(0, 3).map((button) => ({
        type: "reply",
        reply: {
          id: truncate(button.id, 256),
          title: truncate(button.title, 20),
        },
      })),
    },
  },
});

export const buildTextOptionsPayload = (to, text, buttons) =>
  buildButtonPayload(to, text, buttons);

const buildListPayload = (to, text, buttonLabel, sections) => {
  let count = 0;
  const safeSections = sections
    .map((section) => ({
      title: truncate(section.title, 24),
      rows: (section.rows || [])
        .filter(() => {
          if (count >= MAX_LIST_ROWS) return false;
          count += 1;
          return true;
        })
        .map((row) => ({
          id: truncate(row.id, 200),
          title: truncate(row.title, 24),
          description: truncate(row.description, 72),
        })),
    }))
    .filter((section) => section.rows.length);

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: truncate(text, 1024) },
      action: {
        button: truncate(buttonLabel, 20),
        sections: safeSections,
      },
    },
  };
};

export const buildDoctorListPayload = (to, doctors, options = {}) => {
  const rows = doctors.map((doctor) => ({
    id: `doctor_${doctor.doctor_id}`,
    title: `Dr. ${doctor.name}`,
    description:
      (doctor.specializations || []).map((s) => s.name).join(", ") ||
      doctor.qualification ||
      "Available",
  }));

  return buildListPayload(
    to,
    options.bodyText || getAppointmentPrompt("choose_doctor", options.languageContext),
    "View doctors",
    [{ title: "Available doctors", rows }],
  );
};

export const buildDateListPayload = (to, dates, options = {}) => {
  const rows = dates.map((date) => ({
    id: `date_${date.value}`,
    title: date.label,
    description: date.description || "Available",
  }));

  return buildListPayload(
    to,
    options.bodyText || getAppointmentPrompt("choose_date", options.languageContext),
    "Pick date",
    [{ title: "Available dates", rows }],
  );
};

export const buildTimeSlotPayload = (to, slots, options = {}) => {
  const rows = slots.map((slot) => ({
    id: slot.id || `slot_${encodeSlotTime(slot.time || slot)}`,
    title: slot.title || slot.time || slot,
    description: slot.description || "Available",
  }));

  return buildListPayload(
    to,
    options.bodyText || getAppointmentPrompt("choose_time", options.languageContext),
    "Pick time",
    [{ title: options.sectionTitle || "Available Time Slots", rows }],
  );
};

export const buildReasonServiceListPayload = (
  to,
  services,
  bodyText = "Please select our services for visit from the list, or type reason for Visit.",
  options = {},
) => {
  const rows = services.map((service) => ({
    id: `reason_${service.specialization_id || service.id}`,
    title: service.name,
    description: service.description || "Reason for visit",
  }));

  const payload = buildListPayload(
    to,
    bodyText || getAppointmentPrompt("invalid_reply", options.languageContext),
    "Select Services",
    [{ title: "Services", rows }],
  );

  payload.interactive.header = {
    type: "text",
    text: "Select Our Services / Reason for Visit",
  };

  return payload;
};

const withSessionScope = (id, sessionId = null) =>
  sessionId ? `${id}_${sessionId}` : id;

export const buildConfirmPayload = (
  to,
  draft,
  sessionId = null,
  options = {},
) => {
  const text =
    `${options.bodyText || getAppointmentPrompt("confirm_appointment", options.languageContext)}\n\n` +
    `Name: ${draft.name || "-"}\n` +
    `Email: ${draft.email || "-"}\n` +
    `Doctor: ${draft.doctorName ? `Dr. ${draft.doctorName}` : "-"}\n` +
    `Date: ${draft.date || "-"}\n` +
    `Time: ${draft.time || "-"}\n` +
    `Reason: ${draft.reason || "-"}`;

  return buildButtonPayload(to, text, [
    { id: withSessionScope("confirm_booking", sessionId), title: "Confirm" },
    { id: withSessionScope("edit_details", sessionId), title: "Edit" },
    { id: withSessionScope("cancel_booking", sessionId), title: "Cancel" },
  ]);
};

export const buildEditMenuPayload = (to, editableFields, options = {}) =>
  buildListPayload(
    to,
    options.bodyText || getAppointmentPrompt("edit_menu", options.languageContext),
    "Edit",
    [
      {
        title: "Appointment details",
        rows: editableFields,
      },
    ],
  );

export const buildSuccessPayload = (to, appointment, options = {}) =>
  buildTextPayload(
    to,
    `${options.bodyText || getAppointmentPrompt("booking_success", options.languageContext)}\n\n` +
      `Appointment ID: ${appointment.appointment_id || "-"}\n` +
      `Token: #${appointment.token_number || "-"}\n` +
      `Date: ${appointment.appointment_date || "-"}\n` +
      `Time: ${appointment.appointment_time || "-"}`,
  );

export const buildQuitPayload = (to) =>
  buildButtonPayload(to, "Do you want to cancel this appointment booking?", [
    { id: "cancel_appointment", title: "Yes, Cancel" },
    { id: "continue_appointment", title: "No, Continue" },
  ]);

export const buildAppointmentResumeCancelPayload = (to) =>
  buildButtonPayload(
    to,
    "You are currently in the middle of booking an appointment.\n\nWould you like to continue your appointment booking or cancel it?",
    [
      { id: "continue_appointment", title: "Continue" },
      { id: "cancel_appointment", title: "Cancel" },
    ],
  );

export const buildBookingSessionExpiredPayload = (to) =>
  buildButtonPayload(
    to,
    "Your appointment booking session has expired.\n\nWould you like to start booking again?",
    [
      { id: "create_appointment", title: "Start Booking" },
      { id: "view_my_appointments", title: "Manage" },
    ],
  );

export const buildBookingToManageSwitchConfirmPayload = (to) =>
  buildButtonPayload(
    to,
    "You are currently booking an appointment.\n\nDo you want to stop this booking and open Manage Appointment?",
    [
      { id: "appt_switch_confirm_manage", title: "Yes, Manage" },
      { id: "appt_switch_cancel", title: "No, Continue" },
    ],
  );
