/**
 * MyFitness — Gmail Inventory Sync (Google Apps Script)
 *
 * Bound to the "Live Inventory" Google Sheet — the same spreadsheet already
 * published as CSV and read by MASTER_DATA_URLS.inventory in index.html.
 *
 * Runs under sanjeev.khakre@mensabrands.com, who receives the daily
 * inventory email directly — he's on tech@mensabrands.com's automated
 * report distribution list. (An earlier version of this script ran under
 * claude7@mensabrands.com against a manually-forwarded copy instead, but
 * that account's Workspace admin has the Gmail/Mail service disabled —
 * GmailApp fails there with "Mail service not enabled" — so this reads
 * the original email directly instead of depending on a daily forward.)
 *
 * What this script does:
 *   1. Finds the latest unprocessed "Myfitness B2B inventory view" email
 *      from tech@mensabrands.com.
 *   2. Reads its .xlsx attachment (falls back to the HTML body table if the
 *      attachment is missing).
 *   3. Matches each row's style_id against the Product Master (read-only —
 *      this script NEVER writes to the Product Master).
 *   4. Writes matched SKUs into the "Live Inventory" tab, unmatched ones
 *      into "Unmatched SKUs", and a summary row into "Inventory Sync History".
 *   5. Records the Gmail message ID in "Processed Emails" so the same email
 *      is never processed twice.
 *
 * See LIVE_INVENTORY_SETUP_GUIDE.md for one-time setup (enabling the Drive
 * Advanced Service, installing the trigger, deploying the Web App).
 */

// ============================================================================
// CONFIG — fill in / confirm once
// ============================================================================
var CONFIG = {
  // "MyFitness_Master_Data" spreadsheet — used READ-ONLY to validate incoming
  // SKUs. Same spreadsheet ID already used in index.html's MASTER_DATA_URLS.
  MASTER_DATA_SPREADSHEET_ID: '1IguT54kTk5z0HLWQO8FL0vgg12QIS6Domk0xRR-5QZ0',
  // gids taken directly from index.html's MASTER_DATA_URLS — looked up by
  // sheet ID rather than tab name, so a tab rename in the Sheet UI can't
  // silently break this.
  PRODUCT_GID_GT: 639235062,
  PRODUCT_GID_SUPPLEMENT: 1572320868,

  // This script runs under sanjeev.khakre@mensabrands.com (see header
  // comment for why), who is directly on tech@mensabrands.com's automated
  // report distribution list — no forward involved, so this filters on
  // the real original sender.
  GMAIL_SEARCH: 'from:tech@mensabrands.com subject:"Myfitness B2B inventory view" newer_than:3d',
  ATTACHMENT_NAME_HINT: 'inventory',

  // gid of the tab already published as CSV at index.html's
  // MASTER_DATA_URLS.inventory (confirmed 2026-08-24: the real spreadsheet
  // is "Live_Inventory_tab", file ID 19K5gNBYtMYwPraUIIqJB06m1VwfdJq7AdGJUfgb9asA).
  // Looked up by gid, NOT by tab name — the actual tab's name inside that
  // file is unconfirmed, and matching by name risks silently creating a
  // second, unpublished tab that index.html never sees while the real one
  // stays stale forever. Leave blank only for a brand-new setup with no
  // existing published tab yet, in which case SHEET_LIVE_INVENTORY (by
  // name) is used to create one from scratch.
  LIVE_INVENTORY_GID: 212855391,
  SHEET_LIVE_INVENTORY: 'Live Inventory',
  SHEET_SYNC_HISTORY: 'Inventory Sync History',
  SHEET_UNMATCHED_SKUS: 'Unmatched SKUs',
  SHEET_PROCESSED_EMAILS: 'Processed Emails'
};

