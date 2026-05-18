import {
  APPOINTMENT_STATES,
  getEditableFieldsByState,
  getEditResetForTarget,
  getNextIncompleteAppointmentState,
  isEditKeyword,
} from "../src/models/AppointmentModel/Advanced_Appointment_Booking.service.js";

const ids = (fields) => fields.map((field) => field.id);

describe("advanced appointment helpers", () => {
  const completeDraft = {
    name: "Jashu",
    email: "jashu@gmail.com",
    reason: "Cataract",
    reasonSource: "SERVICE_MENU",
    reasonServiceId: "SPEC001",
    selectedSpecializationId: "SPEC001",
    selectedSpecializationName: "Cataract",
    doctorListMode: "FILTERED_BY_SPECIALIZATION",
    doctorId: "DOC001",
    doctorName: "Sharma",
    date: "2026-05-19",
    time: "09:00 AM",
  };

  test("shows contextual edit fields by current state", () => {
    expect(ids(getEditableFieldsByState({
      currentState: APPOINTMENT_STATES.COLLECT_NAME,
      draft: completeDraft,
    }))).toEqual(["continue_appointment"]);

    expect(ids(getEditableFieldsByState({
      currentState: APPOINTMENT_STATES.COLLECT_EMAIL,
      draft: completeDraft,
    }))).toEqual(["continue_appointment"]);

    expect(ids(getEditableFieldsByState({
      currentState: APPOINTMENT_STATES.COLLECT_REASON,
      draft: completeDraft,
    }))).toEqual(["edit_name", "edit_email", "continue_appointment"]);

    expect(ids(getEditableFieldsByState({
      currentState: APPOINTMENT_STATES.SELECT_DOCTOR,
      draft: completeDraft,
    }))).toEqual([
      "edit_name",
      "edit_email",
      "edit_reason",
      "continue_appointment",
    ]);

    expect(ids(getEditableFieldsByState({
      currentState: APPOINTMENT_STATES.SELECT_TIME,
      draft: completeDraft,
    }))).toEqual([
      "edit_name",
      "edit_email",
      "edit_reason",
      "edit_doctor",
      "edit_date",
      "continue_appointment",
    ]);

    expect(ids(getEditableFieldsByState({
      currentState: APPOINTMENT_STATES.CONFIRM_BOOKING,
      draft: completeDraft,
    }))).toEqual([
      "edit_name",
      "edit_email",
      "edit_reason",
      "edit_doctor",
      "edit_date",
      "edit_time",
      "continue_appointment",
    ]);
  });

  test("does not show uncollected future fields", () => {
    const draft = {
      name: "Jashu",
      email: "jashu@gmail.com",
      reason: "Eye pain",
    };

    expect(ids(getEditableFieldsByState({
      currentState: APPOINTMENT_STATES.SELECT_DATE,
      draft,
    }))).toEqual([
      "edit_name",
      "edit_email",
      "edit_reason",
      "continue_appointment",
    ]);
  });

  test("clears only dependent fields for edit selections", () => {
    expect(getEditResetForTarget("edit_name", completeDraft).draft).toMatchObject({
      name: null,
      email: completeDraft.email,
      reason: completeDraft.reason,
      doctorId: completeDraft.doctorId,
      date: completeDraft.date,
      time: completeDraft.time,
    });

    expect(getEditResetForTarget("edit_reason", completeDraft).draft).toMatchObject({
      reason: null,
      reasonSource: null,
      reasonServiceId: null,
      selectedSpecializationId: null,
      selectedSpecializationName: null,
      doctorListMode: null,
      doctorId: null,
      doctorName: null,
      date: null,
      time: null,
    });

    expect(getEditResetForTarget("edit_doctor", completeDraft).draft).toMatchObject({
      reason: completeDraft.reason,
      doctorId: null,
      doctorName: null,
      date: null,
      time: null,
    });

    expect(getEditResetForTarget("edit_date", completeDraft).draft).toMatchObject({
      doctorId: completeDraft.doctorId,
      date: null,
      time: null,
    });
  });

  test("routes to the next incomplete appointment state", () => {
    expect(getNextIncompleteAppointmentState({})).toBe(APPOINTMENT_STATES.COLLECT_NAME);
    expect(getNextIncompleteAppointmentState({ name: "Jashu" })).toBe(
      APPOINTMENT_STATES.COLLECT_EMAIL,
    );
    expect(getNextIncompleteAppointmentState({
      name: "Jashu",
      email: "jashu@gmail.com",
      reason: "Eye pain",
    })).toBe(APPOINTMENT_STATES.SELECT_DOCTOR);
    expect(getNextIncompleteAppointmentState(completeDraft)).toBe(
      APPOINTMENT_STATES.CONFIRM_BOOKING,
    );
  });

  test("detects explicit typed edit requests", () => {
    expect(isEditKeyword("edit")).toBe(true);
    expect(isEditKeyword("edit email")).toBe(true);
    expect(isEditKeyword("edit gmail")).toBe(true);
    expect(isEditKeyword("change doctor")).toBe(true);
    expect(isEditKeyword("modify email")).toBe(true);
    expect(isEditKeyword("I need appointment")).toBe(false);
  });
});
