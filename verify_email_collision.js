
import db from "./src/database/index.js";
import { generateReadableIdFromLast } from "./src/utils/helpers/generateReadableIdFromLast.js";
import { tableNames } from "./src/database/tableName.js";
import { createTenantUserService, softDeleteTenantUserService } from "./src/models/TenantUserModel/tenantuser.service.js";

const TEST_EMAIL = "collision_test_doctor@example.com";
const TENANT_ID = "TEN001"; // Assuming a valid tenant ID or mock one if tests allow

const runTest = async () => {
    console.log("--- Starting Email Collision Test ---");
    const transaction = await db.sequelize.transaction();

    try {
        // 1. Create Doctor 1
        console.log("1. Creating Doctor 1...");
        const userId1 = await generateReadableIdFromLast(tableNames.TENANT_USERS, "tenant_user_id", "TTU");
        await createTenantUserService(
            userId1,
            TENANT_ID,
            "Dr",
            "DoctorOne",
            TEST_EMAIL, // Email A
            "+91",
            "9999999991",
            null,
            "doctor",
            "hash",
            "active",
            transaction
        );
        console.log("   - Doctor 1 Created");

        // 2. Soft Delete Doctor 1
        console.log("2. Soft Deleting Doctor 1...");
        await softDeleteTenantUserService(userId1); // This needs to be wrapped or transaction awareness added/checked
        // Note: softDeleteTenantUserService defines its OWN query but doesn't accept transaction in the current file view I saw?
        // Wait, I checked and it does NOT accept transaction in the code I viewed earlier (Step 486/600).
        // I'll manually run the update query with transaction to be safe for this test script context, 
        // OR rely on the fact that standard service might commit independently.
        // Let's manually do it to keep this atomic in test if possible, or just call service.
        // Actually, for this test to show the DB constraint, we can just let the first service commit (if I didn't pass transaction? Oh I plan to pass it).
        // In my previous step (528) I updated Create to accept transaction.
        // But SoftDelete (Step 600) doesn't accept transaction yet!

        // Let's commit the creation first so it's in DB.
        await transaction.commit();

        // NOW soft delete (new transaction inside service or auto-commit)
        await softDeleteTenantUserService(userId1);
        console.log("   - Doctor 1 Soft Deleted");

        // 3. Try Create Doctor 2 with SAME email
        console.log("3. Attempting to Create Doctor 2 with SAME email...");
        try {
            const userId2 = await generateReadableIdFromLast(tableNames.TENANT_USERS, "tenant_user_id", "TTU");
            await createTenantUserService(
                userId2,
                TENANT_ID,
                "Dr",
                "DoctorTwo",
                TEST_EMAIL, // SAME Email A
                "+91",
                "9999999992",
                null,
                "doctor",
                "hash",
                "active"
                // No transaction passed, so it auto-commits
            );
            console.error("❌ FAILURE: Doctor 2 was created! Duplicate email allowed.");
        } catch (err) {
            console.log("✅ SUCCESS: Doctor 2 creation FAILED as expected.");
            console.log("   - Error:", err.message);
        }

        // Cleanup
        console.log("Cleaning up...");
        await db.TenantUsers.destroy({ where: { email: TEST_EMAIL } });

    } catch (error) {
        console.error("Test Error:", error);
        if (!transaction.finished) await transaction.rollback();
    }
};

runTest();
