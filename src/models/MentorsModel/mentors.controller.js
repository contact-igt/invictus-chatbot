import {
  createMentorService,
  getAllMentorsService,
  getMentorByIdService,
  updateMentorService,
  deleteMentorService,
} from "./mentors.service.js";

const getInitials = (name = "") =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("") || "?";

const serializeMentor = (mentor) => {
  const raw = mentor?.toJSON ? mentor.toJSON() : mentor;

  return {
    id: raw.mentor_id || String(raw.id || ""),
    name: raw.name || "",
    initials: getInitials(raw.name),
    color: raw.color || "#059669",
    expertise: raw.expertise || "Technology",
    rating: Number(raw.rating || 0),
  };
};

// ─── Create Mentor ───
export const createMentorController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { name, expertise, rating, color } = req.body;

  if (!name) {
    return res.status(400).json({ message: "Mentor name is required" });
  }

  try {
    const mentor = await createMentorService(tenant_id, {
      name,
      expertise,
      rating: rating ? parseFloat(rating) : 4.0,
      color,
    });

    return res.status(201).json({
      message: "Mentor created successfully",
      data: serializeMentor(mentor),
    });
  } catch (error) {
    console.error("Error in createMentorController:", error);
    return res.status(500).json({
      message: "Error creating mentor",
      error: error.message,
    });
  }
};

// ─── Get All Mentors ───
export const getAllMentorsController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { expertise, search, limit, offset } = req.query;

  try {
    const mentors = await getAllMentorsService(tenant_id, {
      expertise,
      search,
      limit,
      offset,
    });

    return res.status(200).json({
      message: "Mentors retrieved successfully",
      data: mentors.map(serializeMentor),
    });
  } catch (error) {
    console.error("Error in getAllMentorsController:", error);
    return res.status(500).json({
      message: "Error retrieving mentors",
      error: error.message,
    });
  }
};

// ─── Get Mentor by ID ───
export const getMentorByIdController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { mentor_id } = req.params;

  if (!mentor_id) {
    return res.status(400).json({ message: "Mentor ID is required" });
  }

  try {
    const mentor = await getMentorByIdService(tenant_id, mentor_id);

    return res.status(200).json({
      message: "Mentor retrieved successfully",
      data: serializeMentor(mentor),
    });
  } catch (error) {
    console.error("Error in getMentorByIdController:", error);
    return res.status(404).json({
      message: error.message || "Mentor not found",
      error: error.message,
    });
  }
};

// ─── Update Mentor ───
export const updateMentorController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { mentor_id } = req.params;
  const { name, expertise, rating, color } = req.body;

  if (!mentor_id) {
    return res.status(400).json({ message: "Mentor ID is required" });
  }

  try {
    const mentor = await updateMentorService(tenant_id, mentor_id, {
      name,
      expertise,
      rating: rating !== undefined ? parseFloat(rating) : undefined,
      color,
    });

    return res.status(200).json({
      message: "Mentor updated successfully",
      data: serializeMentor(mentor),
    });
  } catch (error) {
    console.error("Error in updateMentorController:", error);
    return res.status(500).json({
      message: error.message || "Error updating mentor",
      error: error.message,
    });
  }
};

// ─── Delete Mentor ───
export const deleteMentorController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { mentor_id } = req.params;

  if (!mentor_id) {
    return res.status(400).json({ message: "Mentor ID is required" });
  }

  try {
    await deleteMentorService(tenant_id, mentor_id);

    return res.status(200).json({
      message: "Mentor deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteMentorController:", error);
    return res.status(500).json({
      message: error.message || "Error deleting mentor",
      error: error.message,
    });
  }
};
