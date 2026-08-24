/**
 * MyFitness — Booked Qty addition for the EXISTING order-logging Apps Script
 * (the project behind index.html's SHEET_WEBAPP_URL).
 *
 * This is NOT a new script to deploy on its own. It's a small, isolated
 * addition to paste into that existing project, so that submitting an order
 * immediately decrements Available Stock in the "Live Inventory" tab instead
 * of waiting for the next Gmail sync.
 *
 * INSTALL:
 *   1. Fill in LIVE_INVENTORY_SPREADSHEET_ID below (the spreadsheet behind
 *      MASTER_DATA_URLS.inventory in index.html — Live Inventory tab lives
 *      there, written by InventorySync.gs).
 *   2. Paste this whole file into the existing order-logging Apps Script
 *      project as a new script file (e.g. "BookedQty.gs").
 *   3. In that project's existing doPost(e) function, find the point AFTER
 *      the order row has already been appended to the Order History sheet
 *      (i.e. after the order is safely logged) and add exactly one line:
 *
 *          applyBookedQtyForOrder(payload);
 *
 *      where `payload` is whatever variable in that function already holds
 *      the parsed JSON request body (JSON.parse(e.postData.contents)) — the
 *      same object index.html's buildOrderPayload() sends, with a `.lines`
 *      array where each line has `.style`, `.qty`, `.validation`.
 *
 *      Placement matters: this must run AFTER the existing order-logging
 *      write, not instead of it or before it, and its own try/catch below
 *      means it can never fail or block the order response even if the
 *      Live Inventory sheet is unreachable.
 */

var LIVE_INVENTORY_SPREADSHEET_ID = 'FILL_IN_LIVE_INVENTORY_SPREADSHEET_ID';
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
      var bookedQty = (Number(sheet.getRange(rowNum, COL_BOOKED_QTY).getValue()) || 0) + (Number(line.qty) || 0);
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
