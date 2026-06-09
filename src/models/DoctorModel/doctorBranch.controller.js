import {
  getDoctorBranchesService,
  getBranchDoctorsService,
  replaceDoctorBranchesService,
  addDoctorToBranchService,
  removeDoctorFromBranchService,
} from "./doctorBranch.service.js";

export const getDoctorBranchesController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { doctor_id } = req.params;
  try {
    const result = await getDoctorBranchesService(tenant_id, doctor_id);
    return res.status(200).send({ message: "success", data: result });
  } catch (err) {
    if (err.message === "Doctor not found")
      return res.status(404).send({ message: err.message });
    return res.status(500).send({ message: err.message });
  }
};

export const replaceDoctorBranchesController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { doctor_id } = req.params;
  const { branches } = req.body;
  try {
    const result = await replaceDoctorBranchesService(
      tenant_id,
      doctor_id,
      branches,
    );
    return res.status(200).send({ message: "success", data: result });
  } catch (err) {
    if (err.message === "Doctor not found")
      return res.status(404).send({ message: err.message });
    if (
      err.message &&
      (err.message.includes("not found") ||
        err.message.includes("inactive") ||
        err.message.includes("Duplicate") ||
        err.message.includes("primary"))
    ) {
      return res.status(400).send({ message: err.message });
    }
    return res.status(500).send({ message: err.message });
  }
};

export const getBranchDoctorsController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { branch_id } = req.params;
  try {
    const result = await getBranchDoctorsService(tenant_id, branch_id);
    return res.status(200).send({ message: "success", data: result });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const addDoctorsToBranchController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { branch_id } = req.params;
  const { doctor_ids } = req.body;
  if (!Array.isArray(doctor_ids) || doctor_ids.length === 0) {
    return res
      .status(400)
      .send({ message: "doctor_ids must be a non-empty array" });
  }

  try {
    const results = [];
    for (const doctor_id of Array.from(new Set(doctor_ids))) {
      try {
        const r = await addDoctorToBranchService(
          tenant_id,
          doctor_id,
          branch_id,
          false,
        );
        results.push({ doctor_id, ok: true, result: r });
      } catch (err) {
        results.push({ doctor_id, ok: false, message: err.message });
      }
    }
    return res.status(200).send({ message: "completed", data: results });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const removeDoctorFromBranchController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { branch_id, doctor_id } = req.params;
  try {
    const result = await removeDoctorFromBranchService(
      tenant_id,
      doctor_id,
      branch_id,
    );
    return res.status(200).send({ message: result.message });
  } catch (err) {
    if (err.message === "Mapping not found")
      return res.status(404).send({ message: err.message });
    return res.status(500).send({ message: err.message });
  }
};
