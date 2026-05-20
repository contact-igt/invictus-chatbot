import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import {
  normalizeAvailabilityForPersistence,
} from "./doctorAvailability.service.js";

// ── [DOCTOR TENANT-USER UNWIRED – 2026-05-13] ────────────────────────────────
// Doctors no longer receive a system-login account or plaintext-password email.
// All imports below are preserved for a fast rollback — just uncomment the block
// and restore the createDoctorService body sections marked [UNWIRED].
//
// import { generatePassword } from "../../utils/helpers/generatePassword.js";
// import bcrypt from "bcrypt";
// import { getTemplate } from "../../utils/email/templateLoader.js";
// import { sendEmail } from "../../utils/email/emailService.js";
// ── [END DOCTOR TENANT-USER UNWIRED] ─────────────────────────────────────────

import {
  // createTenantUserService,               // [DOCTOR TENANT-USER UNWIRED]
  // findTenantUserByEmailGloballyService,  // [DOCTOR TENANT-USER UNWIRED]
  // findTenantUserByEmailOrMobileGloballyService, // [DOCTOR TENANT-USER UNWIRED] – replaced by doctor-table check below
  softDeleteTenantUserService,   // still needed by softDeleteDoctorService
  restoreTenantUserService,      // still needed by restoreDoctorService
} from "../TenantUserModel/tenantuser.service.js";

const fetchDoctorAvailability = async (tenant_id, doctor_id) => {
  const [availability] = await db.sequelize.query(
    `SELECT da.id, da.day_of_week, da.start_time, da.end_time,
            COALESCE(dad.enabled, 1) AS enabled,
            COALESCE(dad.slot_duration, 15) AS slot_duration
       FROM ${tableNames.DOCTOR_AVAILABILITY} da
       LEFT JOIN ${tableNames.DOCTOR_AVAILABILITY_DAYS} dad
         ON dad.tenant_id = da.tenant_id
        AND dad.doctor_id = da.doctor_id
        AND dad.day_of_week = da.day_of_week
       WHERE da.doctor_id = ? AND da.tenant_id = ?
       ORDER BY FIELD(da.day_of_week, 'monday','tuesday','wednesday','thursday','friday','saturday','sunday'), da.start_time`,
    { replacements: [doctor_id, tenant_id] },
  );

  return (availability || []).map((slot) => ({
    ...slot,
    slotDuration: slot.slot_duration,
  }));
};

const fetchDoctorAvailabilityDays = async (tenant_id, doctor_id) => {
  const [days] = await db.sequelize.query(
    `SELECT day_of_week, enabled, slot_duration
       FROM ${tableNames.DOCTOR_AVAILABILITY_DAYS}
       WHERE doctor_id = ? AND tenant_id = ?
       ORDER BY FIELD(day_of_week, 'monday','tuesday','wednesday','thursday','friday','saturday','sunday')`,
    { replacements: [doctor_id, tenant_id] },
  );

  return (days || []).map((day) => ({
    day_of_week: day.day_of_week,
    enabled: Boolean(day.enabled),
    slot_duration: day.slot_duration,
    slotDuration: day.slot_duration,
  }));
};

const replaceDoctorAvailability = async ({
  tenant_id,
  doctor_id,
  availability,
  transaction,
}) => {
  const normalizedDays = normalizeAvailabilityForPersistence(availability || []);

  await db.DoctorAvailability.destroy({
    where: { doctor_id, tenant_id },
    transaction,
  });

  await db.DoctorAvailabilityDays.destroy({
    where: { doctor_id, tenant_id },
    transaction,
  });

  for (const day of normalizedDays) {
    await db.DoctorAvailabilityDays.create(
      {
        doctor_id,
        tenant_id,
        day_of_week: day.day,
        enabled: day.enabled,
        slot_duration: day.slotDuration,
      },
      { transaction },
    );

    if (!day.enabled) continue;

    for (const timeSlot of day.slots) {
      await db.DoctorAvailability.create(
        {
          doctor_id,
          tenant_id,
          day_of_week: day.day,
          start_time: timeSlot.start_time,
          end_time: timeSlot.end_time,
        },
        { transaction },
      );
    }
  }
};

