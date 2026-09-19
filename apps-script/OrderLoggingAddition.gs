/**
 * MyFitness — Auth + payload sanitization + Booked Qty addition for the
 * EXISTING order-logging Apps Script (the project behind index.html's
 * SHEET_WEBAPP_URL).
 *
 * This is NOT a new script to deploy on its own. It's a small, isolated
 * addition to paste into that existing project. It now does three things,
 * where it used to do only the third:
 *
 *   1. isAuthorized(payload) — rejects any request that doesn't carry the
 *      shared secret index.html sends (see WEBAPP_SHARED_SECRET there).
 *      This project's Web App is deployed "Who has access: Anyone" so the
 *      browser can reach it with no Google sign-in — which today means
 *      ANYONE with this URL (visible in index.html's own source) can POST a
 *      fabricated order with any price/margin/GST they want and have it
 *      logged as real, plus decrement real stock. This check is the gate
 *      for that.
 *   2. sanitizeOrderPayload(payload) — recomputes every line's discount/GST/
 *      total, and the order-level totals, from each line's own qty/
 *      unitPrice/discount using the exact same formula index.html uses
 *      (GST_RATE below). This does NOT second-guess unitPrice itself —
 *      manually overriding price per line is a real, intentional feature of
 *      this app (see priceTypeFor/"SPECIAL" in index.html), not something to
 *      block — it only makes sure the GST/total figures that get written to
 *      Order History are always arithmetically honest given whatever price
 *      was chosen, instead of trusting whatever numbers the client happened
 *      to send alongside it.
 *   3. applyBookedQtyForOrder(payload) — unchanged in purpose (decrements
 *      Available Stock immediately on submit), but now caps how much a
 *      single line can book so Booked Qty itself can never be pushed past
 *      Total Available, even if a line claims a validation of "Accepted"
 *      with an unrealistic quantity. Previously only the *displayed*
 *      Remaining Inventory was floored at 0 — Booked Qty itself had no
 *      ceiling, so one bad request could permanently inflate it beyond what
 *      a later real restock could ever correct.
 *
 * What this does NOT do: re-validate quantity against case-pack size or
 * live stock (that needs the Product Master / Live Inventory data this
 * script doesn't currently load) or second-guess the unit price itself.
 * Those remain client-side-only checks for now — a known, separate gap from
 * what this addition closes.
 *
 * INSTALL:
 *   1. Fill in LIVE_INVENTORY_SPREADSHEET_ID below (the spreadsheet behind
 *      MASTER_DATA_URLS.inventory in index.html — Live Inventory tab lives
 *      there, written by InventorySync.gs).
 *   2. Project Settings > Script Properties (in THIS existing project) >
 *      add SHARED_SECRET with the SAME random value you put in index.html's
 *      WEBAPP_SHARED_SECRET constant.
 *   3. Paste this whole file into the existing order-logging Apps Script
 *      project as a new script file (e.g. "BookedQty.gs").
 *   4. In that project's existing doPost(e) function, make TWO edits:
 *
 *      a) At the very TOP of doPost(e), before anything else runs
 *         (including parsing the body for logging), add:
 *
 *             var payload = JSON.parse(e.postData.contents);
 *             if(!isAuthorized(payload)){
 *               return ContentService.createTextOutput(JSON.stringify({status:'Failed', error:'Unauthorized'}))
 *                 .setMimeType(ContentService.MimeType.JSON);
 *             }
 *             payload = sanitizeOrderPayload(payload);
 *
 *         (skip the `var payload = JSON.parse(...)` line if that function
 *         already parses the body into a variable near the top — just add
 *         the isAuthorized/sanitizeOrderPayload lines right after it, and
 *         make sure every use of the parsed body further down in that
 *         function — the values actually written to Order History — reads
 *         from this same sanitized `payload`, not the raw parsed one.)
 *
 *      b) At the point AFTER the order row has already been appended to the
 *         Order History sheet, change the existing line (if you added it
 *         from an earlier version of this file):
 *
 *             applyBookedQtyForOrder(payload);
 *
 *         to use this same sanitized `payload` variable — not a re-parse of
 *         the raw request body.
 *
 *      Placement matters: the auth check must run before ANY processing —
 *      an unauthorized request should never reach the sheet at all — and
 *      applyBookedQtyForOrder's own try/catch means it can never fail or
 *      delay the order response even if the Live Inventory sheet is
 *      unreachable.
 */

// Must match index.html's GST_RATE constant exactly, or sanitized totals
// here will disagree with what the app itself displayed to the rep.
var GST_RATE = 0.05;

// See the file header above for what this checks and why it matters more
// here than on the read-only Web Apps in this project — this is the one
// endpoint that writes financial records and moves real inventory.
function isAuthorized(payload){
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if(!expected) return false; // fail closed — not configured yet means not authorized, not "allow everything"
  return String((payload && payload.secret) || '') === expected;
}

