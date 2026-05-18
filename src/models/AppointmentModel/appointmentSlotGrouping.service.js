import { decodeSlotTime } from "./appointmentReplyDecoder.js";

const encodeSlotTimeForRowId = (time) =>
  String(time || "")
    .replace(/^(\d):/, "0$1:")
    .replace(/:/g, "-")
    .replace(/\s+/g, "-")
    .toUpperCase();

export const encodeSlotRowId = (time) =>
  `SLOT_${encodeSlotTimeForRowId(time).replace(/-/g, "_")}`;

export const decodeSlotRowId = (id) => {
  const raw = String(id || "").trim();
  if (!raw.startsWith("SLOT_") || raw.startsWith("SLOT_GROUP_")) return null;
  return decodeSlotTime(raw.slice("SLOT_".length).replace(/_/g, "-"));
};

const getSlotGroupCount = (slotCount) => {
  if (slotCount <= 10) return 0;
  if (slotCount <= 20) return 2;
  if (slotCount <= 30) return 3;
  return 4;
};

export const normalizeAppointmentSlots = (slots = []) => {
  const seen = new Set();
  return (slots || [])
    .map((slot) => {
      const time = String(slot?.time || slot || "").trim();
      if (!time) return null;
      const id = encodeSlotRowId(time);
      if (seen.has(id)) return null;
      seen.add(id);
      return { id, time, source: slot };
    })
    .filter(Boolean);
};

export const buildSlotSelectionContext = ({ doctorId, date, slots = [] }) => {
  const availableSlots = normalizeAppointmentSlots(slots);
  const groupCount = getSlotGroupCount(availableSlots.length);
  const groupedSlots = [];

  if (groupCount > 0) {
    const groupSize = Math.ceil(availableSlots.length / groupCount);
    for (let index = 0; index < groupCount; index += 1) {
      const groupSlots = availableSlots.slice(
        index * groupSize,
        (index + 1) * groupSize,
      );
      if (!groupSlots.length) continue;
      const first = groupSlots[0];
      const last = groupSlots[groupSlots.length - 1];
      groupedSlots.push({
        id: `SLOT_GROUP_${groupedSlots.length + 1}`,
        title: `${first.time}-${last.time} Slots`,
        slots: groupSlots,
      });
    }
  }

  return {
    doctorId,
    date,
    availableSlots,
    groupedSlots,
    selectedGroupId: null,
  };
};

export const getSlotSelectionRows = (slotSelection, selectedGroupId = null) => {
  if (!slotSelection) {
    return {
      mode: "slots",
      message: "Please choose an available time slot.",
      sectionTitle: "Available Time Slots",
      rows: [],
    };
  }

  if (selectedGroupId) {
    const group = (slotSelection.groupedSlots || []).find(
      (item) => item.id === selectedGroupId,
    );
    return {
      mode: "slots",
      message: "Please choose an available time slot.",
      sectionTitle: "Available Time Slots",
      rows: (group?.slots || []).map((slot) => ({
        id: slot.id,
        title: slot.time,
        description: "Available",
        time: slot.time,
      })),
    };
  }

  if ((slotSelection.groupedSlots || []).length) {
    return {
      mode: "groups",
      message: "Please choose a time range.",
      sectionTitle: "Available Time Ranges",
      rows: slotSelection.groupedSlots.map((group) => ({
        id: group.id,
        title: group.title,
        description: "View slots",
      })),
    };
  }

  return {
    mode: "slots",
    message: "Please choose an available time slot.",
    sectionTitle: "Available Time Slots",
    rows: (slotSelection.availableSlots || []).map((slot) => ({
      id: slot.id,
      title: slot.time,
      description: "Available",
      time: slot.time,
    })),
  };
};

export const resolveSlotSelection = (replyId, slotSelection) => {
  const id = String(replyId || "").trim();
  if (!id) return null;

  if (id.startsWith("SLOT_GROUP_")) {
    const group = (slotSelection?.groupedSlots || []).find((item) => item.id === id);
    return group ? { type: "group", group } : null;
  }

  const decodedTime =
    id.startsWith("SLOT_") && !id.startsWith("SLOT_GROUP_")
      ? decodeSlotRowId(id)
      : id.startsWith("slot_")
        ? decodeSlotTime(id.slice("slot_".length))
        : /^\d{2}:\d{2}\s[AP]M$/.test(id)
          ? id
          : null;

  if (!decodedTime || !/^\d{2}:\d{2}\s[AP]M$/.test(decodedTime)) return null;

  const allSlots = [
    ...(slotSelection?.availableSlots || []),
    ...((slotSelection?.groupedSlots || []).flatMap((group) => group.slots || [])),
  ];
  const matched = allSlots.find(
    (slot) => slot.id === id || slot.time === decodedTime,
  );

  return {
    type: "slot",
    slot: matched || { id: encodeSlotRowId(decodedTime), time: decodedTime },
  };
};
