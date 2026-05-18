import {
  buildSlotSelectionContext,
  getSlotSelectionRows,
  normalizeAppointmentSlots,
  resolveSlotSelection,
} from "../src/models/AppointmentModel/appointmentSlotGrouping.service.js";

const makeSlots = (count, startHour = 9) =>
  Array.from({ length: count }, (_, index) => {
    const totalMinutes = startHour * 60 + index * 30;
    const hour24 = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const suffix = hour24 >= 12 ? "PM" : "AM";
    const hour12 = ((hour24 + 11) % 12) + 1;
    return `${String(hour12).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${suffix}`;
  });

describe("appointment slot grouping", () => {
  test("normalizes slots into stable uppercase row ids", () => {
    expect(normalizeAppointmentSlots(["9:00 AM", "09:30 AM"])).toEqual([
      { id: "SLOT_09_00_AM", time: "9:00 AM", source: "9:00 AM" },
      { id: "SLOT_09_30_AM", time: "09:30 AM", source: "09:30 AM" },
    ]);
  });

  test("does not group ten or fewer slots", () => {
    const context = buildSlotSelectionContext({
      doctorId: "DOC001",
      date: "2026-05-19",
      slots: makeSlots(10),
    });
    const rows = getSlotSelectionRows(context);

    expect(context.groupedSlots).toEqual([]);
    expect(rows.mode).toBe("slots");
    expect(rows.sectionTitle).toBe("Available Time Slots");
    expect(rows.rows).toHaveLength(10);
  });

  test("splits eleven to twenty slots into two dynamic range groups", () => {
    const context = buildSlotSelectionContext({
      doctorId: "DOC001",
      date: "2026-05-19",
      slots: makeSlots(11),
    });
    const rows = getSlotSelectionRows(context);

    expect(context.groupedSlots).toHaveLength(2);
    expect(rows.mode).toBe("groups");
    expect(rows.sectionTitle).toBe("Available Time Ranges");
    expect(rows.rows.map((row) => row.title)).toEqual([
      "09:00 AM-11:30 AM Slots",
      "12:00 PM-02:00 PM Slots",
    ]);
  });

  test("splits twelve slots into two dynamic range groups", () => {
    const context = buildSlotSelectionContext({
      doctorId: "DOC001",
      date: "2026-05-19",
      slots: makeSlots(12),
    });
    const rows = getSlotSelectionRows(context);

    expect(context.groupedSlots).toHaveLength(2);
    expect(rows.rows).toEqual([
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
    ]);
  });

  test("splits twenty-one to thirty slots into three groups", () => {
    const context = buildSlotSelectionContext({
      doctorId: "DOC001",
      date: "2026-05-19",
      slots: makeSlots(21),
    });

    expect(context.groupedSlots).toHaveLength(3);
    expect(context.groupedSlots.map((group) => group.id)).toEqual([
      "SLOT_GROUP_1",
      "SLOT_GROUP_2",
      "SLOT_GROUP_3",
    ]);
  });

  test("splits more than thirty slots into four groups", () => {
    const context = buildSlotSelectionContext({
      doctorId: "DOC001",
      date: "2026-05-19",
      slots: makeSlots(31, 6),
    });

    expect(context.groupedSlots).toHaveLength(4);
    expect(context.groupedSlots.map((group) => group.id)).toEqual([
      "SLOT_GROUP_1",
      "SLOT_GROUP_2",
      "SLOT_GROUP_3",
      "SLOT_GROUP_4",
    ]);
  });

  test("selecting a group returns only that group's final slot rows", () => {
    const context = buildSlotSelectionContext({
      doctorId: "DOC001",
      date: "2026-05-19",
      slots: makeSlots(11),
    });
    const selected = resolveSlotSelection("SLOT_GROUP_1", context);
    const rows = getSlotSelectionRows(context, selected.group.id);

    expect(selected.type).toBe("group");
    expect(rows.mode).toBe("slots");
    expect(rows.rows.map((row) => row.title)).toEqual([
      "09:00 AM",
      "09:30 AM",
      "10:00 AM",
      "10:30 AM",
      "11:00 AM",
      "11:30 AM",
    ]);
  });

  test("selecting a final slot maps back to the saved slot", () => {
    const context = buildSlotSelectionContext({
      doctorId: "DOC001",
      date: "2026-05-19",
      slots: makeSlots(11),
    });

    expect(resolveSlotSelection("SLOT_10_00_AM", context)).toEqual({
      type: "slot",
      slot: {
        id: "SLOT_10_00_AM",
        time: "10:00 AM",
        source: "10:00 AM",
      },
    });
    expect(resolveSlotSelection("slot_10-30-AM", context).slot.time).toBe(
      "10:30 AM",
    );
  });
});
