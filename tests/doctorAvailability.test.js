import {
  normalizeAvailabilityForPersistence,
  slotDurationFromRange,
} from "../src/models/DoctorModel/doctorAvailability.service.js";

describe("doctor availability day-level duration", () => {
  test("normalizes enabled day settings and sorts concrete slots", () => {
    const days = normalizeAvailabilityForPersistence([
      {
        day: "monday",
        enabled: true,
        slotDuration: 30,
        slots: [
          { start_time: "10:00", end_time: "10:30" },
          { start_time: "09:00", end_time: "09:30" },
        ],
      },
    ]);

    expect(days).toEqual([
      {
        day: "monday",
        enabled: true,
        slotDuration: 30,
        slots: [
          { start_time: "09:00", end_time: "09:30" },
          { start_time: "10:00", end_time: "10:30" },
        ],
      },
    ]);
  });

  test("rejects invalid duration, overlaps, empty enabled day, and end past day", () => {
    expect(() =>
      normalizeAvailabilityForPersistence([
        { day: "monday", enabled: true, slotDuration: 4, slots: [{ start_time: "09:00", end_time: "09:15" }] },
      ]),
    ).toThrow("between 5 and 480");

    expect(() =>
      normalizeAvailabilityForPersistence([
        { day: "monday", enabled: true, slotDuration: 15, slots: [] },
      ]),
    ).toThrow("At least one slot");

    expect(() =>
      normalizeAvailabilityForPersistence([
        {
          day: "monday",
          enabled: true,
          slotDuration: 15,
          slots: [
            { start_time: "09:00", end_time: "09:30" },
            { start_time: "09:15", end_time: "09:45" },
          ],
        },
      ]),
    ).toThrow("overlap");

    expect(() =>
      normalizeAvailabilityForPersistence([
        { day: "monday", enabled: true, slotDuration: 15, slots: [{ start_time: "23:50", end_time: "24:05" }] },
      ]),
    ).toThrow("cannot exceed 23:59");
  });

  test("derives slot duration from stored start and end times", () => {
    expect(slotDurationFromRange("09:00", "09:45")).toBe(45);
    expect(slotDurationFromRange("bad", "09:45", 15)).toBe(15);
  });
});
