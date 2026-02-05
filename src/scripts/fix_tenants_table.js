import db from "../database/index.js";

const fixTenantsTable = async () => {
  try {
    console.log("🔧 Fixing tenants table...");

    // Drop the tenants table
    await db.sequelize.query("DROP TABLE IF EXISTS `tenants`");
    console.log("✅ Dropped tenants table");

    // Recreate it
    await db.sequelize.sync({ alter: false });
    console.log("✅ Recreated tenants table");

    console.log("✅ Tenants table fixed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error fixing tenants table:", err);
    process.exit(1);
  }
};

fixTenantsTable();
