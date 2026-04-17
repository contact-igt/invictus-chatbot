// backend/src/controllers/invoice.controller.js

import { generateInvoicePdf } from "../utils/pdfGenerator.js";
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
export { downloadInvoicePdf };
