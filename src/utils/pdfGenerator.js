// backend/src/utils/pdfGenerator.js

import PDFDocument from "pdfkit";
import db from "../database/index.js";

const {
  MonthlyInvoices: MonthlyInvoice,
  Tenants: Tenant,
  BillingCycles: BillingCycle,
  PaymentHistory,
} = db;

// Helper: Convert number to words (Indian Rupees)
function numberToWords(amount) {
  // Only supports up to 99,99,99,999.99
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  const units = [
    { name: "Crore", value: 10000000 },
    { name: "Lakh", value: 100000 },
    { name: "Thousand", value: 1000 },
    { name: "Hundred", value: 100 },
  ];

  function numToWords(n) {
    let str = "";
    if (n > 99) {
      for (const u of units) {
        if (n >= u.value) {
          const q = Math.floor(n / u.value);
          str += numToWords(q) + " " + u.name + " ";
          n = n % u.value;
        }
      }
    }
    if (n > 19) {
      str += tens[Math.floor(n / 10)] + " ";
      n = n % 10;
    }
    if (n > 0) {
      str += ones[n] + " ";
    }
    return str.trim();
  }

  const [rupees, paise] = amount.toFixed(2).split(".");
  let words = "";
  const rupeeNum = parseInt(rupees, 10);
  const paiseNum = parseInt(paise, 10);
  if (rupeeNum === 0) {
    words = "Zero Rupees";
  } else {
    words = "Rupees " + numToWords(rupeeNum);
  }
  if (paiseNum > 0) {
    words += " and " + numToWords(paiseNum) + " Paise";
  }
  words += " Only";
  return words;
}

