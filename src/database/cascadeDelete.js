/**
 * Cascade Delete Utilities
 *
 * Centralized utilities for handling cascade deletes across database tables.
 * All operations are transaction-safe to ensure data integrity.
 *
 * @module database/cascadeDelete
 */

import db from "./index.js";
import { Op } from "sequelize";
import { permanentDeleteTenantUserService } from "../models/TenantUserModel/tenantuser.service.js";

/**
 * Cascade delete a Tenant and ALL related data
 *
 * Deletes in proper order to respect foreign key dependencies:
 * 1. Junction/child tables (DoctorSpecializations, ContactGroupMembers, etc.)
 * 2. Mid-level entities (Doctors, Contacts, Messages, etc.)
 * 3. Direct children (TenantUsers, WhatsappAccount)
 * 4. Root (Tenant)
 *
 * @param {string} tenant_id - The tenant ID to delete
 * @param {Transaction} transaction - Optional Sequelize transaction
 * @returns {Promise<Object>} Success message
 *
 * @example
 * const result = await cascadeDeleteTenant('TEN00001');
 */
export const cascadeDeleteTenant = async (tenant_id, transaction) => {
  const t = transaction || (await db.sequelize.transaction());

  try {
    // ========================================
    // STEP 1: Delete Junction/Child Tables
    // ========================================

    // Get all doctor IDs for this tenant (for junction table cleanup)
    const doctors = await db.Doctors.findAll({
      where: { tenant_id },
      attributes: ["doctor_id"],
      transaction: t,
    });
    const doctorIds = doctors.map((d) => d.doctor_id);

    // Get all specialization IDs for this tenant
    const specializations = await db.Specializations.findAll({
      where: { tenant_id },
      attributes: ["specialization_id"],
      transaction: t,
    });
    const specializationIds = specializations.map((s) => s.specialization_id);

    // Get all contact IDs for this tenant
    const contacts = await db.Contacts.findAll({
      where: { tenant_id },
      attributes: ["id"],
      transaction: t,
    });
    const contactIds = contacts.map((c) => c.id);

    // Get all template IDs for this tenant
    const templates = await db.WhatsappTemplates.findAll({
      where: { tenant_id },
      attributes: ["template_id"],
      transaction: t,
    });
    const templateIds = templates.map((tpl) => tpl.template_id);

    // Get all campaign IDs for this tenant
    const campaigns = await db.WhatsappCampaigns.findAll({
      where: { tenant_id },
      attributes: ["campaign_id"],
      transaction: t,
    });
    const campaignIds = campaigns.map((c) => c.campaign_id);

    // Get all contact group IDs for this tenant
    const contactGroups = await db.ContactGroups.findAll({
      where: { tenant_id },
      attributes: ["group_id"],
      transaction: t,
    });
    const groupIds = contactGroups.map((g) => g.group_id);

    // Get all knowledge source IDs for this tenant
    const knowledgeSources = await db.KnowledgeSources.findAll({
      where: { tenant_id },
      attributes: ["id"],
      transaction: t,
    });
    const sourceIds = knowledgeSources.map((s) => s.id);

    // Delete doctor-related junction tables
    if (doctorIds.length > 0) {
      await db.DoctorSpecializations.destroy({
        where: { doctor_id: { [Op.in]: doctorIds } },
        transaction: t,
      });

      await db.DoctorAvailability.destroy({
        where: { doctor_id: { [Op.in]: doctorIds } },
        transaction: t,
      });
    }

    // Delete specialization-related junction tables
    if (specializationIds.length > 0) {
      await db.DoctorSpecializations.destroy({
        where: { specialization_id: { [Op.in]: specializationIds } },
        transaction: t,
      });
    }

    // Delete template-related child tables
    if (templateIds.length > 0) {
      await db.WhatsappTemplateComponents.destroy({
        where: { template_id: { [Op.in]: templateIds } },
        transaction: t,
      });

      await db.WhatsappTemplateVariables.destroy({
        where: { template_id: { [Op.in]: templateIds } },
        transaction: t,
      });

      await db.WhatsappTemplateSyncLogs.destroy({
        where: { template_id: { [Op.in]: templateIds } },
        transaction: t,
      });
    }

    // Delete campaign-related child tables
    if (campaignIds.length > 0) {
      await db.WhatsappCampaignRecipients.destroy({
        where: { campaign_id: { [Op.in]: campaignIds } },
        transaction: t,
      });
    }

    // Delete contact group members
    if (groupIds.length > 0) {
      await db.ContactGroupMembers.destroy({
        where: { group_id: { [Op.in]: groupIds } },
        transaction: t,
      });
    }

    // Delete contact-related group memberships
    if (contactIds.length > 0) {
      await db.ContactGroupMembers.destroy({
        where: { contact_id: { [Op.in]: contactIds } },
        transaction: t,
      });
    }

    // Delete knowledge chunks
    if (sourceIds.length > 0) {
      await db.KnowledgeChunks.destroy({
        where: { source_id: { [Op.in]: sourceIds } },
        transaction: t,
      });
    }

    // ========================================
    // STEP 2: Delete Mid-Level Tables
    // ========================================

    await db.Doctors.destroy({ where: { tenant_id }, transaction: t });
    await db.Specializations.destroy({ where: { tenant_id }, transaction: t });
    await db.Contacts.destroy({ where: { tenant_id }, transaction: t });
    await db.Messages.destroy({ where: { tenant_id }, transaction: t });
    await db.Leads.destroy({ where: { tenant_id }, transaction: t });
    await db.LiveChat.destroy({ where: { tenant_id }, transaction: t });
    await db.WhatsappTemplates.destroy({
      where: { tenant_id },
      transaction: t,
    });
    await db.WhatsappCampaigns.destroy({
      where: { tenant_id },
      transaction: t,
    });
    await db.ContactGroups.destroy({ where: { tenant_id }, transaction: t });
    await db.KnowledgeSources.destroy({ where: { tenant_id }, transaction: t });
    await db.AiPrompt.destroy({ where: { tenant_id }, transaction: t });
    await db.TenantInvitations.destroy({
      where: { tenant_id },
      transaction: t,
    });

    // ========================================
    // STEP 3: Delete Direct Children
    // ========================================

    await db.TenantUsers.destroy({ where: { tenant_id }, transaction: t });
    await db.Whatsappaccount.destroy({ where: { tenant_id }, transaction: t });

    // ========================================
    // STEP 4: Delete Root (Tenant)
    // ========================================

    const deletedCount = await db.Tenants.destroy({
      where: { tenant_id },
      transaction: t,
    });

    if (deletedCount === 0) {
      throw new Error("Tenant not found");
    }

    // Commit transaction if we created it
    if (!transaction) {
      await t.commit();
    }

    return {
      message: "Tenant and all related data deleted successfully",
      tenant_id,
      deleted_at: new Date(),
    };
  } catch (error) {
    // Rollback transaction if we created it
    if (!transaction) {
      await t.rollback();
    }
    throw error;
  }
};

