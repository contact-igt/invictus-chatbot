import express from "express";
import {
  createAppSettingController,
  getAllAppSettingController,
  getAppSettingByIdController,
  updateAppSettingController,
} from "./appsetting.controller.js";

const router = express.Router();

router.post("/appsetting", createAppSettingController);
router.put("/appsetting/:id", updateAppSettingController);
router.get("/appsettings", getAllAppSettingController);
router.get("/appsetting/:id", getAppSettingByIdController);
export default router;
