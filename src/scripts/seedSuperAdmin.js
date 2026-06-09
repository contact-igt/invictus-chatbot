import bcrypt from "bcrypt";
import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";
import { generateReadableIdFromLast } from "../utils/helpers/generateReadableIdFromLast.js";
import dotenv from "dotenv";

dotenv.config();

const SUPER_ADMIN_DEFAULT = {
  email: process.env.SUPER_ADMIN_EMAIL,
  username: process.env.SUPER_ADMIN_USERNAME,
  password: process.env.SUPER_ADMIN_PASSWORD,
  title: "Mr",
  country_code: process.env.SUPER_ADMIN_COUNTRY_CODE,
  mobile: process.env.SUPER_ADMIN_MOBILE,
  role: "super_admin",
  status: "active",
};

const seedSuperAdmin = async () => {
  try {
    
    await db.sequelize.sync();

    // Check if any super admin exists
    const checkQuery = `SELECT * FROM ${tableNames.MANAGEMENT} WHERE role = 'super_admin' LIMIT 1`;
    const [existingSuperAdmin] = await db.sequelize.query(checkQuery);

    if (existingSuperAdmin && existingSuperAdmin.length > 0) {
      
      