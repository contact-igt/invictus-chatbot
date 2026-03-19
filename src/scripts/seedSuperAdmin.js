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
    console.log("🌱 Starting Super Admin seeding...");

    // Check if any super admin exists
    const checkQuery = `SELECT * FROM ${tableNames.MANAGEMENT} WHERE role = 'super_admin' LIMIT 1`;
    const [existingSuperAdmin] = await db.sequelize.query(checkQuery);

    if (existingSuperAdmin && existingSuperAdmin.length > 0) {
      console.log("✅ Super Admin already exists. Seeding skipped.");
      console.log(`📧 Email: ${existingSuperAdmin[0].email}`);
      console.log(`👤 Username: ${existingSuperAdmin[0].username}`);
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(SUPER_ADMIN_DEFAULT.password, 10);

    // Generate readable management_id
    const managementId = await generateReadableIdFromLast(
      tableNames?.MANAGEMENT,
      "management_id",
      "MG",
    );

    // Insert super admin using the correct structure
    const insertQuery = `
      INSERT INTO ${tableNames.MANAGEMENT} 
      (management_id, title, username, email, country_code, mobile, password, role, status, created_at, updated_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;

    const values = [
      managementId,
      SUPER_ADMIN_DEFAULT.title,
      SUPER_ADMIN_DEFAULT.username,
      SUPER_ADMIN_DEFAULT.email,
      SUPER_ADMIN_DEFAULT.country_code,
      SUPER_ADMIN_DEFAULT.mobile,
      hashedPassword,
      SUPER_ADMIN_DEFAULT.role,
      SUPER_ADMIN_DEFAULT.status,
    ];

    await db.sequelize.query(insertQuery, { replacements: values });

    console.log("✅ Super Admin created successfully!");
    console.log(`🆔 Management ID: ${managementId}`);
    console.log(`📧 Email: ${SUPER_ADMIN_DEFAULT.email}`);
    console.log(`👤 Username: ${SUPER_ADMIN_DEFAULT.username}`);
    console.log(`📱 Mobile: ${SUPER_ADMIN_DEFAULT.mobile}`);
    console.log(
      "🔐 Password: Check your .env file (SUPER_ADMIN_PASSWORD variable)",
    );
    console.log("\n⚠️  Important: Change the default password immediately!");
  } catch (error) {
    console.error("❌ Error during super admin seeding:", error);
    throw error;
  }
};

// Run seeding
(async () => {
  try {
    await seedSuperAdmin();
    process.exit(0);
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