var LIVE_INVENTORY_HEADERS = [
  'Style Code', 'SKU Name', 'Category', 'Size', 'Inventory Date',
  'Bhiwandi Qty', 'GGN Qty', 'Total Available', 'Booked Qty',
  'Remaining Inventory', 'Last Sync Date & Time', 'Source Email Ref', 'Sync Status'
];
var SYNC_HISTORY_HEADERS = [
  'Sync Run At', 'Email Received At', 'Inventory Date', 'SKUs Received',
  'SKUs Matched', 'SKUs Unmatched', 'Records Updated', 'Sync Status', 'Error Details'
];
var UNMATCHED_SKU_HEADERS = [
  'Style ID', 'Category', 'Size', 'Bhiwandi Qty', 'GGN Qty', 'Email Date', 'Message ID', 'First Seen At'
];
var PROCESSED_EMAILS_HEADERS = ['Message ID', 'Email Date', 'Processed At'];

// ============================================================================
// ENTRY POINTS
// ============================================================================

// Menu button for anyone opening the Sheet directly.
function onOpen(){
  SpreadsheetApp.getUi()
    .createMenu('Inventory Sync')
    .addItem('Sync Now', 'syncInventoryFromGmail')
    .addItem('Install Daily Trigger (run once)', 'createDailyTrigger')
    .addItem('List Tab GIDs (for Publish to web)', 'listSheetGids')
    .addToUi();
}

// Shows every tab's name + gid in a popup — the gid is what the "Publish to
// web" CSV link needs, and reading it from a popup here is far less
// error-prone than the Publish dialog's sheet-picker dropdown (which can
// silently keep whatever was previously published if you don't explicitly
// reselect from its list) or hunting through the browser's URL bar per tab.
function listSheetGids(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lines = ss.getSheets().map(function(s){
    return s.getSheetName() + '  →  gid=' + s.getSheetId();
  });
  SpreadsheetApp.getUi().alert('Tab GIDs', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

// Web App entry point — called by index.html's "Sync Inventory Now" button.
// Deployed separately from the existing order-logging Web App on purpose,
// so this script's deployment/authorization never touches that one.
function doPost(e){
  var result = syncInventoryFromGmail();
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet(e){
  return doPost(e);
}

// Run this once from the Apps Script editor (Run > createDailyTrigger) to
// install the background sync. Safe to run more than once — it clears any
// existing triggers for syncInventoryFromGmail first, so re-running this
// doesn't stack up duplicate triggers.
function createDailyTrigger(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === 'syncInventoryFromGmail') ScriptApp.deleteTrigger(t);
  });
  // The email lands ~10:30 AM IST; hourly through early afternoon comfortably
  // covers the send plus any forwarding delay. Repeated firings are harmless
  // — the Processed Emails ledger makes every run after the first a no-op.
  [9, 10, 11, 12, 13, 14].forEach(function(hour){
    ScriptApp.newTrigger('syncInventoryFromGmail').timeBased().atHour(hour).everyDays(1).inTimezone('Asia/Kolkata').create();
  });
}

