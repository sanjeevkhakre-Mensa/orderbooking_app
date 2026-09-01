/**
 * MyFitness — Image-Based SKU & Quantity Scan (Google Apps Script)
 *
 * A standalone Web App the order-booking app's "📷 Scan Order Photo" button
 * (in Search & Add Products, see index.html) POSTs a photo to. Deployed
 * separately from every other Web App this project uses (order logging,
 * inventory sync) so this one's own deployment/authorization never touches
 * those, and so its Gemini API key lives in exactly one place.
 *
 * What this script does:
 *   1. Receives {imageBase64, mimeType} as a JSON POST body.
 *   2. Sends the image to Google's Gemini API (generateContent) with a
 *      prompt asking it to read every product name + quantity visible in
 *      the photo (a handwritten note, a printed list, or product labels)
 *      and return them as a strict JSON array.
 *   3. Parses that response and returns {items:[{product, qty}], error}
 *      back to the browser — matching detected products against this
 *      app's own Product Master happens client-side in index.html, not
 *      here, since that master data is already loaded there and doing the
 *      match here would mean fetching + parsing it twice.
 *
 * This script does NOT touch the Product Master, Live Inventory, or Order
 * History sheets at all — it's a pure image-in, JSON-out relay to Gemini.
 *
 * See IMAGE_SCAN_SETUP_GUIDE.md for one-time setup (creating the Gemini API
 * key, deploying this as a Web App, pasting the exec URL into index.html).
 */

// ============================================================================
// CONFIG — fill in once
// ============================================================================
var CONFIG = {
  // Create a free key at https://aistudio.google.com/apikey and paste it
  // here. Never commit a real key to this file if this project's repo is
  // ever made public — Apps Script project source isn't published to
  // GitHub Pages the way index.html is, but treat it as a secret regardless.
  GEMINI_API_KEY: 'PASTE_YOUR_GEMINI_API_KEY_HERE',

  // 'gemini-2.0-flash' is fast and inexpensive and handles this kind of
  // read-a-photo task well. Swap to a newer flash-tier model name here if
  // Google renames/retires this one — no other code needs to change.
  GEMINI_MODEL: 'gemini-2.0-flash',

  // Hard cap on how many distinct products one photo can report — a
  // safety net against a malformed/hallucinated response trying to return
  // an unreasonable number of "items", not a realistic order size.
  MAX_ITEMS: 60
};

var GEMINI_PROMPT =
  'You are reading a photo taken by a sales rep to log a customer order. ' +
  'The photo may show a handwritten note, a printed list, or physical ' +
  'product packages. Identify every distinct product mentioned and the ' +
  'quantity ordered for each.\n\n' +
  'Rules:\n' +
  '- Return ONLY a JSON array, no markdown fences, no commentary, no ' +
  'other text before or after it.\n' +
  '- Each element: {"product": "<the product name/description exactly as ' +
  'written or labeled>", "qty": <integer>}.\n' +
  '- If a quantity is not explicitly written for an item, use 1.\n' +
  '- If you cannot find any products at all, return [].\n' +
  '- Do not invent products that are not actually visible in the image.';

// ============================================================================
// ENTRY POINT
// ============================================================================
function doPost(e){
  var result = { items: [], error: '' };
  try{
    var body = JSON.parse(e.postData.contents);
    if(!body.imageBase64) throw new Error('No image received');

    var items = scanOrderPhoto(body.imageBase64, body.mimeType || 'image/jpeg');
    result.items = items.slice(0, CONFIG.MAX_ITEMS);
  } catch(err){
    result.error = String(err && err.message ? err.message : err);
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// GEMINI CALL
// ============================================================================
function scanOrderPhoto(imageBase64, mimeType){
  if(!CONFIG.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY === 'PASTE_YOUR_GEMINI_API_KEY_HERE'){
    throw new Error('GEMINI_API_KEY is not configured in this Apps Script project yet');
  }

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    CONFIG.GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(CONFIG.GEMINI_API_KEY);

  var requestBody = {
    contents: [{
      parts: [
        { text: GEMINI_PROMPT },
        { inline_data: { mime_type: mimeType, data: imageBase64 } }
      ]
    }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' }
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var responseText = response.getContentText();
  if(status !== 200){
    throw new Error('Gemini API error (' + status + '): ' + responseText.slice(0, 300));
  }

  var parsed = JSON.parse(responseText);
  var textOut = parsed.candidates && parsed.candidates[0] &&
    parsed.candidates[0].content && parsed.candidates[0].content.parts &&
    parsed.candidates[0].content.parts[0] && parsed.candidates[0].content.parts[0].text;
  if(!textOut) throw new Error('Gemini returned no readable content');

  // responseMimeType:'application/json' above should mean textOut is
  // already bare JSON, but strip a stray ```json ... ``` fence defensively
  // in case a model revision ignores that setting.
  var cleaned = String(textOut).trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  var items = JSON.parse(cleaned);
  if(!Array.isArray(items)) throw new Error('Gemini response was not a JSON array');

  return items
    .filter(function(it){ return it && it.product; })
    .map(function(it){
      return {
        product: String(it.product).trim(),
        qty: Math.max(1, parseInt(it.qty, 10) || 1)
      };
    });
}
