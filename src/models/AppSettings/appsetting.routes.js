import express from "express";
import {
  createAppSettingController,
  getAllAppSettingsController,
  getAppSettingByIdController,
  getAppSettingByKeyController,
  toggleAppSettingController,
} from "./appsetting.controller.js";

const router = express.Router();

// router.post("/appsetting", createAppSettingController);
// router.get("/appsettings", getAllAppSettingController);
// router.get("/appsetting/:id", getAppSettingByIdController);
// router.put("/appsettingtoggle/:id", toggelAppSettingController);
// router.get("/appsettingkey", getAppSettingByKeyController);

router.post("/app-setting", createAppSettingController);
router.get("/app-settings", getAllAppSettingsController);
router.get("/app-setting/key", getAppSettingByKeyController);
router.get("/app-setting/:id", getAppSettingByIdController);
router.put("/app-setting/toggle/:id", toggleAppSettingController);

export default router;
