import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";

const buildCourseRefWhere = (courseRef) => {
  const orConditions = [{ course_id: courseRef }];
  const numericId = Number(courseRef);

  if (!Number.isNaN(numericId)) {
    orConditions.push({ id: numericId });
  }

  return { [db.Sequelize.Op.or]: orConditions };
};

// ─── Create Course ───
export const createCourseService = async (tenant_id, data) => {
  try {
    const course_id = await generateReadableIdFromLast(
      tableNames.COURSES,
      "course_id",
      "CRS",
      5
    );

    const course = await db.Courses.create({
      course_id,
      tenant_id,
      title: data.title,
      category: data.category || "Technology",
      level: data.level || "Beginner",
      mentor_id: data.mentorId || null,
      lessons: data.lessons || 0,
      duration: data.duration || "0h",
      price: data.price || 0,
      description: data.description || null,
      registration_link: data.registrationLink || null,
      meeting_link: data.meetingLink || null,
      status: data.status || "Draft",
      enrolled: data.enrolled || 0,
      completion: data.completion || 0,
    });

    return course;
  } catch (error) {
    console.error("Error creating course:", error);
    throw error;
  }
};

// ─── Get All Courses ───
export const getAllCoursesService = async (tenant_id, filters = {}) => {
  try {
    const where = { tenant_id, is_deleted: false };

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.category) {
      where.category = filters.category;
    }
    if (filters.level) {
      where.level = filters.level;
    }
    if (filters.search) {
      where.title = {
        [db.Sequelize.Op.like]: `%${filters.search}%`,
      };
    }

    const courses = await db.Courses.findAll({
      where,
      include: [
        {
          model: db.Mentors,
          as: "Mentor",
          where: { is_deleted: false },
          required: false,
        },
      ],
      order: [["created_at", "DESC"]],
      limit: filters.limit ? parseInt(filters.limit) : undefined,
      offset: filters.offset ? parseInt(filters.offset) : undefined,
    });

    return courses;
  } catch (error) {
    console.error("Error fetching courses:", error);
    throw error;
  }
};

// ─── Get Course by ID ───
export const getCourseByIdService = async (tenant_id, course_id) => {
  try {
    const course = await db.Courses.findOne({
      where: { tenant_id, is_deleted: false, ...buildCourseRefWhere(course_id) },
      include: [
        {
          model: db.Mentors,
          as: "Mentor",
          where: { is_deleted: false },
          required: false,
        },
      ],
    });

    if (!course) {
      throw new Error("Course not found");
    }

    return course;
  } catch (error) {
    console.error("Error fetching course:", error);
    throw error;
  }
};

// ─── Update Course ───
export const updateCourseService = async (tenant_id, course_id, data) => {
  try {
    const course = await db.Courses.findOne({
      where: { tenant_id, is_deleted: false, ...buildCourseRefWhere(course_id) },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    await course.update({
      title: data.title !== undefined ? data.title : course.title,
      category: data.category !== undefined ? data.category : course.category,
      level: data.level !== undefined ? data.level : course.level,
      mentor_id: data.mentorId !== undefined ? data.mentorId : course.mentor_id,
      lessons: data.lessons !== undefined ? data.lessons : course.lessons,
      duration: data.duration !== undefined ? data.duration : course.duration,
      price: data.price !== undefined ? data.price : course.price,
      description: data.description !== undefined ? data.description : course.description,
      registration_link: data.registrationLink !== undefined ? data.registrationLink : course.registration_link,
      meeting_link: data.meetingLink !== undefined ? data.meetingLink : course.meeting_link,
      status: data.status !== undefined ? data.status : course.status,
      enrolled: data.enrolled !== undefined ? data.enrolled : course.enrolled,
      completion: data.completion !== undefined ? data.completion : course.completion,
    });

    return course;
  } catch (error) {
    console.error("Error updating course:", error);
    throw error;
  }
};

// ─── Delete Course ───
export const deleteCourseService = async (tenant_id, course_id) => {
  try {
    const course = await db.Courses.findOne({
      where: { tenant_id, is_deleted: false, ...buildCourseRefWhere(course_id) },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    await course.update({
      is_deleted: true,
      deleted_at: new Date(),
    });

    return course;
  } catch (error) {
    console.error("Error deleting course:", error);
    throw error;
  }
};