// ============================================================================
// CORE SYNC
// ============================================================================
function syncInventoryFromGmail(){
  var runAt = new Date();
  var summary = {
    status: 'Failed', error: '', emailReceivedAt: '', inventoryDate: '',
    skusReceived: 0, skusMatched: 0, skusUnmatched: 0, recordsUpdated: 0
  };

  try{
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var processedIds = getProcessedMessageIds(ss);

    var threads = GmailApp.search(CONFIG.GMAIL_SEARCH, 0, 20);
    var candidates = [];
    threads.forEach(function(thread){
      thread.getMessages().forEach(function(msg){
        if(processedIds.indexOf(msg.getId()) === -1) candidates.push(msg);
      });
    });
    candidates.sort(function(a, b){ return b.getDate().getTime() - a.getDate().getTime(); });

    if(candidates.length === 0){
      summary.status = 'No New Email';
      appendSyncHistoryRow(ss, runAt, summary);
      return summary;
    }

    var message = candidates[0];
    summary.emailReceivedAt = message.getDate();
    summary.inventoryDate = message.getDate(); // the email's own date is the inventory's effective date

    var rows = extractInventoryRows(message);
    if(rows.isPartial) summary.status = 'Partial';
    var parsed = normalizeInventoryRows(rows.rows);
    summary.skusReceived = parsed.length;

    var productMaster = readProductMasterStyleCodes();
    var liveInventorySheet = getLiveInventorySheet(ss);
    var updated = 0, matched = 0, unmatched = 0;
    var lastSyncStamp = new Date();
    var sourceRef = message.getId() + ' (' + Utilities.formatDate(summary.emailReceivedAt, 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm') + ')';

    parsed.forEach(function(row){
      var masterEntry = productMaster[row.styleId];
      if(masterEntry){
        matched++;
        upsertLiveInventoryRow(liveInventorySheet, row, masterEntry.desc, lastSyncStamp, sourceRef, 'OK');
        updated++;
      } else {
        unmatched++;
        appendUnmatchedSkuRow(ss, row, summary.emailReceivedAt, message.getId());
      }
    });

    summary.skusMatched = matched;
    summary.skusUnmatched = unmatched;
    summary.recordsUpdated = updated;
    if(summary.status !== 'Partial') summary.status = 'Success';

    markMessageProcessed(ss, message.getId(), summary.emailReceivedAt);
    appendSyncHistoryRow(ss, runAt, summary);
    return summary;

  } catch(err){
    summary.status = 'Failed';
    summary.error = String(err && err.message ? err.message : err);
    try{
      appendSyncHistoryRow(SpreadsheetApp.getActiveSpreadsheet(), runAt, summary);
    } catch(err2){ /* even history logging failed — summary.error still gets returned below */ }
    return summary;
  }
}

// ============================================================================
// EMAIL EXTRACTION
// ============================================================================

// Prefers the .xlsx attachment (full data); falls back to the truncated
// HTML body table only if no attachment is present.
function extractInventoryRows(message){
  var attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
  var target = attachments.find(function(a){
    return a.getName().toLowerCase().indexOf(CONFIG.ATTACHMENT_NAME_HINT) !== -1 &&
      /\.(xlsx|xls)$/i.test(a.getName());
  });

  if(target){
    return { rows: xlsxBlobToRows(target.copyBlob()), isPartial: false };
  }

  // Fallback — the body only ever shows the first ~10 rows ("Showing 10 of
  // 45 rows"), so this path is explicitly flagged as Partial in the caller.
  return { rows: parseHtmlBodyTable(message.getBody()), isPartial: true };
}

// Converts an .xlsx blob to rows via a temporary Google Sheet (Apps Script
// has no native XLSX reader). Requires the "Drive API" Advanced Service to
// be enabled on this project — see the setup guide.
//
// Creation uses the Advanced Drive Service (Files.create, "name" not
// "title", conversion driven by the target mimeType) — v2's Files.insert
// throws "is not a function" against the v3 service Apps Script enables by
// default today. Cleanup deliberately uses the simpler built-in DriveApp
// instead of the Advanced Service's own delete/remove method: two guesses
// at that method's actual name (Files.delete, then reverting to
// Files.remove) both failed against the real project, so this sidesteps
// needing to know it at all. Cleanup is also wrapped in its own try/catch
// — a failure to trash the temp file must never mask a successful read
// (which is exactly what happened here: the read succeeded and this
// function still reported failure because cleanup threw in the `finally`
// block, overriding the return above it).
function xlsxBlobToRows(blob){
  var tempFile = Drive.Files.create(
    { name: 'tmp_inventory_import_' + new Date().getTime(), mimeType: MimeType.GOOGLE_SHEETS },
    blob
  );
  try{
    var tempSs = SpreadsheetApp.openById(tempFile.id);
    var sheet = tempSs.getSheets()[0];
    var values = sheet.getDataRange().getValues();
    return valuesToObjects(values);
  } finally {
    try{ DriveApp.getFileById(tempFile.id).setTrashed(true); }
    catch(cleanupErr){ /* best-effort only — an orphaned temp file is harmless */ }
  }
}

function valuesToObjects(values){
  if(values.length === 0) return [];
  var headers = values[0].map(function(h){ return String(h || '').trim(); });
  return values.slice(1).map(function(r){
    var obj = {};
    headers.forEach(function(h, i){ obj[h] = r[i] !== undefined ? r[i] : ''; });
    return obj;
  });
}