// Recomputes discount/GST/line total per line, and the order-level totals,
// purely from each line's own qty/unitPrice/discount — the same formula as
// index.html's evaluateLine()/buildOrderPayload(). Never touches unitPrice
// itself (manual price override is a legitimate feature); only makes sure
// everything DERIVED from it is arithmetically honest before it's logged.
function sanitizeOrderPayload(payload){
  if(!payload || !Array.isArray(payload.lines)) return payload;

  var totalBeforeGst = 0, totalDiscount = 0, totalGst = 0;
  payload.lines = payload.lines.map(function(line){
    var qty = Number(line.qty) || 0;
    var unitPrice = Number(line.unitPrice) || 0;
    var grossValue = qty * unitPrice;
    var discountAmt = Math.min(Math.max(Number(line.discount) || 0, 0), grossValue);
    var taxableValue = grossValue - discountAmt;
    var gstAmount = Math.round(taxableValue * GST_RATE * 100) / 100;
    var lineTotal = Math.round((taxableValue + gstAmount) * 100) / 100;

    if(line.validation === 'Accepted'){
      totalBeforeGst += grossValue;
      totalDiscount += discountAmt;
      totalGst += gstAmount;
    }

    return Object.assign({}, line, {
      discount: discountAmt.toFixed(2),
      gstAmount: gstAmount.toFixed(2),
      lineTotal: lineTotal.toFixed(2)
    });
  });

  payload.totalBeforeGst = totalBeforeGst.toFixed(2);
  payload.totalDiscount = totalDiscount.toFixed(2);
  payload.totalGst = totalGst.toFixed(2);
  payload.netOrderValue = (totalBeforeGst - totalDiscount + totalGst).toFixed(2);
  return payload;
}

// Confirmed 2026-08-24 via Drive: the "Live_Inventory_tab" spreadsheet,
// same one InventorySync.gs writes to and index.html's
// MASTER_DATA_URLS.inventory reads as CSV.
var LIVE_INVENTORY_SPREADSHEET_ID = '19K5gNBYtMYwPraUIIqJB06m1VwfdJq7AdGJUfgb9asA';
var LIVE_INVENTORY_SHEET_NAME = 'Live Inventory';

// Column positions match the header row InventorySync.gs writes:
// Style Code | SKU Name | Category | Size | Inventory Date | Bhiwandi Qty |
// GGN Qty | Total Available | Booked Qty | Remaining Inventory | ...
var COL_STYLE_CODE = 1;
var COL_TOTAL_AVAILABLE = 8;
var COL_BOOKED_QTY = 9;
var COL_REMAINING_INVENTORY = 10;

function applyBookedQtyForOrder(payload){
  try{
    if(!payload || !Array.isArray(payload.lines)) return;
    var acceptedLines = payload.lines.filter(function(l){ return l.validation === 'Accepted'; });
    if(acceptedLines.length === 0) return;

    var sheet = SpreadsheetApp.openById(LIVE_INVENTORY_SPREADSHEET_ID).getSheetByName(LIVE_INVENTORY_SHEET_NAME);
    if(!sheet) return; // Live Inventory tab not set up yet — booking still succeeds, just without live stock tracking

    var data = sheet.getDataRange().getValues();
    var rowIndexByStyle = {};
    for(var i = 1; i < data.length; i++){
      rowIndexByStyle[String(data[i][COL_STYLE_CODE - 1])] = i + 1; // 1-based sheet row
    }

    acceptedLines.forEach(function(line){
      var rowNum = rowIndexByStyle[String(line.style)];
      if(!rowNum) return; // SKU not in Live Inventory (never synced / unmatched) — nothing to decrement

      var totalAvailable = Number(sheet.getRange(rowNum, COL_TOTAL_AVAILABLE).getValue()) || 0;
      var existingBooked = Number(sheet.getRange(rowNum, COL_BOOKED_QTY).getValue()) || 0;
      var requestedQty = Math.max(0, Number(line.qty) || 0);
      // Cap what THIS line can add, not just the displayed Remaining figure
      // — without this, Booked Qty itself has no ceiling, so one line
      // claiming an unrealistic quantity (whether a bug or a forged
      // request) can push it arbitrarily far past Total Available, and a
      // later real restock would never fully correct it since Booked Qty
      // was already wrong, not just Remaining's floor-at-0 display of it.
      var roomLeft = Math.max(0, totalAvailable - existingBooked);
      var qtyToBook = Math.min(requestedQty, roomLeft);
      var bookedQty = existingBooked + qtyToBook;
      var remaining = Math.max(0, totalAvailable - bookedQty);

      sheet.getRange(rowNum, COL_BOOKED_QTY).setValue(bookedQty);
      sheet.getRange(rowNum, COL_REMAINING_INVENTORY).setValue(remaining);
    });
  } catch(err){
    // Deliberately swallowed — booked-qty bookkeeping must never fail or
    // delay an order submission. If this needs debugging, check
    // Apps Script's own Executions log for this project.
    console.error('applyBookedQtyForOrder failed: ' + (err && err.message ? err.message : err));
  }
}
