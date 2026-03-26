import { missingFieldsChecker } from "../../utils/helpers/missingFields.js";
import { formatPhoneNumber } from "../../utils/helpers/formatPhoneNumber.js";
import {
  createContactService,
  deleteContactService,
  permanentDeleteContactService,
  getAllContactsService,
  getContactByIdAndTenantIdService,
  getContactByPhoneAndTenantIdService,
  updateContactService,
  getDeletedContactListService,
  restoreContactService,
  importContactsService,
  toggleSilenceAiService,
} from "./contacts.service.js";

export const getDeletedContactListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  try {
    const result = await getDeletedContactListService(tenant_id);
    return res.status(200).send({
      message: "success",
      data: result,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const restoreContactController = async (req, res) => {
  const { contact_id } = req.params;
  const tenant_id = req.user.tenant_id;
  try {
    const result = await restoreContactService(contact_id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    if (err.message === "Contact not found or not deleted") {
      return res.status(404).send({ message: err.message });
    }
    return res.status(500).send({ message: err.message });
  }
};

export const createContactController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  let { country_code, phone, name, email, profile_pic } = req.body;

  if (!phone) {
    return res.status(400).json({
      message: "Phone number is required",
    });
  }

  // Clean phone
  phone = phone.toString().replace(/\D/g, "");

  // Auto-handling for country code
  if (!country_code) {
    if (phone.length === 10) {
      country_code = "+91"; // Default to India
    } else if (phone.length > 10) {
      // Split if combined
      country_code = `+${phone.slice(0, -10)}`;
      phone = phone.slice(-10);
    } else {
      return res.status(400).json({
        message: "Invalid phone number length",
      });
    }
  }

  // Clean country code (ensure starts with +)
  country_code = country_code.toString().startsWith("+")
    ? country_code
    : `+${country_code.toString().replace(/\D/g, "")}`;

  try {
    const existingContact = await getContactByPhoneAndTenantIdService(
      tenant_id,
      phone,
      country_code,
    );

    if (existingContact) {
      return res.status(409).send({
        message: "This contact already exists",
      });
    }

    await createContactService(
      tenant_id,
      phone,
      name || null,
      profile_pic || null,
      country_code,
      null, // wa_id
      email || null,
    );

    return res.status(201).send({
      message: "Contact created successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const getAllContactsController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({
      message: "Tenant id missing",
    });
  }

  try {
    const response = await getAllContactsService(tenant_id);

    return res.status(200).send({
      message: "success",
      data: response,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const getContactByIdController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { contact_id } = req.params;

  if (!tenant_id) {
    return res.status(400).send({ message: "Tenant id missing" });
  }

  try {
    const response = await getContactByIdAndTenantIdService(
      contact_id,
      tenant_id,
    );
    if (!response) {
      return res.status(404).send({ message: "Contact not found" });
    }
    return res.status(200).send({
      message: "success",
      data: response,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const updateContactController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { contact_id } = req.params;
  const { name, email, profile_pic, is_blocked, phone } = req.body;

  if (!tenant_id) {
    return res.status(400).send({ message: "Tenant id missing" });
  }

  // Security: Prevent phone number editing
  if (phone !== undefined) {
    return res.status(403).send({
      message:
        "Phone number cannot be edited. Please delete and recreate the contact if needed.",
    });
  }

  try {
    // Fetch existing contact to preserve fields not provided in update
    const existingContact = await getContactByIdAndTenantIdService(
      contact_id,
      tenant_id,
    );
    if (!existingContact) {
      return res.status(404).send({ message: "Contact not found" });
    }

    // Merge: use new value if provided, otherwise keep existing
    const finalName = name !== undefined ? name : existingContact.name;
    const finalEmail = email !== undefined ? email : existingContact.email;
    const finalProfilePic =
      profile_pic !== undefined ? profile_pic : existingContact.profile_pic;
    const finalIsBlocked =
      is_blocked !== undefined ? is_blocked : existingContact.is_blocked;

    await updateContactService(
      contact_id,
      tenant_id,
      finalName,
      finalEmail,
      finalProfilePic,
      finalIsBlocked,
    );
    return res.status(200).send({
      message: "Contact updated successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const deleteContactController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { contact_id } = req.params;

  if (!tenant_id) {
    return res.status(400).send({ message: "Tenant id missing" });
  }

  try {
    await deleteContactService(contact_id, tenant_id);
    return res.status(200).send({
      message: "Contact deleted successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const permanentDeleteContactController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { contact_id } = req.params;

  if (!tenant_id) {
    return res.status(400).send({ message: "Tenant id missing" });
  }

  try {
    await permanentDeleteContactService(contact_id, tenant_id);
    return res.status(200).send({
      message: "Contact and related data permanently deleted",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const importContactsController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!req.files || !req.files.file) {
    return res.status(400).send({ message: "No CSV file uploaded" });
  }

  const file = req.files.file;

  // Check if it's a CSV
  if (!file.name.endsWith(".csv")) {
    return res.status(400).send({ message: "Please upload a valid CSV file" });
  }

  try {
    const csvData = file.data.toString("utf8");
    const lines = csvData.split(/\r?\n/).filter((line) => line.trim() !== "");

    if (lines.length < 2) {
      return res
        .status(400)
        .send({ message: "CSV file is empty or missing data" });
    }

    // Parse headers
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const nameIndex = headers.indexOf("name");
    const phoneIndex = headers.indexOf("phone");
    const emailIndex = headers.indexOf("email");

    if (nameIndex === -1 || phoneIndex === -1) {
      return res.status(400).send({
        message: "CSV must contain 'name' and 'phone' columns",
      });
    }

    // Parse rows
    const contactsToImport = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = [];
      let currentField = "";
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          // Process field before pushing
          let val = currentField.trim();
          // Remove ="..." (Excel format) or "..." (Quoted format)
          val = val.replace(/^="(.+)"$/, "$1").replace(/^"(.+)"$/, "$1");
          values.push(val);
          currentField = "";
        } else {
          currentField += char;
        }
      }
      // Push last field
      let lastVal = currentField.trim();
      lastVal = lastVal.replace(/^="(.+)"$/, "$1").replace(/^"(.+)"$/, "$1");
      values.push(lastVal);

      if (values.length >= Math.max(nameIndex, phoneIndex, emailIndex) + 1) {
        contactsToImport.push({
          name: values[nameIndex],
          phone: values[phoneIndex],
          email: emailIndex !== -1 ? values[emailIndex] : null,
        });
      }
    }

    const result = await importContactsService(tenant_id, contactsToImport);

    return res.status(200).send({
      message: `Import complete: ${result.success} succeeded, ${result.skipped} skipped/duplicate.`,
      data: result,
    });
  } catch (err) {
    return res.status(500).send({
      message: "An error occurred during CSV import: " + err.message,
    });
  }
};

export const toggleSilenceAiController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { contact_id } = req.params;
  const { is_ai_silenced } = req.body;

  try {
    await toggleSilenceAiService(contact_id, tenant_id, is_ai_silenced);

    // Attempting to emit socket event if possible here, but usually socket is handled in messages/webhook
    // We will just do a fast update. Frontend handles it optimism.

    return res
      .status(200)
      .send({ message: "AI silence status updated successfully" });
  } catch (err) {
    return res.status(500).send({ message: err?.message });
  }
};