// Best-effort parse of the Markdown/HTML-ish pipe table Metabase puts in the
// body when there's no attachment. Only ever covers the first ~10 rows.
function parseHtmlBodyTable(body){
  var lines = body.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  var tableLines = lines.filter(function(l){ return l.indexOf('|') !== -1 && l.indexOf('style_id') === -1 && !/^\|?-+\|/.test(l); });
  var headerLine = lines.find(function(l){ return l.toLowerCase().indexOf('style_id') !== -1; });
  if(!headerLine) return [];
  var headers = headerLine.split('|').map(function(h){ return h.trim(); }).filter(Boolean);
  return tableLines.map(function(line){
    var cells = line.split('|').map(function(c){ return c.trim(); }).filter(function(c, i, arr){ return !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''); });
    var obj = {};
    headers.forEach(function(h, i){ obj[h] = cells[i] !== undefined ? cells[i] : ''; });
    return obj;
  });
}

// ============================================================================
// PARSING / NORMALIZATION
// ============================================================================

// Mirrors index.html's pickCol()/csvNum() alias-matching so header wording
// drift between the two doesn't need two separate fixes.
function pickCol(row, aliases){
  var keys = Object.keys(row);
  for(var i = 0; i < aliases.length; i++){
    var norm = aliases[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    var key = keys.find(function(k){ return k.toLowerCase().replace(/[^a-z0-9]/g, '') === norm; });
    if(key !== undefined && row[key] !== '' && row[key] !== null) return row[key];
  }
  return '';
}
function numFrom(v, fallback){
  if(typeof v === 'number') return v;
  var n = parseFloat(String(v || '').replace(/[₹,\s]/g, ''));
  return isNaN(n) ? fallback : n;
}

function normalizeInventoryRows(rows){
  var seen = {};
  var out = [];
  rows.forEach(function(r){
    var styleId = String(pickCol(r, ['style_id', 'Style Code', 'Style', 'SKU'])).trim();
    if(!styleId || styleId.toUpperCase() === 'TOTAL') return; // blank / grand-total row — skip, not fatal
    var row = {
      styleId: styleId,
      category: String(pickCol(r, ['category', 'Category'])).trim(),
      size: String(pickCol(r, ['size', 'Size'])).trim(),
      bhiwandi: numFrom(pickCol(r, ['b2b_mumbai', 'Bhiwandi Qty', 'Bhiwandi']), 0),
      ggn: numFrom(pickCol(r, ['b2b_ggn', 'GGN Qty', 'GGN']), 0)
    };
    if(seen[styleId] !== undefined){
      out[seen[styleId]] = row; // duplicate style_id in the file — last occurrence wins
    } else {
      seen[styleId] = out.length;
      out.push(row);
    }
  });
  return out;
}

// Reads Product Master GT + Supplement tabs (by gid, matching
// MASTER_DATA_URLS in index.html) purely to validate/describe incoming
// SKUs. Read-only — never written back to.
function readProductMasterStyleCodes(){
  var ss = SpreadsheetApp.openById(CONFIG.MASTER_DATA_SPREADSHEET_ID);
  var map = {};
  [CONFIG.PRODUCT_GID_GT, CONFIG.PRODUCT_GID_SUPPLEMENT].forEach(function(gid){
    var sheet = ss.getSheets().find(function(s){ return s.getSheetId() === gid; });
    if(!sheet) return;
    var objs = valuesToObjects(sheet.getDataRange().getValues());
    objs.forEach(function(r){
      var style = String(pickCol(r, ['Style', 'Style Code', 'SKU'])).trim();
      if(!style) return;
      map[style] = { desc: String(pickCol(r, ['Description', 'Product Description', 'Desc'])).trim() };
    });
  });
  return map;
}

// ============================================================================
// SHEET WRITES
// ============================================================================
function getOrCreateSheet(ss, name, headers){
  var sheet = ss.getSheetByName(name);
  if(!sheet){
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Looks up the Live Inventory tab by gid first (CONFIG.LIVE_INVENTORY_GID —
// the tab already published as CSV and read by index.html), falling back to
// a name-based getOrCreateSheet only when no gid is configured or that gid
// doesn't exist yet (a brand-new setup with nothing published so far).
// Always re-asserts the header row so an existing tab with an older/shorter
// header layout (e.g. just Style Code/Bhiwandi Qty/GGN Qty/Last Synced)
// gets upgraded to match the columns this script actually writes, instead
// of silently drifting out of sync with row 1.
function getLiveInventorySheet(ss){
  var sheet = null;
  if(CONFIG.LIVE_INVENTORY_GID){
    sheet = ss.getSheets().find(function(s){ return s.getSheetId() === CONFIG.LIVE_INVENTORY_GID; });
  }
  if(!sheet) sheet = getOrCreateSheet(ss, CONFIG.SHEET_LIVE_INVENTORY, LIVE_INVENTORY_HEADERS);
  sheet.getRange(1, 1, 1, LIVE_INVENTORY_HEADERS.length).setValues([LIVE_INVENTORY_HEADERS]);
  sheet.setFrozenRows(1);
  return sheet;
}

function findRowByValue(sheet, columnIndex1Based, value){
  var data = sheet.getDataRange().getValues();
  for(var i = 1; i < data.length; i++){
    if(String(data[i][columnIndex1Based - 1]) === String(value)) return i + 1; // 1-based sheet row
  }
  return -1;
}

function upsertLiveInventoryRow(sheet, row, skuName, syncStamp, sourceRef, status){
  var total = row.bhiwandi + row.ggn;
  var rowValues = [
    row.styleId, skuName, row.category, row.size,
    Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy'),
    row.bhiwandi, row.ggn, total,
    0,          // Booked Qty reset — this is a fresh day's stock
    total,      // Remaining Inventory starts equal to Total Available
    syncStamp, sourceRef, status
  ];
  var existingRow = findRowByValue(sheet, 1, row.styleId);
  if(existingRow === -1){
    sheet.appendRow(rowValues);
  } else {
    sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
  }
}

function appendUnmatchedSkuRow(ss, row, emailDate, messageId){
  var sheet = getOrCreateSheet(ss, CONFIG.SHEET_UNMATCHED_SKUS, UNMATCHED_SKU_HEADERS);
  // Keep a single row per style_id per day rather than piling up one row
  // per sync-run retry for the same unmatched SKU.
  var data = sheet.getDataRange().getValues();
  var todayStr = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy');
  for(var i = 1; i < data.length; i++){
    if(String(data[i][0]) === row.styleId){
      var firstSeenDate = Utilities.formatDate(new Date(data[i][7]), 'Asia/Kolkata', 'dd-MMM-yyyy');
      if(firstSeenDate === todayStr) return; // already logged today
    }
  }
  sheet.appendRow([row.styleId, row.category, row.size, row.bhiwandi, row.ggn, emailDate, messageId, new Date()]);
}

function appendSyncHistoryRow(ss, runAt, summary){
  var sheet = getOrCreateSheet(ss, CONFIG.SHEET_SYNC_HISTORY, SYNC_HISTORY_HEADERS);
  sheet.appendRow([
    runAt, summary.emailReceivedAt || '', summary.inventoryDate || '',
    summary.skusReceived, summary.skusMatched, summary.skusUnmatched,
    summary.recordsUpdated, summary.status, summary.error || ''
  ]);
}

function getProcessedMessageIds(ss){
  var sheet = getOrCreateSheet(ss, CONFIG.SHEET_PROCESSED_EMAILS, PROCESSED_EMAILS_HEADERS);
  sheet.hideSheet();
  var data = sheet.getDataRange().getValues();
  return data.slice(1).map(function(r){ return r[0]; });
}

function markMessageProcessed(ss, messageId, emailDate){
  var sheet = getOrCreateSheet(ss, CONFIG.SHEET_PROCESSED_EMAILS, PROCESSED_EMAILS_HEADERS);
  sheet.appendRow([messageId, emailDate, new Date()]);
}
