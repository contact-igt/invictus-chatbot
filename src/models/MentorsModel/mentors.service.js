import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";

const buildMentorRefWhere = (mentorRef) => {
  const orConditions = [{ mentor_id: mentorRef }];
  const numericId = Number(mentorRef);

  if (!Number.isNaN(numericId)) {
    orConditions.push({ id: numericId });
  }

  return { [db.Sequelize.Op.or]: orConditions };
};

// ─── Create Mentor ───
export const createMentorService = async (tenant_id, data) => {
  try {
    const mentor_id = await generateReadableIdFromLast(
      tableNames.MENTORS,
      "mentor_id",
      "MNT",
      5
    );

    const mentor = await db.Mentors.create({
      mentor_id,
      tenant_id,
      name: data.name,
      expertise: data.expertise || "Technology",
      rating: data.rating || 4.0,
      color: data.color || "#059669",
    });

    return mentor;
  } catch (error) {
    console.error("Error creating mentor:", error);
    throw error;
  }
};

// ─── Get All Mentors ───
export const getAllMentorsService = async (tenant_id, filters = {}) => {
  try {
    const where = { tenant_id, is_deleted: false };

    if (filters.expertise) {
      where.expertise = filters.expertise;
    }
    if (filters.search) {
      where.name = {
        [db.Sequelize.Op.like]: `%${filters.search}%`,
      };
    }

    const mentors = await db.Mentors.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: filters.limit ? parseInt(filters.limit) : undefined,
      offset: filters.offset ? parseInt(filters.offset) : undefined,
    });

    return mentors;
  } catch (error) {
    console.error("Error fetching mentors:", error);
    throw error;
  }
};

// ─── Get Mentor by ID ───
export const getMentorByIdService = async (tenant_id, mentor_id) => {
  try {
    const mentor = await db.Mentors.findOne({
      where: { tenant_id, is_deleted: false, ...buildMentorRefWhere(mentor_id) },
    });

    if (!mentor) {
      throw new Error("Mentor not found");
    }

    return mentor;
  } catch (error) {
    console.error("Error fetching mentor:", error);
    throw error;
  }
};

// ─── Update Mentor ───
export const updateMentorService = async (tenant_id, mentor_id, data) => {
  try {
    const mentor = await db.Mentors.findOne({
      where: { tenant_id, is_deleted: false, ...buildMentorRefWhere(mentor_id) },
    });

    if (!mentor) {
      throw new Error("Mentor not found");
    }

    await mentor.update({
      name: data.name !== undefined ? data.name : mentor.name,
      expertise: data.expertise !== undefined ? data.expertise : mentor.expertise,
      rating: data.rating !== undefined ? data.rating : mentor.rating,
      color: data.color !== undefined ? data.color : mentor.color,
    });

    return mentor;
  } catch (error) {
    console.error("Error updating mentor:", error);
    throw error;
  }
};

// ─── Delete Mentor ───
export const deleteMentorService = async (tenant_id, mentor_id) => {
  try {
    const mentor = await db.Mentors.findOne({
      where: { tenant_id, is_deleted: false, ...buildMentorRefWhere(mentor_id) },
    });

    if (!mentor) {
      throw new Error("Mentor not found");
    }

    await mentor.update({
      is_deleted: true,
      deleted_at: new Date(),
    });

    return mentor;
  } catch (error) {
    console.error("Error deleting mentor:", error);
    throw error;
  }
};