/**
 * Cascade delete a TenantUser
 *
 * Options:
 * - deleteLinkedDoctor: If true, deletes any doctor linked to this user
 * - nullifyDoctorLink: If true, sets doctor's tenant_user_id to NULL (default)
 *
 * @param {string} tenant_user_id - The tenant user ID to delete
 * @param {Object} options - Delete options
 * @param {boolean} options.deleteLinkedDoctor - Delete linked doctor (default: false)
 * @param {Transaction} transaction - Optional Sequelize transaction
 * @returns {Promise<Object>} Success message
 *
 * @example
 * // Nullify doctor link (default)
 * await cascadeDeleteTenantUser('TTU00001');
 *
 * // Delete linked doctor
 * await cascadeDeleteTenantUser('TTU00001', { deleteLinkedDoctor: true });
 */
export const cascadeDeleteTenantUser = async (
  tenant_user_id,
  options = {},
  transaction,
) => {
  const t = transaction || (await db.sequelize.transaction());

  try {
    const { deleteLinkedDoctor = false } = options;

    // Find the user to verify it exists
    const user = await db.TenantUsers.findOne({
      where: { tenant_user_id },
      transaction: t,
    });

    if (!user) {
      throw new Error("TenantUser not found");
    }

    // Handle linked doctor
    if (deleteLinkedDoctor) {
      // Delete any doctor linked to this user (cascade to doctor's related data)
      const linkedDoctors = await db.Doctors.findAll({
        where: { tenant_user_id },
        attributes: ["doctor_id", "tenant_id"],
        transaction: t,
      });

      for (const doctor of linkedDoctors) {
        await cascadeDeleteDoctor(doctor.doctor_id, doctor.tenant_id, t);
      }
    } else {
      // Nullify the doctor link (default behavior)
      await db.Doctors.update(
        { tenant_user_id: null },
        { where: { tenant_user_id }, transaction: t },
      );
    }

    // Delete the tenant user
    await db.TenantUsers.destroy({
      where: { tenant_user_id },
      transaction: t,
    });

    // Commit transaction if we created it
    if (!transaction) {
      await t.commit();
    }

    return {
      message: "TenantUser deleted successfully",
      tenant_user_id,
      deleted_at: new Date(),
    };
  } catch (error) {
    // Rollback transaction if we created it
    if (!transaction) {
      await t.rollback();
    }
    throw error;
  }
};

