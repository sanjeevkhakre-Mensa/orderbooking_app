/**
 * MyFitness — Proforma Invoice Search (Google Apps Script)
 *
 * Read-only lookup: given a search query, finds matching orders by Order
 * Number, Customer Name, or Date, cross-referencing the Order History
 * sheet — and for each matching order, checks whether an invoice PDF
 * exists for it in one designated Google Drive folder, returning a
 * viewable/downloadable link when it does.
 *
 * The invoice PDF itself is created and saved into that Drive folder
 * separately, outside this app — this script never creates, writes, or
 * deletes anything. It only reads the Order History sheet and the Drive
 * folder, and (only for a file it actually returns to the caller) makes
 * that one file link-viewable so the ASM's browser can open it without
 * being signed into any particular Google account.
 *
 * Matching is deliberately loose — a plain case-insensitive "contains this
 * text" against every field, no minimum length and no required format, so
 * a single letter, a two-digit day, a month name, or a fragment of a
 * customer name all work exactly the same way:
 *   1. Order Number / Customer Name / Date (as shown, e.g. "08-Sep-2026")
 *      — each checked against every row in the Order History sheet.
 *   2. Invoice filename in the Drive folder itself — independent of the
 *      sheet, so a PDF saved under something other than the exact Order
 *      Number (a customer name typed into the filename, a typo, an order
 *      placed before it was logged) still surfaces. This is what makes
 *      searching "ajfan" find "Ajfan International.pdf" even when nothing
 *      in Order History matches that text.
 * Every order matching any of the above is returned, deduplicated by
 * Order Number.
 *
 * Deployed as its own, separate Web App — same reasoning as every other
 * integration in this project (order logging, inventory sync, image scan):
 * one broken/misconfigured deployment should never take another down with
 * it.
 *
 * SETUP:
 *   1. Fill in CONFIG.INVOICE_FOLDER_ID below — the Drive folder where
 *      Proforma Invoice PDFs are saved (see INVOICE_SEARCH_SETUP_GUIDE.md
 *      for how to find a folder's ID from its URL).
 *   2. Fill in CONFIG.ORDER_HISTORY_SPREADSHEET_ID — the same spreadsheet
 *      the order-logging Web App (apps-script's "order history" project)
 *      writes to. Find it by opening that spreadsheet and copying the ID
 *      out of its URL (.../spreadsheets/d/THIS_PART/edit).
 *   3. Deploy > New deployment (first time) or Manage deployments > New
 *      version (if updating an existing deployment). Web app. Execute as:
 *      Me. Who has access: Anyone.
 *   4. Copy the "/exec" URL into index.html's INVOICE_SEARCH_WEBAPP_URL
 *      constant (only needed the first time — a "new version" of an
 *      existing deployment keeps the same URL).
 */

var CONFIG = {
  INVOICE_FOLDER_ID: '1I-yMA2hPg2NrNufwShzecbUOmSAJlCGl',
  ORDER_HISTORY_SPREADSHEET_ID: '1tOIzq7AWTyXI4TD2tYsIryho4KReo3IM0a7Te9t2t68',
  ORDER_HISTORY_SHEET_NAME: 'Order History'
};

// ============================================================================
// ENTRY POINTS
// ============================================================================
function doPost(e){
  return handleSearch(e);
}
function doGet(e){
  return handleSearch(e);
}

function handleSearch(e){
  var query = readQuery(e);
  if(!query){
    return jsonOut({ error: 'No search text given', query: query, results: [] });
  }

  try{
    var sheetRows = loadOrderHistoryRows();
    var folderIndex = buildInvoiceFolderIndex(CONFIG.INVOICE_FOLDER_ID);
    var matched = {}; // Order No -> {orderNo, customerName, dateFmt}
    var qLower = query.toLowerCase();

    // 1. Order Number, Customer Name, or Date — a plain "contains" check
    // against every row, all three fields, in one pass.
    sheetRows.forEach(function(r){
      if(r.orderNo.toLowerCase().indexOf(qLower) !== -1 ||
         r.customerName.toLowerCase().indexOf(qLower) !== -1 ||
         r.dateFmt.toLowerCase().indexOf(qLower) !== -1){
        matched[r.orderNo] = r;
      }
    });

    // 2. Invoice filename in the Drive folder — catches a PDF saved under
    // anything other than the exact Order Number. Whichever Order Number
    // it was saved under becomes the result's key; if that same Order No
    // is already in Order History its Customer Name/Date come along for
    // free, otherwise those stay blank (still a valid result — just one
    // this sheet doesn't know about yet).
    Object.keys(folderIndex).forEach(function(stem){
      if(stem.indexOf(qLower) === -1) return;
      var file = folderIndex[stem];
      var orderNo = file.getName().replace(/\.pdf$/i, '');
      if(!matched[orderNo]){
        matched[orderNo] = findByOrderNo(sheetRows, orderNo) || { orderNo: orderNo, customerName: '', dateFmt: '' };
      }
    });

    var results = Object.keys(matched).map(function(orderNo){
      var order = matched[orderNo];
      var file = folderIndex[order.orderNo.toLowerCase()];
      var result = {
        orderNo: order.orderNo,
        customerName: order.customerName || '',
        date: order.dateFmt || '',
        invoiceFound: !!file
      };
      if(file){
        makeViewableWithLink(file);
        result.fileName = file.getName();
        result.fileId = file.getId();
        result.viewUrl = 'https://drive.google.com/file/d/' + file.getId() + '/view';
        result.downloadUrl = 'https://drive.google.com/uc?export=download&id=' + file.getId();
        result.sizeBytes = file.getSize();
        result.lastUpdated = file.getLastUpdated();
      }
      return result;
    });

    // Most recent order first — needs a real date to sort on, so anything
    // missing one (the "matched by filename only, not in the sheet" case)
    // sorts to the end rather than breaking the comparison.
    results.sort(function(a, b){
      if(!a.date) return 1;
      if(!b.date) return -1;
      return new Date(b.date) - new Date(a.date);
    });

    return jsonOut({ query: query, results: results });

  } catch(err){
    // A wrong/inaccessible INVOICE_FOLDER_ID or ORDER_HISTORY_SPREADSHEET_ID
    // lands here — the message is surfaced as-is since it's the fastest way
    // to tell which one while setting this up.
    return jsonOut({ error: String(err && err.message ? err.message : err), query: query, results: [] });
  }
}

