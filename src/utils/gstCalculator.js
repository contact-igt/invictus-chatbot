// backend/src/utils/gstCalculator.js

/**
 * GST Calculator Utility
 * All monetary math is done in paise (integer) to avoid floating-point errors.
 *
 * GST Model (INCLUSIVE — all payments):
 *   gross_amount = what the tenant pays
 *   base_amount  = gross / (1 + rate/100)  (wallet credit / taxable value)
 *   gst_amount   = gross - base  (authoritative tax amount)
 *   CGST = SGST  = gst / 2      (intra-state, derived from gstPaise — no extra rounding)
 *   IGST         = gst           (inter-state, exact)
 *
 * GST Model (EXCLUSIVE — postpaid invoices, tax added on top):
 *   Use addGstOnTop(baseAmount, tenantState, companyState, gstRate)
 *
 * Both calculateGST() and addGstOnTop() accept an explicit gstRate parameter.
 * Callers MUST fetch the current rate with getActiveGSTRate() from
 * taxSettings.service.js before calling these functions. The DEFAULT_GST_RATE
 * constant (18.0) is kept only as a last-resort fallback.
 */

/** Fallback only — do NOT use as the runtime rate. Fetch from DB via getActiveGSTRate(). */
const DEFAULT_GST_RATE = 18.0;
const HSN_SAC_CODE = process.env.HSN_SAC_CODE || "998314";

function round2(num) {
  // Always round to 2 decimal places, returned as string
  return (Math.round(num * 100) / 100).toFixed(2);
}

/**
 * GST-INCLUSIVE calculation (prepaid wallet recharges).
 * The tenant already paid gross_amount; wallet gets base_amount only.
 *
 * @param {string|number} grossAmount - Amount the tenant paid (INR)
 * @param {string} tenantState        - Tenant's state code (e.g. "TN")
 * @param {string} companyState       - Company's state code (e.g. "TN")
 * @param {number} [gstRate=18.0]     - Active GST % from getActiveGSTRate(). REQUIRED for
 *                                      correct dynamic behaviour; falls back to 18 only if omitted.
 */
function calculateGST(grossAmount, tenantState, companyState, gstRate = DEFAULT_GST_RATE) {
  const gross = Number(grossAmount);
  if (isNaN(gross) || gross <= 0)
    throw {
      code: "INVALID_AMOUNT",
      message: "Gross amount must be positive",
      statusCode: 400,
    };

  const rate = Number(gstRate);
  if (isNaN(rate) || rate < 0 || rate > 100)
    throw {
      code: "INVALID_GST_RATE",
      message: "GST rate must be between 0 and 100",
      statusCode: 400,
    };

  // Work entirely in paise to avoid float errors
  const divisor = 1 + rate / 100; // e.g. 1.18 for 18%
  const grossPaise = Math.round(gross * 100);
  const basePaise  = Math.round(grossPaise / divisor);
  const gstPaise   = grossPaise - basePaise; // authoritative — no independent rounding

  const base_amount = round2(basePaise / 100);
  const gst_amount  = round2(gstPaise / 100);

  const is_intra_state =
    Boolean(tenantState && companyState && tenantState === companyState);

  let cgst_amount = "0.00";
  let sgst_amount = "0.00";
  let igst_amount = "0.00";

  if (is_intra_state) {
    // Derive CGST/SGST from the authoritative gstPaise — no independent rounding.
    // Floor the first half; second half absorbs any odd paise so CGST+SGST = gstPaise exactly.
    const cgstPaise = Math.floor(gstPaise / 2);
    const sgstPaise = gstPaise - cgstPaise;
    cgst_amount = round2(cgstPaise / 100);
    sgst_amount = round2(sgstPaise / 100);
  } else {
    // IGST = gst_amount exactly
    igst_amount = round2(gstPaise / 100);
  }

  return {
    gross_amount: round2(gross),
    base_amount,
    gst_amount,
    gst_rate: rate,
    is_intra_state,
    cgst_amount,
    sgst_amount,
    igst_amount,
  };
}

