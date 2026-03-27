import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import { generatePassword } from "../../utils/helpers/generatePassword.js";

import bcrypt from "bcrypt";
import { getTemplate } from "../../utils/email/templateLoader.js";
import {
  createTenantUserService,
  findTenantUserByEmailGloballyService,
  findTenantUserByEmailOrMobileGloballyService,
  softDeleteTenantUserService,
  restoreTenantUserService,
} from "../TenantUserModel/tenantuser.service.js";

// ─── Create Doctor ───
export const createDoctorService = async (tenant_id, data) => {
  const transaction = await db.sequelize.transaction();

  try {
    // Check if email or mobile already exists
    const existingUser = await findTenantUserByEmailOrMobileGloballyService(
      data.email,
      data.mobile,
    );

    if (existingUser) {
      if (existingUser.email === data.email) {
        throw new Error("User with this email already exists in the system.");
      }
      if (existingUser.mobile === data.mobile) {
        throw new Error(
          "User with this mobile number already exists in the system.",
        );
      }
    }

    // Generate new TenantUser ID
    const tenant_user_id = await generateReadableIdFromLast(
      tableNames.TENANT_USERS,
      "tenant_user_id",
      "TTU",
    );

    // Auto-generate password
    const { password, hashedPassword } = await generatePassword();
    // const password_hash = hashedPassword;

    // Create new TenantUser
    await createTenantUserService(
      tenant_user_id,
      tenant_id,
      data.title || null,
      data.name,
      data.email,
      data.country_code || null,
      data.mobile,
      data.profile_pic || null,
      "doctor", // role
      hashedPassword,
      "active",
      transaction,
    );

    // Email sending moved after commit

    const doctor_id = await generateReadableIdFromLast(
      tableNames.DOCTORS,
      "doctor_id",
      "DOC",
      5,
    );

    // Create the doctor profile
    await db.Doctors.create(
      {
        doctor_id,
        tenant_id,
        tenant_user_id,
        title: data.title || null,
        name: data.name,
        country_code: data.country_code,
        mobile: data.mobile,
        email: data.email,
        status: data.status || "available",
        consultation_duration: data.consultation_duration || 30,
        bio: data.bio || null,
        profile_pic: data.profile_pic || null,
        experience_years: data.experience_years || 0,
        qualification: data.qualification || null,
      },
      { transaction },
    );

    // 3. Handle specializations (validate they exist)
    if (data.specializations && data.specializations.length > 0) {
      for (const specName of data.specializations) {
        // Find specialization - check both name and specialization_id
        const spec = await db.Specializations.findOne({
          where: {
            tenant_id,
            [db.Sequelize.Op.or]: [
              { name: specName.trim() },
              { specialization_id: specName.trim() },
            ],
            is_deleted: false,
          },
        });

        if (!spec) {
          throw new Error(
            `Specialization "${specName}" not found. Please create it first in the specializations master list.`,
          );
        }

        await db.DoctorSpecializations.create(
          {
            doctor_id,
            specialization_id: spec.specialization_id,
          },
          { transaction },
        );
      }
    }

    // 4. Handle availability slots
    if (data.availability && data.availability.length > 0) {
      for (const slot of data.availability) {
        const slots = slot.slots || [
          { start_time: slot.start_time, end_time: slot.end_time },
        ];
        const day_of_week = (slot.day_of_week || slot.day || "").toLowerCase();

        for (const timeSlot of slots) {
          await db.DoctorAvailability.create(
            {
              doctor_id,
              tenant_id,
              day_of_week,
              start_time: timeSlot.start_time,
              end_time: timeSlot.end_time,
            },
            { transaction },
          );
        }
      }
    }

    await transaction.commit();

    // Send welcome email with login credentials (AFTER commit)
    try {
      const template = getTemplate("tenantUserWelcome");

      const tenantData = await db.Tenants.findOne({
        where: { tenant_id },
        attributes: ["company_name"],
      });

      const emailHtml = template({
        name: data.name,
        role: "Doctor",
        company_name: tenantData?.company_name || "Your Organization",
        email: data.email,
        password: password,
        login_url: process.env.FRONTEND_URL,
      });

      await sendEmail({
        to: data.email,
        subject: `Welcome to ${tenantData?.company_name || "WhatsNexus"} - Your Doctor Account`,
        html: emailHtml,
      });
    } catch (emailError) {
      console.error("Failed to send welcome email:", emailError);
      // Non-critical error, do not rollback transaction
    }

    return { doctor_id, tenant_user_id };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

// ─── Find Doctor By Name (for AI Tag Handlers) ───
export const findDoctorByNameService = async (tenant_id, name) => {
  try {
    const [[doctor]] = await db.sequelize.query(
      `SELECT doctor_id, name, title FROM ${tableNames.DOCTORS}
       WHERE tenant_id = ? AND name LIKE ? AND is_deleted = false
       LIMIT 1`,
      { replacements: [tenant_id, `%${name.trim()}%`] },
    );
    return doctor || null;
  } catch (error) {
    throw error;
  }
};

// ─── Get Doctor List ───
export const getDoctorListService = async (tenant_id, search) => {
  try {
    let whereClause = `WHERE d.tenant_id = ? AND d.is_deleted = false`;
    const replacements = [tenant_id];

    if (search && search.trim()) {
      whereClause += ` AND (d.name LIKE ? OR d.email LIKE ?)`;
      replacements.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    const [doctors] = await db.sequelize.query(
      `SELECT d.doctor_id, d.title, d.name, d.country_code, d.mobile, d.email, d.status,
            d.consultation_duration, d.appointment_count, d.created_at,
            d.bio, d.profile_pic, d.experience_years, d.qualification
     FROM ${tableNames.DOCTORS} d
     ${whereClause}
     ORDER BY d.created_at DESC`,
      { replacements },
    );

    // Fetch specializations and availability for each doctor
    for (const doctor of doctors) {
      const [specs] = await db.sequelize.query(
        `SELECT s.specialization_id, s.name
       FROM ${tableNames.SPECIALIZATIONS} s
       JOIN ${tableNames.DOCTOR_SPECIALIZATIONS} ds ON s.specialization_id = ds.specialization_id
       WHERE ds.doctor_id = ?`,
        { replacements: [doctor.doctor_id] },
      );

      const [availability] = await db.sequelize.query(
        `SELECT day_of_week, start_time, end_time
       FROM ${tableNames.DOCTOR_AVAILABILITY}
       WHERE doctor_id = ?
       ORDER BY FIELD(day_of_week, 'monday','tuesday','wednesday','thursday','friday','saturday','sunday'), start_time`,
        { replacements: [doctor.doctor_id] },
      );

      doctor.specializations = specs;
      doctor.availability = availability;
    }

    return doctors;
  } catch (error) {
    throw error;
  }
};

// ─── Get Doctor By ID ───
export const getDoctorByIdService = async (doctor_id, tenant_id) => {
  try {
    const [[doctor]] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.DOCTORS}
     WHERE doctor_id = ? AND tenant_id = ? AND is_deleted = false`,
      { replacements: [doctor_id, tenant_id] },
    );

    if (!doctor) return null;

    const [specs] = await db.sequelize.query(
      `SELECT s.specialization_id, s.name
     FROM ${tableNames.SPECIALIZATIONS} s
     JOIN ${tableNames.DOCTOR_SPECIALIZATIONS} ds ON s.specialization_id = ds.specialization_id
     WHERE ds.doctor_id = ?`,
      { replacements: [doctor_id] },
    );

    const [availability] = await db.sequelize.query(
      `SELECT id, day_of_week, start_time, end_time
     FROM ${tableNames.DOCTOR_AVAILABILITY}
     WHERE doctor_id = ?
     ORDER BY FIELD(day_of_week, 'monday','tuesday','wednesday','thursday','friday','saturday','sunday'), start_time`,
      { replacements: [doctor_id] },
    );

    doctor.specializations = specs;
    doctor.availability = availability;

    return doctor;
  } catch (error) {
    throw error;
  }
};

// ─── Update Doctor ───
export const updateDoctorService = async (doctor_id, tenant_id, data) => {
  const transaction = await db.sequelize.transaction();

  try {
    // 1. Check doctor exists
    const [[doctor]] = await db.sequelize.query(
      `SELECT doctor_id FROM ${tableNames.DOCTORS}
       WHERE doctor_id = ? AND tenant_id = ? AND is_deleted = false`,
      { replacements: [doctor_id, tenant_id] },
    );

    if (!doctor) {
      throw new Error("Doctor not found");
    }

    // 2. Update basic fields
    const updateFields = {};
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.country_code !== undefined)
      updateFields.country_code = data.country_code;
    if (data.mobile !== undefined) updateFields.mobile = data.mobile;
    if (data.email !== undefined) updateFields.email = data.email;
    if (data.status !== undefined) updateFields.status = data.status;
    if (data.consultation_duration !== undefined)
      updateFields.consultation_duration = data.consultation_duration;
    if (data.title !== undefined) updateFields.title = data.title;
    if (data.bio !== undefined) updateFields.bio = data.bio;
    if (data.profile_pic !== undefined)
      updateFields.profile_pic = data.profile_pic;
    if (data.experience_years !== undefined)
      updateFields.experience_years = data.experience_years;
    if (data.qualification !== undefined)
      updateFields.qualification = data.qualification;

    if (Object.keys(updateFields).length > 0) {
      await db.Doctors.update(updateFields, {
        where: { doctor_id, tenant_id },
        transaction,
      });
    }

    // 3. Replace specializations if provided
    if (data.specializations !== undefined) {
      // Remove all existing
      await db.DoctorSpecializations.destroy({
        where: { doctor_id },
        transaction,
      });

      // Add new ones (validate they exist)
      for (const specName of data.specializations) {
        // Find specialization - check both name and specialization_id
        const spec = await db.Specializations.findOne({
          where: {
            tenant_id,
            [db.Sequelize.Op.or]: [
              { name: specName.trim() },
              { specialization_id: specName.trim() },
            ],
            is_deleted: false,
          },
        });

        if (!spec) {
          throw new Error(
            `Specialization "${specName}" not found. Please create it first in the specializations master list.`,
          );
        }

        await db.DoctorSpecializations.create(
          {
            doctor_id,
            specialization_id: spec.specialization_id,
          },
          { transaction },
        );
      }
    }

    // 4. Replace availability if provided
    if (data.availability !== undefined) {
      // Remove all existing
      await db.DoctorAvailability.destroy({
        where: { doctor_id },
        transaction,
      });

      // Add new slots
      for (const slot of data.availability) {
        const slots = slot.slots || [
          { start_time: slot.start_time, end_time: slot.end_time },
        ];
        const day_of_week = (slot.day_of_week || slot.day || "").toLowerCase();

        for (const timeSlot of slots) {
          await db.DoctorAvailability.create(
            {
              doctor_id,
              tenant_id,
              day_of_week,
              start_time: timeSlot.start_time,
              end_time: timeSlot.end_time,
            },
            { transaction },
          );
        }
      }
    }

    await transaction.commit();
    return { message: "Doctor updated successfully" };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

// ─── Soft Delete ───
// ─── Soft Delete ───
export const softDeleteDoctorService = async (doctor_id, tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    // 1. Find the doctor to get tenant_user_id
    const doctor = await db.Doctors.findOne({
      where: { doctor_id, tenant_id, is_deleted: false },
      attributes: ["tenant_user_id"],
      transaction,
    });

    if (!doctor) {
      throw new Error("Doctor not found");
    }

    // 2. Soft delete the doctor
    await db.Doctors.update(
      { is_deleted: true, deleted_at: new Date() },
      {
        where: { doctor_id, tenant_id },
        transaction,
      },
    );

    // 3. Soft delete the associated tenant user
    // 3. Soft delete the associated tenant user
    if (doctor.tenant_user_id) {
      await softDeleteTenantUserService(doctor.tenant_user_id, transaction);
    }

    await transaction.commit();
    return {
      message: "Doctor and associated user account deleted successfully",
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

// ─── Permanent Delete ───
export const permanentDeleteDoctorService = async (doctor_id, tenant_id) => {
  try {
    const { cascadeDeleteDoctor } =
      await import("../../database/cascadeDelete.js");
    return await cascadeDeleteDoctor(doctor_id, tenant_id);
  } catch (error) {
    throw error;
  }
};

// ─── Restore ───
// ─── Restore ───
export const restoreDoctorService = async (doctor_id, tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    // 1. Find the doctor (even if deleted)
    const doctor = await db.Doctors.findOne({
      where: { doctor_id, tenant_id, is_deleted: true },
      attributes: ["tenant_user_id"],
      transaction,
    });

    if (!doctor) {
      throw new Error("Doctor not found or not deleted");
    }

    // 2. Restore the doctor
    await db.Doctors.update(
      { is_deleted: false, deleted_at: null },
      {
        where: { doctor_id, tenant_id },
        transaction,
      },
    );

    // 3. Restore the associated tenant user
    if (doctor.tenant_user_id) {
      await restoreTenantUserService(doctor.tenant_user_id, transaction);
    }

    await transaction.commit();
    return {
      message: "Doctor and associated user account restored successfully",
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

// ─── Get Deleted List ───
export const getDeletedDoctorListService = async (tenant_id) => {
  try {
    const [rows] = await db.sequelize.query(
      `SELECT doctor_id, name, mobile, email, status, deleted_at
     FROM ${tableNames.DOCTORS}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC`,
      { replacements: [tenant_id] },
    );

    return rows;
  } catch (error) {
    throw error;
  }
};

// ─── Get Doctors For AI (compact format for system prompt) ───
export const getDoctorsForAIService = async (tenant_id) => {
  try {
    const [doctors] = await db.sequelize.query(
      `SELECT d.doctor_id, d.title, d.name, d.status, d.consultation_duration, d.experience_years, d.qualification
       FROM ${tableNames.DOCTORS} d
       WHERE d.tenant_id = ? AND d.is_deleted = false AND d.status IN ('available', 'busy', 'off duty')
       ORDER BY d.name ASC`,
      { replacements: [tenant_id] },
    );

    if (!doctors || doctors.length === 0) return null;

    const result = [];

    for (const doc of doctors) {
      const [specs] = await db.sequelize.query(
        `SELECT s.name FROM ${tableNames.SPECIALIZATIONS} s
         JOIN ${tableNames.DOCTOR_SPECIALIZATIONS} ds ON s.specialization_id = ds.specialization_id
         WHERE ds.doctor_id = ?`,
        { replacements: [doc.doctor_id] },
      );

      const [availability] = await db.sequelize.query(
        `SELECT day_of_week, start_time, end_time
         FROM ${tableNames.DOCTOR_AVAILABILITY}
         WHERE doctor_id = ?
         ORDER BY FIELD(day_of_week,'monday','tuesday','wednesday','thursday','friday','saturday','sunday'), start_time`,
        { replacements: [doc.doctor_id] },
      );

      const specializationNames =
        specs.map((s) => s.name).join(", ") || "General";
      const availabilityText =
        availability.length > 0
          ? availability
              .map((a) => {
                const dayCapitalized =
                  a.day_of_week.charAt(0).toUpperCase() +
                  a.day_of_week.slice(1);
                return `    ${dayCapitalized}: ${a.start_time}–${a.end_time}`;
              })
              .join("\n")
          : "    Contact clinic for availability";

      const title = doc.title ? `${doc.title} ` : "";
      const exp =
        doc.experience_years > 0 ? `, ${doc.experience_years} yrs exp` : "";
      const qual = doc.qualification ? ` (${doc.qualification})` : "";

      result.push(
        `• Doctor ID: ${doc.doctor_id} | ${title}${doc.name}${qual}${exp}\n` +
          `  Specializations: ${specializationNames}\n` +
          `  Current Status: ${doc.status.toUpperCase()}\n` +
          `  Working Days (each day has DIFFERENT hours):\n${availabilityText}\n` +
          `  Slot Duration: ${doc.consultation_duration || 30} mins`,
      );
    }

    return result.join("\n\n");
  } catch (error) {
    throw error;
  }
};

// ─── Get Doctor's Weekly Availability Schedule ───
export const getDoctorAvailabilityService = async (tenant_id, doctor_id) => {
  try {
    const [availability] = await db.sequelize.query(
      `SELECT day_of_week, start_time, end_time
       FROM ${tableNames.DOCTOR_AVAILABILITY}
       WHERE doctor_id = ? AND tenant_id = ?
       ORDER BY FIELD(day_of_week,'monday','tuesday','wednesday','thursday','friday','saturday','sunday'), start_time`,
      { replacements: [doctor_id, tenant_id] },
    );

    return availability || [];
  } catch (error) {
    throw error;
  }
};