// 'query' is the current param name; 'orderNo' is accepted too so a client
// still sending the original single-purpose request shape keeps working.
function readQuery(e){
  try{
    if(e && e.postData && e.postData.contents){
      var body = JSON.parse(e.postData.contents);
      return String(body.query || body.orderNo || '').trim();
    }
  } catch(err){ /* not JSON — fall through to query param below */ }
  if(e && e.parameter){
    return String(e.parameter.query || e.parameter.orderNo || '').trim();
  }
  return '';
}

// ============================================================================
// ORDER HISTORY SHEET
// ============================================================================

// Read-only — never writes back to this sheet (that stays the exclusive job
// of the order-logging Web App). One row per order: {orderNo, customerName,
// dateFmt} — dateFmt is normalized to 'dd-MMM-yyyy' (matching exactly what
// the order-logging script itself writes into the Date column) whether the
// cell holds a real Date value or a plain string, so every row's date is
// comparable the same way regardless of how the cell happens to be typed.
function loadOrderHistoryRows(){
  var ss = SpreadsheetApp.openById(CONFIG.ORDER_HISTORY_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.ORDER_HISTORY_SHEET_NAME);
  if(!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if(values.length < 2) return [];

  var headers = values[0];
  var orderNoCol = headers.indexOf('Order No');
  var customerCol = headers.indexOf('Customer Name');
  var dateCol = headers.indexOf('Date');
  var tz = Session.getScriptTimeZone();

  var rows = [];
  for(var i = 1; i < values.length; i++){
    var r = values[i];
    var orderNo = String(orderNoCol > -1 ? r[orderNoCol] : '').trim();
    if(!orderNo) continue;
    var dateVal = dateCol > -1 ? r[dateCol] : '';
    var dateFmt = dateVal instanceof Date
      ? Utilities.formatDate(dateVal, tz, 'dd-MMM-yyyy')
      : String(dateVal || '').trim();
    rows.push({
      orderNo: orderNo,
      customerName: String(customerCol > -1 ? r[customerCol] : '').trim(),
      dateFmt: dateFmt
    });
  }
  return rows;
}

function findByOrderNo(rows, orderNo){
  var wanted = orderNo.toLowerCase();
  for(var i = 0; i < rows.length; i++){
    if(rows[i].orderNo.toLowerCase() === wanted) return rows[i];
  }
  return null;
}

// ============================================================================
// DRIVE LOOKUP
// ============================================================================

// One pass over the folder, keyed by file name minus ".pdf" (lowercased) —
// built once per request and reused for every matched order, rather than
// re-scanning the folder per order. If more than one file somehow shares
// the same name (Drive allows duplicate names in one folder), the most
// recently modified one wins — a sane default for what should be a rare
// mistake, not something worth failing the search over.
//
// Filtered by actual MIME type, not by whether the file NAME happens to
// end in ".pdf" — Drive lets a real PDF be named anything at all (a file
// uploaded and renamed to just "ajfan", no extension, is still genuinely
// application/pdf), and checking the name alone silently dropped exactly
// that case.
function buildInvoiceFolderIndex(folderId){
  var index = {};
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  while(files.hasNext()){
    var f = files.next();
    if(f.getMimeType() !== 'application/pdf') continue;
    var stem = f.getName().replace(/\.pdf$/i, '').trim().toLowerCase();
    var existing = index[stem];
    if(!existing || f.getLastUpdated() > existing.getLastUpdated()) index[stem] = f;
  }
  return index;
}

// Makes just this one matched file open without sign-in. Tries "Anyone with
// the link" first; if this Workspace domain has external sharing locked
// down (setSharing throws), falls back to "Anyone within the domain" so it
// still works for any signed-in mensabrands.com viewer. If both are
// disabled by domain policy, the link is still returned — the ASM's browser
// will show Drive's own "Request Access" screen, which at least confirms
// the file was found, and IT can adjust the sharing policy or the specific
// folder's permissions from there.
function makeViewableWithLink(file){
  try{
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(err){
    try{
      file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(err2){ /* sharing locked down entirely — link still returned as-is */ }
  }
}

function jsonOut(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
