import {
  createAppSettingService,
  getAllAppSettingService,
  getAppSettingByIdService,
  toggelAppSettingService,
  updateAppSettingService,
} from "./appsetting.service.js";

export const createAppSettingController = async (req, res) => {
  const { label, setting_key, description } = req.body;

  if (!setting_key || !label) {
    return res.status(400).send({
      message: "Setting name or label required",
    });
  }

  try {
    await createAppSettingService(
      label,
      setting_key,
      description ? description : null
    );
    return res.status(200).send({
      message: "New Setting created successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const updateAppSettingController = async (req, res) => {
  const { setting_value, label, description } = req.body;
  const { id } = req.params;

  if (!setting_value || !label) {
    return res.status(400).send({
      message: "Setting value or label required",
    });
  }

  if (!id) {
    return res.status(400).send({
      message: "Setting id required",
    });
  }

  try {
    await updateAppSettingService(setting_value, label, description, id);

    return res.status(200).send({
      message: "Setting updated successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const getAllAppSettingController = async (req, res) => {
  try {
    const response = await getAllAppSettingService();

    return res.status(200).send({
      message: "Setting listed successfully",
      data: response,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const getAppSettingByIdController = async (req, res) => {
  const { id } = req.params;
  try {
    const response = await getAppSettingByIdService(id);

    return res.status(200).send({
      message: "Setting listed successfully",
      data: response,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const toggelAppSettingController = async (req, res) => {
  const { setting_value } = req.body;
  const { id } = req.params;

  if (!setting_value) {
    return res.status(400).send({
      message: "Setting value required",
    });
  }

  if (!id) {
    return res.status(400).send({
      message: "Setting id required",
    });
  }

  try {
    await toggelAppSettingService(setting_value, id);

    return res.status(200).send({
      message: "Setting updated successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};