async function generateInvoicePdf(invoiceId, tenantId) {
  // Fetch invoice, billing cycle, tenant
  const whereClause = tenantId
    ? { id: invoiceId, tenant_id: tenantId }
    : { id: invoiceId };
  console.log("[PDF] Looking up invoice:", JSON.stringify(whereClause));
  const invoice = await MonthlyInvoice.findOne({ where: whereClause });
  if (!invoice) {
    console.error("[PDF] Invoice NOT FOUND for:", JSON.stringify(whereClause));
    throw { code: "NOT_FOUND", message: "Invoice not found", statusCode: 404 };
  }
  console.log("[PDF] Invoice found, tenant_id:", invoice.tenant_id);

  // Use raw SQL query to match the auth middleware lookup pattern exactly.
  // The Sequelize Tenant.findOne() was returning null despite the tenant
  // existing — likely a column-mapping or collation mismatch.
  const [tenantRows] = await db.sequelize.query(
    "SELECT * FROM tenants WHERE tenant_id = ? AND is_deleted = 0 LIMIT 1",
    { replacements: [invoice.tenant_id] },
  );
  const tenant = tenantRows[0];
  if (!tenant) {
    console.error("[PDF] Tenant NOT FOUND for tenant_id:", invoice.tenant_id);
    throw { code: "NOT_FOUND", message: "Tenant not found", statusCode: 404 };
  }

  const billingCycle = await BillingCycle.findOne({
    where: { id: invoice.billing_cycle_id },
  });
  const payment = await PaymentHistory.findOne({
    where: { invoice_number: invoice.invoice_number },
  });

  // Company details from env
  const company_name = process.env.COMPANY_NAME || "Your Company";
  const company_address = process.env.COMPANY_ADDRESS || "";
  const company_gstin = process.env.COMPANY_GSTIN || "";
  const company_cin = process.env.COMPANY_CIN || "";

  const is_intra_state = invoice.tenant_state === invoice.company_state;
  const invoiceGstRate = Number(invoice.gst_rate || 18);
  const halfInvoiceGstRate = invoiceGstRate / 2;

  const formatRateLabel = (rate) => {
    if (!Number.isFinite(rate)) return "0";
    return rate % 1 === 0
      ? rate.toFixed(0)
      : rate
        .toFixed(2)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*[1-9])0+$/, "$1");
  };

  // Create PDF document
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));

  // Return promise that resolves with buffer
  const pdfPromise = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Header
  doc.fontSize(20).font("Helvetica-Bold").text(company_name, { align: "left" });
  doc.fontSize(10).font("Helvetica").text(company_address);
  doc.text(`GSTIN: ${company_gstin} | CIN: ${company_cin}`);
  doc.moveDown();

  // Invoice details (right side)
  doc
    .fontSize(12)
    .font("Helvetica-Bold")
    .text("TAX INVOICE", { align: "right" });
  doc.fontSize(10).font("Helvetica");
  doc.text(`Invoice #: ${invoice.invoice_number || invoiceId}`, {
    align: "right",
  });
  doc.text(
    `Date: ${invoice.invoice_date ? invoice.invoice_date.toISOString().slice(0, 10) : ""}`,
    { align: "right" },
  );
  doc.text(
    `Due Date: ${invoice.due_date ? invoice.due_date.toISOString().slice(0, 10) : ""}`,
    { align: "right" },
  );
  doc.moveDown();

  // Line separator
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown();

  // Bill To section
  doc.fontSize(12).font("Helvetica-Bold").text("Bill To:");
  doc.fontSize(10).font("Helvetica");
  doc.text(tenant.company_name || tenant.name || "");
  doc.text(tenant.address || "");
  doc.text(`GSTIN: ${invoice.tenant_gstin || "Unregistered"}`);
  doc.text(`State: ${invoice.tenant_state || ""}`);
  doc.moveDown();

  // Line items table header
  const tableTop = doc.y;
  doc.fontSize(10).font("Helvetica-Bold");
  doc.text("Description", 50, tableTop);
  doc.text("Period", 280, tableTop);
  doc.text("Amount (INR)", 450, tableTop, { width: 95, align: "right" });

  doc
    .moveTo(50, tableTop + 15)
    .lineTo(545, tableTop + 15)
    .stroke();

  // Line items
  let y = tableTop + 25;
  doc.font("Helvetica");

  const cycleStart = billingCycle
    ? billingCycle.start_date.toISOString().slice(0, 10)
    : "";
  const cycleEnd = billingCycle
    ? billingCycle.end_date.toISOString().slice(0, 10)
    : "";
  const period = `${cycleStart} to ${cycleEnd}`;

  // WhatsApp charges
  doc.text("WhatsApp message charges", 50, y);
  doc.text(period, 280, y);
  doc.text(`${invoice.total_message_cost_inr || "0.00"}`, 450, y, {
    width: 95,
    align: "right",
  });
  y += 20;

  // AI charges
  doc.text("AI model usage charges", 50, y);
  doc.text(period, 280, y);
  doc.text(`${invoice.total_ai_cost_inr || "0.00"}`, 450, y, {
    width: 95,
    align: "right",
  });
  y += 20;

  // Subtotal
  doc.moveTo(50, y).lineTo(545, y).stroke();
  y += 10;
  doc.font("Helvetica-Bold");
  doc.text("Subtotal", 350, y);
  doc.text(`${invoice.base_amount || "0.00"}`, 450, y, {
    width: 95,
    align: "right",
  });
  y += 20;

  // Tax section
  doc.font("Helvetica");
  if (is_intra_state) {
    doc.text(`CGST @ ${formatRateLabel(halfInvoiceGstRate)}%`, 350, y);
    doc.text(`${invoice.cgst_amount || "0.00"}`, 450, y, {
      width: 95,
      align: "right",
    });
    y += 15;
    doc.text(`SGST @ ${formatRateLabel(halfInvoiceGstRate)}%`, 350, y);
    doc.text(`${invoice.sgst_amount || "0.00"}`, 450, y, {
      width: 95,
      align: "right",
    });
    y += 15;
  } else {
    doc.text(`IGST @ ${formatRateLabel(invoiceGstRate)}%`, 350, y);
    doc.text(`${invoice.igst_amount || "0.00"}`, 450, y, {
      width: 95,
      align: "right",
    });
    y += 15;
  }

  // Total
  doc.moveTo(350, y).lineTo(545, y).stroke();
  y += 10;
  doc.fontSize(12).font("Helvetica-Bold");
  doc.text("TOTAL", 350, y);
  doc.text(`INR ${invoice.total_amount || "0.00"}`, 450, y, {
    width: 95,
    align: "right",
  });
  y += 25;

  // Amount in words
  doc.fontSize(10).font("Helvetica-Oblique");
  doc.text(
    `Amount in words: ${numberToWords(Number(invoice.total_amount || 0))}`,
    50,
    y,
  );
  y += 30;

  // Payment details
  if (payment) {
    doc.font("Helvetica-Bold").text("Payment Details:", 50, y);
    y += 15;
    doc.font("Helvetica");
    doc.text(`Payment Method: ${payment.method || ""}`, 50, y);
    y += 12;
    doc.text(`Payment ID: ${payment.payment_id || ""}`, 50, y);
    y += 12;
    doc.text(
      `Payment Date: ${payment.paid_at ? payment.paid_at.toISOString().slice(0, 10) : ""}`,
      50,
      y,
    );
    y += 20;
  }

  // Status badge
  const status = invoice.status || "unpaid";
  const statusColors = {
    paid: "#27ae60",
    unpaid: "#f1c40f",
    overdue: "#e74c3c",
  };
  doc.rect(50, y, 60, 20).fill(statusColors[status] || "#f1c40f");
  doc.fillColor("#fff").fontSize(10).font("Helvetica-Bold");
  doc.text(status.toUpperCase(), 55, y + 5);
  doc.fillColor("#000");
  y += 40;

  // Footer
  doc.fontSize(9).font("Helvetica").fillColor("#666");
  doc.text(
    "This is a computer-generated invoice. No signature required.",
    50,
    y,
  );
  y += 12;
  doc.text("HSN/SAC: 998314 — Software as a Service", 50, y);
  y += 12;
  doc.text("Terms: Payment due within 15 days of invoice date.", 50, y);

  // Finalize PDF
  doc.end();

  return pdfPromise;
}

