import {
  createCourseService,
  getAllCoursesService,
  getCourseByIdService,
  updateCourseService,
  deleteCourseService,
} from "./courses.service.js";

const serializeCourse = (course) => {
  const raw = course?.toJSON ? course.toJSON() : course;

  return {
    id: raw.course_id || String(raw.id || ""),
    title: raw.title || "",
    category: raw.category || "Technology",
    level: raw.level || "Beginner",
    mentorId: raw.mentor_id || "",
    lessons: Number(raw.lessons || 0),
    duration: raw.duration || "",
    price: Number(raw.price || 0),
    description: raw.description || "",
    registrationLink: raw.registration_link || null,
    meetingLink: raw.meeting_link || null,
    status: raw.status || "Draft",
    enrolled: Number(raw.enrolled || 0),
    completion: Number(raw.completion || 0),
    createdAt: raw.created_at || raw.createdAt || null,
  };
};

// ─── Create Course ───
export const createCourseController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { title, category, level, mentorId, lessons, duration, price, description, status, registrationLink, meetingLink } = req.body;

  if (!title) {
    return res.status(400).json({ message: "Course title is required" });
  }

  try {
    const course = await createCourseService(tenant_id, {
      title,
      category,
      level,
      mentorId,
      lessons: parseInt(lessons) || 0,
      duration,
      price: parseFloat(price) || 0,
      description,
      registrationLink,
      meetingLink,
      status,
    });

    return res.status(201).json({
      message: "Course created successfully",
      data: serializeCourse(course),
    });
  } catch (error) {
    console.error("Error in createCourseController:", error);
    return res.status(500).json({
      message: "Error creating course",
      error: error.message,
    });
  }
};

// ─── Get All Courses ───
export const getAllCoursesController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { status, category, level, search, limit, offset } = req.query;

  try {
    const courses = await getAllCoursesService(tenant_id, {
      status,
      category,
      level,
      search,
      limit,
      offset,
    });

    return res.status(200).json({
      message: "Courses retrieved successfully",
      data: courses.map(serializeCourse),
    });
  } catch (error) {
    console.error("Error in getAllCoursesController:", error);
    return res.status(500).json({
      message: "Error retrieving courses",
      error: error.message,
    });
  }
};

// ─── Get Course by ID ───
export const getCourseByIdController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { course_id } = req.params;

  if (!course_id) {
    return res.status(400).json({ message: "Course ID is required" });
  }

  try {
    const course = await getCourseByIdService(tenant_id, course_id);

    return res.status(200).json({
      message: "Course retrieved successfully",
      data: serializeCourse(course),
    });
  } catch (error) {
    console.error("Error in getCourseByIdController:", error);
    return res.status(404).json({
      message: error.message || "Course not found",
      error: error.message,
    });
  }
};

// ─── Update Course ───
export const updateCourseController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { course_id } = req.params;
  const { title, category, level, mentorId, lessons, duration, price, description, status, registrationLink, meetingLink } = req.body;

  if (!course_id) {
    return res.status(400).json({ message: "Course ID is required" });
  }

  try {
    const course = await updateCourseService(tenant_id, course_id, {
      title,
      category,
      level,
      mentorId,
      lessons: lessons !== undefined ? parseInt(lessons) : undefined,
      duration,
      price: price !== undefined ? parseFloat(price) : undefined,
      description,
      registrationLink,
      meetingLink,
      status,
    });

    return res.status(200).json({
      message: "Course updated successfully",
      data: serializeCourse(course),
    });
  } catch (error) {
    console.error("Error in updateCourseController:", error);
    return res.status(500).json({
      message: error.message || "Error updating course",
      error: error.message,
    });
  }
};

// ─── Delete Course ───
export const deleteCourseController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { course_id } = req.params;

  if (!course_id) {
    return res.status(400).json({ message: "Course ID is required" });
  }

  try {
    await deleteCourseService(tenant_id, course_id);

    return res.status(200).json({
      message: "Course deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteCourseController:", error);
    return res.status(500).json({
      message: error.message || "Error deleting course",
      error: error.message,
    });
  }
};
