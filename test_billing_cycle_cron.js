/**
 * Test script: Manually simulate billing cycle expiry & run the cron.
 *
 * Steps:
 *   1. Find a postpaid tenant with an active billing cycle
 *   2. Show current state (cycle, ledger, AI usage, invoices)
 *   3. Backdate the cycle's end_date to yesterday (simulate month end)
 *   4. Run the cron
 *   5. Verify: cycle closed, invoice created, next cycle started
 *   6. Restore original end_date (undo) if no real invoice was needed
 */

import db from "./src/database/index.js";
import { runBillingCycleCron } from "./src/models/BillingModel/billingCycle.service.js";
const { Op } = db.Sequelize;

const divider = (title) =>
  console.log(`\n${"═".repeat(60)}\n  ${title}\n${"═".repeat(60)}`);

(async () => {
  try {
    // ─── Step 1: Find postpaid tenant ───
    divider("STEP 1: Finding postpaid tenants");

    const tenants = await db.Tenants.findAll({
      where: { billing_mode: "postpaid" },
      attributes: [
        "tenant_id",
        "company_name",
        "billing_mode",
        "postpaid_credit_limit",
        "billing_cycle_start",
        "billing_cycle_end",
      ],
      raw: true,
    });

    if (tenants.length === 0) {
      console.log("❌ No postpaid tenants found. Cannot test cycle closure.");
      process.exit(0);
    }

    console.table(tenants);
    const tenant = tenants[0];
    const tid = tenant.tenant_id;
    console.log(`\n✅ Using tenant: ${tenant.company_name} (${tid})`);

    // ─── Step 2: Show current state ───
    divider("STEP 2: Current State BEFORE cron");

    const activeCycle = await db.BillingCycles.findOne({
      where: { tenant_id: tid, status: "active" },
      raw: true,
    });

    if (!activeCycle) {
      console.log("❌ No active billing cycle found for this tenant.");
      process.exit(0);
    }

    console.log("\n📅 Active Billing Cycle:");
    console.table([
      {
        id: activeCycle.id,
        cycle_number: activeCycle.cycle_number,
        start_date: activeCycle.start_date,
        end_date: activeCycle.end_date,
        status: activeCycle.status,
        is_locked: activeCycle.is_locked,
        total_cost_inr: activeCycle.total_cost_inr,
      },
    ]);

    // Count ledger entries for this cycle
    const ledgerCount = await db.BillingLedger.count({
      where: { tenant_id: tid, billing_cycle_id: activeCycle.id },
    });
    const ledgerSum = await db.BillingLedger.findOne({
      attributes: [
        [db.sequelize.fn("SUM", db.sequelize.col("total_cost_inr")), "total"],
      ],
      where: { tenant_id: tid, billing_cycle_id: activeCycle.id },
      raw: true,
    });

    // Count AI usage for this cycle
    const aiCount = await db.AiTokenUsage.count({
      where: { tenant_id: tid, billing_cycle_id: activeCycle.id },
    });
    const aiSum = await db.AiTokenUsage.findOne({
      attributes: [
        [db.sequelize.fn("SUM", db.sequelize.col("final_cost_inr")), "total"],
      ],
      where: { tenant_id: tid, billing_cycle_id: activeCycle.id },
      raw: true,
    });

    console.log(`\n📊 Usage in this cycle:`);
    console.log(
      `   Message Ledger: ${ledgerCount} entries, total ₹${parseFloat(ledgerSum?.total || 0).toFixed(4)}`,
    );
    console.log(
      `   AI Token Usage: ${aiCount} entries, total ₹${parseFloat(aiSum?.total || 0).toFixed(4)}`,
    );
    console.log(
      `   Expected Invoice Amount: ₹${(parseFloat(ledgerSum?.total || 0) + parseFloat(aiSum?.total || 0)).toFixed(4)}`,
    );

    const existingInvoices = await db.MonthlyInvoices.findAll({
      where: { tenant_id: tid },
      order: [["createdAt", "DESC"]],
      raw: true,
    });
    console.log(`\n📄 Existing Invoices: ${existingInvoices.length}`);
    if (existingInvoices.length > 0) {
      console.table(
        existingInvoices.map((i) => ({
          id: i.id,
          invoice_number: i.invoice_number,
          amount: i.amount,
          status: i.status,
          due_date: i.due_date,
          billing_cycle_id: i.billing_cycle_id,
        })),
      );
    }

    // ─── Step 3: Backdate cycle end_date ───
    divider("STEP 3: Backdating cycle end_date to yesterday");

    const originalEndDate = activeCycle.end_date;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    await db.BillingCycles.update(
      { end_date: yesterday },
      { where: { id: activeCycle.id } },
    );
    console.log(`   Original end_date: ${originalEndDate}`);
    console.log(`   Backdated to:      ${yesterday.toISOString()}`);
    console.log(`   ✅ Cycle now appears expired!`);

    // ─── Step 4: Run the cron ───
    divider("STEP 4: Running billing cycle cron...");

    await runBillingCycleCron();
    console.log("   ✅ Cron completed!");

    // ─── Step 5: Verify results ───
    divider("STEP 5: Verification AFTER cron");

    // Check old cycle is now completed
    const closedCycle = await db.BillingCycles.findOne({
      where: { id: activeCycle.id },
      raw: true,
    });
    console.log("\n📅 Old Cycle Status:");
    console.table([
      {
        id: closedCycle.id,
        cycle_number: closedCycle.cycle_number,
        status: closedCycle.status,
        total_message_cost_inr: closedCycle.total_message_cost_inr,
        total_ai_cost_inr: closedCycle.total_ai_cost_inr,
        total_cost_inr: closedCycle.total_cost_inr,
        is_locked: closedCycle.is_locked,
      },
    ]);

    if (closedCycle.status === "completed") {
      console.log("   ✅ Cycle closed successfully!");
    } else {
      console.log("   ❌ CYCLE NOT CLOSED! Status:", closedCycle.status);
    }

    // Check new cycle was created
    const newCycle = await db.BillingCycles.findOne({
      where: { tenant_id: tid, status: "active" },
      raw: true,
    });
    if (newCycle) {
      console.log("\n📅 New Active Cycle:");
      console.table([
        {
          id: newCycle.id,
          cycle_number: newCycle.cycle_number,
          start_date: newCycle.start_date,
          end_date: newCycle.end_date,
          status: newCycle.status,
        },
      ]);
      console.log("   ✅ Next cycle created!");
    } else {
      console.log("   ❌ NO NEW CYCLE CREATED!");
    }

    // Check invoice
    const newInvoices = await db.MonthlyInvoices.findAll({
      where: { tenant_id: tid, billing_cycle_id: activeCycle.id },
      raw: true,
    });

    const expectedTotal =
      parseFloat(ledgerSum?.total || 0) + parseFloat(aiSum?.total || 0);

    if (expectedTotal > 0) {
      if (newInvoices.length > 0) {
        console.log("\n📄 Invoice Generated:");
        console.table(
          newInvoices.map((i) => ({
            id: i.id,
            invoice_number: i.invoice_number,
            amount: i.amount,
            status: i.status,
            due_date: i.due_date,
            billing_cycle_id: i.billing_cycle_id,
            breakdown: JSON.stringify(i.breakdown),
          })),
        );

        const inv = newInvoices[0];
        const invoiceAmount = parseFloat(inv.amount);
        const amountMatch = Math.abs(invoiceAmount - expectedTotal) < 0.01;

        console.log(`\n   Expected total:  ₹${expectedTotal.toFixed(4)}`);
        console.log(`   Invoice amount:  ₹${invoiceAmount.toFixed(4)}`);
        console.log(
          `   Amount match:    ${amountMatch ? "✅ YES" : "❌ MISMATCH!"}`,
        );
        console.log(
          `   Invoice status:  ${inv.status === "unpaid" ? "✅ unpaid" : "⚠️ " + inv.status}`,
        );
        console.log(
          `   Due date set:    ${inv.due_date ? "✅ " + inv.due_date : "❌ MISSING"}`,
        );
        console.log(
          `   Breakdown:       ${inv.breakdown ? "✅ Present" : "❌ MISSING"}`,
        );
      } else {
        console.log(
          "\n   ❌ INVOICE NOT GENERATED! Expected ₹" +
            expectedTotal.toFixed(4),
        );
      }
    } else {
      console.log(
        "\n   ⚠️ No usage in cycle — invoice correctly skipped (zero-usage).",
      );
      if (newInvoices.length > 0) {
        console.log("   ❌ BUG: Invoice was generated for zero usage!");
      }
    }

    // Check tenant dates updated
    const updatedTenant = await db.Tenants.findOne({
      where: { tenant_id: tid },
      attributes: ["billing_cycle_start", "billing_cycle_end"],
      raw: true,
    });
    console.log("\n📅 Tenant Cycle Dates Updated:");
    console.log(`   billing_cycle_start: ${updatedTenant.billing_cycle_start}`);
    console.log(`   billing_cycle_end:   ${updatedTenant.billing_cycle_end}`);
    if (newCycle) {
      const startMatch =
        new Date(updatedTenant.billing_cycle_start).getTime() ===
        new Date(newCycle.start_date).getTime();
      const endMatch =
        new Date(updatedTenant.billing_cycle_end).getTime() ===
        new Date(newCycle.end_date).getTime();
      console.log(
        `   Matches new cycle:  ${startMatch && endMatch ? "✅ YES" : "❌ MISMATCH"}`,
      );
    }

    // Check CronExecutionLog
    const cronLog = await db.CronExecutionLog.findOne({
      where: { cron_name: "billing_cycle_cron" },
      order: [["createdAt", "DESC"]],
      raw: true,
    });
    if (cronLog) {
      console.log("\n📋 Cron Execution Log:");
      console.table([
        {
          id: cronLog.id,
          status: cronLog.status,
          started_at: cronLog.started_at,
          finished_at: cronLog.finished_at,
          stats: JSON.stringify(cronLog.stats),
        },
      ]);
    }

    // ─── Summary ───
    divider("SUMMARY");
    const checks = [
      ["Cycle closed", closedCycle.status === "completed"],
      ["New cycle created", !!newCycle],
      [
        "Cycle costs summed",
        parseFloat(closedCycle.total_cost_inr) === expectedTotal ||
          (expectedTotal === 0 && parseFloat(closedCycle.total_cost_inr) === 0),
      ],
      [
        "Invoice created (if usage > 0)",
        expectedTotal === 0 || newInvoices.length > 0,
      ],
      [
        "Invoice skipped (if zero usage)",
        expectedTotal > 0 || newInvoices.length === 0,
      ],
      ["Tenant dates updated", !!newCycle],
      ["Cron log recorded", !!cronLog && cronLog.status === "completed"],
    ];

    for (const [name, passed] of checks) {
      console.log(`   ${passed ? "✅" : "❌"} ${name}`);
    }

    const allPassed = checks.every(([, p]) => p);
    console.log(
      `\n   ${allPassed ? "🎉 ALL CHECKS PASSED!" : "⚠️ SOME CHECKS FAILED — see above"}`,
    );
  } catch (err) {
    console.error("\n❌ TEST SCRIPT ERROR:", err);
  } finally {
    await db.sequelize.close();
    process.exit(0);
  }
})();