async function generateReceiptPdf(paymentId, tenantId) {
  const whereClause = tenantId
    ? { id: paymentId, tenant_id: tenantId }
    : { id: paymentId };
  console.log("[PDF] Looking up payment:", JSON.stringify(whereClause));
  const payment = await PaymentHistory.findOne({ where: whereClause });
  if (!payment) {
    console.error("[PDF] Payment NOT FOUND for:", JSON.stringify(whereClause));
    throw { code: "NOT_FOUND", message: "Payment receipt not found", statusCode: 404 };
  }

  // Look up tenant using raw SQL to be reliable
  const [tenantRows] = await db.sequelize.query(
    "SELECT * FROM tenants WHERE tenant_id = ? AND is_deleted = 0 LIMIT 1",
    { replacements: [payment.tenant_id] },
  );
  const tenant = tenantRows[0];
  if (!tenant) {
    console.error("[PDF] Tenant NOT FOUND for tenant_id:", payment.tenant_id);
    throw { code: "NOT_FOUND", message: "Tenant not found", statusCode: 404 };
  }

  // Company details from env
  const company_name = process.env.COMPANY_NAME || "Your Company";
  const company_address = process.env.COMPANY_ADDRESS || "";
  const company_gstin = process.env.COMPANY_GSTIN || "";
  const company_cin = process.env.COMPANY_CIN || "";

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));

  const pdfPromise = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Header
  doc.fontSize(20).font("Helvetica-Bold").text(company_name, { align: "left" });
  doc.fontSize(10).font("Helvetica").text(company_address);
  doc.text(`GSTIN: ${company_gstin} | CIN: ${company_cin}`);
  doc.moveDown();

  // Receipt details (right side)
  doc
    .fontSize(12)
    .font("Helvetica-Bold")
    .text("PAYMENT RECEIPT", { align: "right" });
  doc.fontSize(10).font("Helvetica");
  doc.text(`Receipt #: ${payment.invoice_number || `REC-${payment.id}`}`, {
    align: "right",
  });
  doc.text(
    `Date: ${new Date(payment.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`,
    { align: "right" },
  );
  doc.text(
    `Time: ${new Date(payment.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`,
    { align: "right" },
  );
  doc.moveDown();

  // Line separator
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown();

  // Bill To section
  doc.fontSize(12).font("Helvetica-Bold").text("Received From:");
  doc.fontSize(10).font("Helvetica");
  doc.text(tenant.company_name || tenant.name || "");
  doc.text(tenant.address || "");
  doc.text(`Tenant ID: ${tenant.tenant_id}`);
  doc.moveDown();

  // Transaction details table header
  const tableTop = doc.y;
  doc.fontSize(10).font("Helvetica-Bold");
  doc.text("Description", 50, tableTop);
  doc.text("Reference ID / Method", 250, tableTop);
  doc.text("Amount (INR)", 450, tableTop, { width: 95, align: "right" });

  doc
    .moveTo(50, tableTop + 15)
    .lineTo(545, tableTop + 15)
    .stroke();

  let y = tableTop + 25;
  doc.font("Helvetica");

  // Payment Details Row
  doc.text(payment.description || "Wallet Recharge", 50, y, { width: 190 });
  const methodAndId = `${payment.payment_method || "Online"} | ${payment.razorpay_payment_id || "N/A"}`;
  doc.text(methodAndId, 250, y, { width: 190 });
  
  const grossAmt = parseFloat(payment.gross_amount || payment.amount || 0);
  const baseAmt = parseFloat(payment.base_amount || payment.amount || 0);
  const gstAmt = parseFloat(payment.gst_amount || 0);
  
  doc.text(`${grossAmt.toFixed(2)}`, 450, y, {
    width: 95,
    align: "right",
  });
  y += 35;

  // Subtotal / Breakdown section
  doc.moveTo(50, y).lineTo(545, y).stroke();
  y += 10;
  
  doc.font("Helvetica-Bold");
  doc.text("Taxable Value (Credited)", 300, y);
  doc.text(`${baseAmt.toFixed(2)}`, 450, y, {
    width: 95,
    align: "right",
  });
  y += 20;

  doc.font("Helvetica");
  if (gstAmt > 0) {
    const isIntra = Boolean(payment.is_intra_state);
    if (isIntra) {
      const halfGst = (gstAmt / 2).toFixed(2);
      doc.text("CGST (9%)", 300, y);
      doc.text(`${halfGst}`, 450, y, { width: 95, align: "right" });
      y += 15;
      doc.text("SGST (9%)", 300, y);
      doc.text(`${halfGst}`, 450, y, { width: 95, align: "right" });
      y += 15;
    } else {
      doc.text("IGST (18%)", 300, y);
      doc.text(`${gstAmt.toFixed(2)}`, 450, y, { width: 95, align: "right" });
      y += 15;
    }
  } else {
    doc.text("GST (0%)", 300, y);
    doc.text("0.00", 450, y, { width: 95, align: "right" });
    y += 15;
  }

  // Total Paid
  doc.moveTo(300, y).lineTo(545, y).stroke();
  y += 10;
  doc.fontSize(12).font("Helvetica-Bold");
  doc.text("TOTAL PAID", 300, y);
  doc.text(`INR ${grossAmt.toFixed(2)}`, 450, y, {
    width: 95,
    align: "right",
  });
  y += 25;

  // Amount in words
  doc.fontSize(10).font("Helvetica-Oblique");
  doc.text(
    `Amount in words: ${numberToWords(grossAmt)}`,
    50,
    y,
  );
  y += 30;

  // Wallet details
  doc.fontSize(10).font("Helvetica-Bold").text("Wallet Balance Update:", 50, y);
  y += 15;
  doc.font("Helvetica");
  doc.text(`Balance Before: INR ${parseFloat(payment.balance_before || 0).toFixed(2)}`, 50, y);
  y += 12;
  doc.text(`Balance After: INR ${parseFloat(payment.balance_after || 0).toFixed(2)}`, 50, y);
  y += 30;

  // Status Badge
  const statusVal = payment.status || "success";
  const statusColors = {
    success: "#27ae60",
    paid: "#27ae60",
    pending: "#f1c40f",
    failed: "#e74c3c",
    refunded: "#7f8c8d"
  };
  doc.rect(50, y, 65, 20).fill(statusColors[statusVal] || "#27ae60");
  doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold");
  doc.text(statusVal.toUpperCase(), 50, y + 6, { width: 65, align: "center" });
  doc.fillColor("#000");
  y += 40;

  // Footer
  doc.fontSize(9).font("Helvetica").fillColor("#666");
  doc.text(
    "This is a computer-generated receipt. No signature required.",
    50,
    y,
  );
  y += 12;
  doc.text("HSN/SAC: 998314 — Software as a Service", 50, y);
  y += 12;
  doc.text("Thank you for using Whatnexus!", 50, y);

  doc.end();

  return pdfPromise;
}

export { generateInvoicePdf, generateReceiptPdf, numberToWords };