/**
 * GST-EXCLUSIVE calculation (postpaid invoices — tax added on top of usage cost).
 *
 * @param {number} baseAmount         - Taxable usage cost (INR)
 * @param {string} tenantState
 * @param {string} companyState
 * @param {number} [gstRate=18.0]     - Active GST % from getActiveGSTRate(). REQUIRED for
 *                                      correct dynamic behaviour; falls back to 18 only if omitted.
 * @returns {{ base_amount, gst_amount, gross_amount, is_intra_state, cgst_amount, sgst_amount, igst_amount, gst_rate }}
 */
function addGstOnTop(baseAmount, tenantState, companyState, gstRate = DEFAULT_GST_RATE) {
  const base = Number(baseAmount);
  if (isNaN(base) || base < 0)
    throw {
      code: "INVALID_AMOUNT",
      message: "Base amount must be non-negative",
      statusCode: 400,
    };

  const rate = Number(gstRate);
  if (isNaN(rate) || rate < 0 || rate > 100)
    throw {
      code: "INVALID_GST_RATE",
      message: "GST rate must be between 0 and 100",
      statusCode: 400,
    };

  // Work in paise
  const basePaise  = Math.round(base * 100);
  const gstPaise   = Math.round(basePaise * (rate / 100));
  const grossPaise = basePaise + gstPaise;

  const gst_amount   = round2(gstPaise / 100);
  const gross_amount = round2(grossPaise / 100);
  const base_amount  = round2(basePaise / 100);

  const is_intra_state =
    Boolean(tenantState && companyState && tenantState === companyState);

  let cgst_amount = "0.00";
  let sgst_amount = "0.00";
  let igst_amount = "0.00";

  if (is_intra_state) {
    const cgstPaise = Math.floor(gstPaise / 2);
    const sgstPaise = gstPaise - cgstPaise;
    cgst_amount = round2(cgstPaise / 100);
    sgst_amount = round2(sgstPaise / 100);
  } else {
    igst_amount = round2(gstPaise / 100);
  }

  return {
    base_amount,
    gst_amount,
    gross_amount,
    gst_rate: rate,
    is_intra_state,
    cgst_amount,
    sgst_amount,
    igst_amount,
  };
}

/**
 * Returns the wallet credit amount (base_amount) for a given gross payment.
 * @param {number} grossAmount
 * @param {number} [gstRate=18.0] - Active GST % from getActiveGSTRate()
 */
function getWalletCreditAmount(grossAmount, gstRate = DEFAULT_GST_RATE) {
  const gross = Number(grossAmount);
  if (isNaN(gross) || gross <= 0)
    throw {
      code: "INVALID_AMOUNT",
      message: "Gross amount must be positive",
      statusCode: 400,
    };
  const divisor = 1 + Number(gstRate) / 100;
  const basePaise = Math.round((gross * 100) / divisor);
  return (basePaise / 100).toFixed(2);
}

function formatGSTBreakdown(gstResult) {
  const {
    gross_amount,
    base_amount,
    gst_amount,
    gst_rate,
    is_intra_state,
    cgst_amount,
    sgst_amount,
    igst_amount,
  } = gstResult;
  const rateLabel = `${gst_rate ?? DEFAULT_GST_RATE}%`;
  let breakdown = `₹${gross_amount} paid → ₹${base_amount} credited to wallet + ₹${gst_amount} GST (${rateLabel})`;
  if (is_intra_state) {
    breakdown += ` [CGST: ₹${cgst_amount}, SGST: ₹${sgst_amount}]`;
  } else {
    breakdown += ` [IGST: ₹${igst_amount}]`;
  }
  return breakdown;
}

export {
  calculateGST,
  addGstOnTop,
  getWalletCreditAmount,
  formatGSTBreakdown,
  DEFAULT_GST_RATE,
  HSN_SAC_CODE,
};