// ─── Create Doctor ───
export const createDoctorService = async (tenant_id, data) => {
  const transaction = await db.sequelize.transaction();

  try {
    // ── [DOCTOR TENANT-USER UNWIRED – 2026-05-13] ──────────────────────────
    // Previously checked email/mobile uniqueness against TENANT_USERS (global).
    // Replaced with a direct DOCTORS-table duplicate check so no login account
    // is required. Restore the block below to bring back the TenantUser flow.
    //
    // const existingUser = await findTenantUserByEmailOrMobileGloballyService(
    //   data.email,
    //   data.mobile,
    // );
    // if (existingUser) {
    //   if (existingUser.email === data.email) {
    //     throw new Error("User with this email already exists in the system.");
    //   }
    //   if (existingUser.mobile === data.mobile) {
    //     throw new Error("User with this mobile number already exists in the system.");
    //   }
    // }
    // ── [END DOCTOR TENANT-USER UNWIRED] ───────────────────────────────────

    // Lightweight doctor-level duplicate guard (email OR mobile, global scope)
    const [[existingDoctor]] = await db.sequelize.query(
      `SELECT doctor_id FROM ${tableNames.DOCTORS}
       WHERE (email = ? OR mobile = ?) AND is_deleted = false LIMIT 1`,
      { replacements: [data.email, data.mobile] },
    );
    if (existingDoctor) {
      throw new Error(
        "A doctor with this email or mobile already exists in the system.",
      );
    }

    // ── [DOCTOR TENANT-USER UNWIRED – 2026-05-13] ──────────────────────────
    // Doctors no longer receive a TenantUser login account.
    // tenant_user_id is set to null in the doctors row.
    // To re-enable, uncomment everything below up to [END] and the imports.
    //
    // const tenant_user_id = await generateReadableIdFromLast(
    //   tableNames.TENANT_USERS,
    //   "tenant_user_id",
    //   "TTU",
    // );
    // const { password, hashedPassword } = await generatePassword();
    // await createTenantUserService(
    //   tenant_user_id,
    //   tenant_id,
    //   data.title || null,
    //   data.name,
    //   data.email,
    //   data.country_code || null,
    //   data.mobile,
    //   data.profile_pic || null,
    //   "doctor",        // role
    //   hashedPassword,
    //   "active",
    //   transaction,
    // );
    // ── [END DOCTOR TENANT-USER UNWIRED] ───────────────────────────────────

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
        tenant_user_id: null, // [DOCTOR TENANT-USER UNWIRED] was: tenant_user_id (login account removed)
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

    // 4. Handle availability day settings + concrete slot rows
    if (data.availability && data.availability.length > 0) {
      await replaceDoctorAvailability({
        tenant_id,
        doctor_id,
        availability: data.availability,
        transaction,
      });
    }

    await transaction.commit();

    // ── [DOCTOR TENANT-USER UNWIRED – 2026-05-13] ──────────────────────────
    // Welcome email containing a plaintext password has been removed.
    // Doctors no longer receive login credentials by email.
    // To restore, uncomment the try/catch below and the imports at the top.
    //
    // try {
    //   const template = getTemplate("tenantUserWelcome");
    //   const tenantData = await db.Tenants.findOne({
    //     where: { tenant_id },
    //     attributes: ["company_name"],
    //   });
    //   const emailHtml = template({
    //     name: data.name,
    //     role: "Doctor",
    //     company_name: tenantData?.company_name || "Your Organization",
    //     email: data.email,
    //     password: password,
    //     login_url: `${process.env.FRONTEND_URL}/login`,
    //   });
    //   await sendEmail({
    //     to: data.email,
    //     subject: `Welcome to ${tenantData?.company_name || "WhatsNexus"} - Your Doctor Account`,
    //     html: emailHtml,
    //   });
    // } catch (emailError) {
    //   console.error("Failed to send welcome email:", emailError);
    //   // Non-critical error, do not rollback transaction
    // }
    // ── [END DOCTOR TENANT-USER UNWIRED] ───────────────────────────────────

    return {
      doctor_id,
      tenant_user_id: null, // [DOCTOR TENANT-USER UNWIRED] no login account created
    };
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
       WHERE tenant_id = ? AND LOWER(name) LIKE LOWER(?) AND is_deleted = false
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

      const availability = await fetchDoctorAvailability(
        tenant_id,
        doctor.doctor_id,
      );
      const availabilityDays = await fetchDoctorAvailabilityDays(
        tenant_id,
        doctor.doctor_id,
      );

      doctor.specializations = specs;
      doctor.availability = availability;
      doctor.availabilityDays = availabilityDays;
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

    const availability = await fetchDoctorAvailability(tenant_id, doctor_id);
    const availabilityDays = await fetchDoctorAvailabilityDays(tenant_id, doctor_id);

    doctor.specializations = specs;
    doctor.availability = availability;
    doctor.availabilityDays = availabilityDays;

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
    if (data.mobile !== undefined) updateFields.mobile = data.mobile || null;
    if (data.email !== undefined) updateFields.email = data.email || null;
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
      await replaceDoctorAvailability({
        tenant_id,
        doctor_id,
        availability: data.availability,
        transaction,
      });
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
       WHERE d.tenant_id = ? AND d.is_deleted = false AND d.status IN ('available', 'busy', 'off_duty')
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

      // Group time slots by day so AI sees all slots per day on one line
      let availabilityText = "    Contact clinic for availability";
      if (availability.length > 0) {
        const dayMap = new Map();
        for (const a of availability) {
          const dayCapitalized =
            a.day_of_week.charAt(0).toUpperCase() + a.day_of_week.slice(1);
          if (!dayMap.has(dayCapitalized)) {
            dayMap.set(dayCapitalized, []);
          }
          dayMap.get(dayCapitalized).push(`${a.start_time}–${a.end_time}`);
        }
        availabilityText = Array.from(dayMap.entries())
          .map(([day, slots]) => `    ${day}: ${slots.join(", ")}`)
          .join("\n");
      }

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
    return await fetchDoctorAvailability(tenant_id, doctor_id);
  } catch (error) {
    throw error;
  }
};
