import { missingFieldsChecker } from "../../utils/helpers/missingFields.js";
import {
  createDoctorService,
  getDoctorListService,
  getDoctorByIdService,
  updateDoctorService,
  softDeleteDoctorService,
  permanentDeleteDoctorService,
  restoreDoctorService,
  getDeletedDoctorListService,
} from "./doctor.service.js";
import {
  normalizeMobile,
  cleanCountryCode,
} from "../../utils/helpers/normalizeMobile.js";

export const createDoctorController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  const {
    title,
    name,
    country_code,
    mobile,
    email,
    status,
    consultation_duration,
    specializations,
    availability,
    bio,
    profile_pic,
    experience_years,
    qualification,
  } = req.body;

  const requiredFields = { name, mobile, email };
  const missing = await missingFieldsChecker(requiredFields);
  if (missing.length > 0) {
    return res
      .status(400)
      .send({ message: `Missing fields: ${missing.join(", ")}` });
  }

  if (consultation_duration !== undefined && consultation_duration !== null) {
    if (
      typeof consultation_duration !== "number" ||
      consultation_duration < 5 ||
      consultation_duration > 240
    ) {
      return res.status(400).send({
        message:
          "Consultation duration must be a number between 5 and 240 minutes",
      });
    }
  }

  const cleanedCC = cleanCountryCode(country_code);
  const normalizedMobile = normalizeMobile(cleanedCC, mobile);

  try {
    const result = await createDoctorService(tenant_id, {
      title,
      name,
      country_code: cleanedCC,
      mobile: normalizedMobile,
      email,
      status,
      consultation_duration,
      specializations,
      availability,
      bio,
      profile_pic,
      experience_years,
      qualification,
    });

    return res.status(201).send({
      message: "Doctor created successfully",
      data: result,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const getDoctorListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { search } = req.query;

  try {
    const result = await getDoctorListService(tenant_id, search);
    return res.status(200).send({
      message: "success",
      data: result,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const getDoctorByIdController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;

  try {
    const result = await getDoctorByIdService(id, tenant_id);
    if (!result) {
      return res.status(404).send({ message: "Doctor not found" });
    }
    return res.status(200).send({
      message: "success",
      data: result,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const updateDoctorController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;
  const { consultation_duration } = req.body;

  // Validate consultation duration if provided
  if (consultation_duration !== undefined && consultation_duration !== null) {
    if (
      typeof consultation_duration !== "number" ||
      consultation_duration < 5 ||
      consultation_duration > 240
    ) {
      return res.status(400).send({
        message:
          "Consultation duration must be a number between 5 and 240 minutes",
      });
    }
  }

  try {
    // Normalize mobile and country_code if provided
    if (req.body.country_code) {
      req.body.country_code = cleanCountryCode(req.body.country_code);
    }
    if (req.body.mobile && req.body.country_code) {
      req.body.mobile = normalizeMobile(req.body.country_code, req.body.mobile);
    }

    const result = await updateDoctorService(id, tenant_id, req.body);
    return res.status(200).send(result);
  } catch (err) {
    if (err.message === "Doctor not found") {
      return res.status(404).send({ message: err.message });
    }
    return res.status(500).send({ message: err.message });
  }
};

export const softDeleteDoctorController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;

  try {
    const result = await softDeleteDoctorService(id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    if (err.message === "Doctor not found") {
      return res.status(404).send({ message: err.message });
    }
    return res.status(500).send({ message: err.message });
  }
};

export const permanentDeleteDoctorController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;

  try {
    const result = await permanentDeleteDoctorService(id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    if (err.message === "Doctor not found") {
      return res.status(404).send({ message: err.message });
    }
    return res.status(500).send({ message: err.message });
  }
};

export const restoreDoctorController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;

  try {
    const result = await restoreDoctorService(id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    if (err.message === "Doctor not found or not deleted") {
      return res.status(404).send({ message: err.message });
    }
    return res.status(500).send({ message: err.message });
  }
};

export const getDeletedDoctorListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    const result = await getDeletedDoctorListService(tenant_id);
    return res.status(200).send({
      message: "success",
      data: result,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};
