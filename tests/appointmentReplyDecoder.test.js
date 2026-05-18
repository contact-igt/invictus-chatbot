import {
  APPOINTMENT_REPLY_TYPES,
  decodeAppointmentReply,
  decodeSlotTime,
  encodeSlotTime,
} from "../src/models/AppointmentModel/appointmentReplyDecoder.js";

describe("appointmentReplyDecoder", () => {
  test("decodes dynamic doctor, date, slot, and reason replies", () => {
    expect(decodeAppointmentReply("doctor_DOC001")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.DOCTOR_SELECTED,
      value: "DOC001",
    });
    expect(decodeAppointmentReply("date_2026-05-19")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.DATE_SELECTED,
      value: "2026-05-19",
    });
    expect(decodeAppointmentReply("slot_09-00-AM")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.TIME_SELECTED,
      value: "09:00 AM",
    });
    expect(decodeAppointmentReply("SLOT_GROUP_1")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.SLOT_GROUP_SELECTED,
      value: "SLOT_GROUP_1",
    });
    expect(decodeAppointmentReply("SLOT_10_00_AM")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.TIME_SELECTED,
      value: "10:00 AM",
    });
    expect(decodeAppointmentReply("reason_SPEC001")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.REASON_SELECTED,
      value: "SPEC001",
    });
  });

  test("decodes static appointment actions", () => {
    expect(decodeAppointmentReply("confirm_booking")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.CONFIRM_BOOKING,
    });
    expect(decodeAppointmentReply("edit_details")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.EDIT_DETAILS,
    });
    expect(decodeAppointmentReply("cancel_appointment")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.CANCEL_BOOKING,
    });
    expect(decodeAppointmentReply("continue_appointment")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.CONTINUE_APPOINTMENT,
    });
    expect(decodeAppointmentReply("back_confirm")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.BACK_TO_CONFIRM,
    });
  });

  test("normalizes slot times and rejects unknown replies", () => {
    expect(encodeSlotTime("9:00 am")).toBe("09-00-AM");
    expect(decodeSlotTime("9-30-PM")).toBe("09:30 PM");
    expect(decodeAppointmentReply("slot_bad")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.UNKNOWN,
    });
    expect(decodeAppointmentReply("unknown_action")).toEqual({
      type: APPOINTMENT_REPLY_TYPES.UNKNOWN,
    });
  });
});
