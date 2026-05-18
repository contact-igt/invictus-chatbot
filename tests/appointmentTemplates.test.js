import {
  buildDateListPayload,
  buildDoctorListPayload,
  buildEditMenuPayload,
  buildReasonServiceListPayload,
  buildSuccessPayload,
  buildTimeSlotPayload,
} from "../src/models/AppointmentModel/whatsappAppointmentTemplates.service.js";

const payloadText = (payload) => JSON.stringify(payload);

describe("appointment WhatsApp templates", () => {
  test("main appointment lists do not include edit rows", () => {
    const doctorPayload = buildDoctorListPayload("919999999999", [
      {
        doctor_id: "DOC001",
        name: "Sharma",
        specializations: [{ name: "Cataract" }],
      },
    ]);
    const datePayload = buildDateListPayload("919999999999", [
      { value: "2026-05-19", label: "Tue, 19 May" },
    ]);
    const timePayload = buildTimeSlotPayload("919999999999", [
      { time: "09:00 AM" },
    ]);
    const reasonPayload = buildReasonServiceListPayload("919999999999", [
      { specialization_id: "SPEC001", name: "Cataract" },
    ]);

    for (const payload of [doctorPayload, datePayload, timePayload, reasonPayload]) {
      expect(payloadText(payload)).not.toContain("edit_details");
      expect(payloadText(payload)).not.toContain("Edit Details");
    }
  });

  test("service list keeps all 10 rows for services", () => {
    const payload = buildReasonServiceListPayload(
      "919999999999",
      Array.from({ length: 12 }, (_, index) => ({
        specialization_id: `SPEC${index + 1}`,
        name: `Service ${index + 1}`,
      })),
    );

    expect(payload.interactive.action.sections).toEqual([
      {
        title: "Services",
        rows: Array.from({ length: 10 }, (_, index) => ({
          id: `reason_SPEC${index + 1}`,
          title: `Service ${index + 1}`,
          description: "Reason for visit",
        })),
      },
    ]);
    expect(payloadText(payload)).not.toContain("Edit previous details");
  });

  test("time slot payload can render grouped slot ranges", () => {
    const payload = buildTimeSlotPayload(
      "919999999999",
      [
        {
          id: "SLOT_GROUP_1",
          title: "09:00 AM-11:30 AM Slots",
          description: "View slots",
        },
        {
          id: "SLOT_GROUP_2",
          title: "12:00 PM-02:30 PM Slots",
          description: "View slots",
        },
      ],
      {
        bodyText: "Please choose a time range.",
        sectionTitle: "Available Time Ranges",
      },
    );

    expect(payload.interactive.body.text).toBe("Please choose a time range.");
    expect(payload.interactive.action.sections).toEqual([
      {
        title: "Available Time Ranges",
        rows: [
          {
            id: "SLOT_GROUP_1",
            title: "09:00 AM-11:30 AM Slots",
            description: "View slots",
          },
          {
            id: "SLOT_GROUP_2",
            title: "12:00 PM-02:30 PM Slots",
            description: "View slots",
          },
        ],
      },
    ]);
  });

  test("standalone contextual edit menu uses edit button and provided fields", () => {
    const payload = buildEditMenuPayload("919999999999", [
      { id: "edit_name", title: "Name", description: "Jashu" },
      {
        id: "continue_appointment",
        title: "Continue Appointment",
        description: "Continue appointment",
      },
    ]);

    expect(payload.interactive.body.text).toBe(
      "Need to change any details? Click Edit to select what to edit.",
    );
    expect(payload.interactive.action.button).toBe("Edit");
    expect(payload.interactive.action.sections[0].rows).toEqual([
      { id: "edit_name", title: "Name", description: "Jashu" },
      {
        id: "continue_appointment",
        title: "Continue Appointment",
        description: "Continue appointment",
      },
    ]);
  });

  test("success payload confirms request is pending review", () => {
    const payload = buildSuccessPayload("919999999999", {
      appointment_id: "AP123",
      token_number: 7,
      appointment_date: "2026-05-19",
      appointment_time: "09:00 AM",
    });

    expect(payload.text.body).toContain("Your appointment request has been submitted successfully.");
    expect(payload.text.body).toContain(
      "You will receive a confirmation email once it is approved.",
    );
    expect(payload.text.body).toContain("Appointment ID: AP123");
    expect(payload.text.body).toContain("Token: #7");
  });
});
