import { generateInvoicePdf, generateReceiptPdf } from "../utils/pdfGenerator.js";
import db from "../database/index.js";

const { AdminAuditLog } = db;

async function downloadInvoicePdf(req, res, next) {
  try {
    const invoiceId = req.params.id;
    const tenantId = req.user?.tenant_id;
    const userId = req.user.id;
    const isSuperAdmin =
      req.user?.role === "super_admin" || req.user?.role === "platform_admin";
    // If SuperAdmin, allow any invoice; else restrict to tenant
    const pdfBuffer = await generateInvoicePdf(
      invoiceId,
      isSuperAdmin ? undefined : tenantId,
    );
    // Log to AdminAuditLog
    await AdminAuditLog.create({
      action_type: "invoice_download",
      user_id: userId,
      tenant_id: tenantId,
      entity_id: invoiceId,
      before_state: null,
      after_state: null,
      meta: { ip: req.ip, user_agent: req.headers["user-agent"] },
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=INV-${invoiceId}.pdf`,
    );
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

async function downloadReceiptPdf(req, res, next) {
  try {
    const paymentId = req.params.id;
    const tenantId = req.user?.tenant_id;
    const userId = req.user.id;
    const isSuperAdmin =
      req.user?.role === "super_admin" || req.user?.role === "platform_admin";
    // If SuperAdmin, allow any receipt; else restrict to tenant
    const pdfBuffer = await generateReceiptPdf(
      paymentId,
      isSuperAdmin ? undefined : tenantId,
    );
    // Log to AdminAuditLog
    await AdminAuditLog.create({
      action_type: "receipt_download",
      user_id: userId,
      tenant_id: tenantId,
      entity_id: paymentId,
      before_state: null,
      after_state: null,
      meta: { ip: req.ip, user_agent: req.headers["user-agent"] },
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Receipt-${paymentId}.pdf`,
    );
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

export { downloadInvoicePdf, downloadReceiptPdf };