/**
 * Cascade delete a Doctor and all related data
 *
 * Deletes:
 * - DoctorSpecializations (junction table)
 * - DoctorAvailability
 * - Doctor record
 *
 * @param {string} doctor_id - The doctor ID to delete
 * @param {string} tenant_id - The tenant ID for verification
 * @param {Transaction} transaction - Optional Sequelize transaction
 * @returns {Promise<Object>} Success message
 *
 * @example
 * await cascadeDeleteDoctor('DOC00001', 'TEN00001');
 */

export const cascadeDeleteDoctor = async (
  doctor_id,
  tenant_id,
  transaction,
) => {
  const t = transaction || (await db.sequelize.transaction());

  try {
    // Verify doctor exists
    const doctor = await db.Doctors.findOne({
      where: { doctor_id, tenant_id },
      attributes: ["doctor_id", "tenant_user_id"], // Fetch tenant_user_id
      transaction: t,
    });

    if (!doctor) {
      throw new Error("Doctor not found");
    }

    // Delete all related data in correct order
    await db.DoctorSpecializations.destroy({
      where: { doctor_id },
      transaction: t,
    });

    await db.DoctorAvailability.destroy({
      where: { doctor_id },
      transaction: t,
    });

    await db.Doctors.destroy({
      where: { doctor_id, tenant_id },
      transaction: t,
    });

    // Delete the associated tenant user (if linked)
    // Delete the associated tenant user (if linked)
    if (doctor.tenant_user_id) {
      await permanentDeleteTenantUserService(doctor.tenant_user_id, t);
    }

    // Commit transaction if we created it
    if (!transaction) {
      await t.commit();
    }

    return {
      message: "Doctor permanently deleted",
      doctor_id,
      deleted_at: new Date(),
    };
  } catch (error) {
    // Rollback transaction if we created it
    if (!transaction) {
      await t.rollback();
    }
    throw error;
  }
};

/**
 * Cascade delete a Specialization and junction table records
 *
 * Deletes:
 * - DoctorSpecializations (junction table) - FIXED!
 * - Specialization record
 *
 * @param {string} specialization_id - The specialization ID to delete
 * @param {string} tenant_id - The tenant ID for verification
 * @param {Transaction} transaction - Optional Sequelize transaction
 * @returns {Promise<Object>} Success message
 *
 * @example
 * await cascadeDeleteSpecialization('SPEC001', 'TEN00001');
 */

export const cascadeDeleteSpecialization = async (
  specialization_id,
  tenant_id,
  transaction,
) => {
  const t = transaction || (await db.sequelize.transaction());

  try {
    // Verify specialization exists
    const specialization = await db.Specializations.findOne({
      where: { specialization_id, tenant_id },
      transaction: t,
    });

    if (!specialization) {
      throw new Error("Specialization not found");
    }

    // Delete junction table records FIRST (this was missing before!)
    await db.DoctorSpecializations.destroy({
      where: { specialization_id },
      transaction: t,
    });

    // Then delete the specialization
    await db.Specializations.destroy({
      where: { specialization_id, tenant_id },
      transaction: t,
    });

    // Commit transaction if we created it
    if (!transaction) {
      await t.commit();
    }

    return {
      message: "Specialization permanently deleted",
      specialization_id,
      deleted_at: new Date(),
    };
  } catch (error) {
    // Rollback transaction if we created it
    if (!transaction) {
      await t.rollback();
    }
    throw error;
  }
};
