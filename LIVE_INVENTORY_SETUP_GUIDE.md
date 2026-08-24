# Live Inventory (Gmail Sync) — Setup Guide

One-time setup to turn on automatic SKU-level inventory sync from the daily
"Myfitness B2B inventory view" email into the Order Booking Tool.

## What you're setting up

```
tech@mensabrands.com  →  sanjeev.khakre@mensabrands.com (receives + forwards)
                       →  claude7@mensabrands.com (Gmail, receives the forward)
                       →  InventorySync.gs
                       →  "Live Inventory" Google Sheet
                       →  index.html (reads as CSV, same as Product/Customer Master)
```

Confirmed flow: the automated report is sent by `tech@mensabrands.com` to a
distribution list including `sanjeev.khakre@mensabrands.com`, who forwards
it each day to `claude7@mensabrands.com`. That forward keeps the real
`.xlsx` attachment intact — verified directly against a real forwarded
message. `InventorySync.gs`'s `GMAIL_SEARCH` filters on the forwarder
(`sanjeev.khakre@mensabrands.com`), not the original sender, and the script
must be authorized under `claude7@mensabrands.com`'s Google account (Step 2
below) since that's the mailbox that actually receives the forward.

Plus one small addition to the *existing* order-logging Apps Script so
Booked Qty updates the instant an order is submitted, not just on the next
sync.

## Step 1 — Identify the Live Inventory spreadsheet

`index.html`'s `MASTER_DATA_URLS.inventory` already points at a published
CSV link for a "Live Inventory" tab. Open the actual Google Sheet behind
that published link (File → the sheet you originally published from) — this
is the spreadsheet everything below gets added to.

If you don't already have a real spreadsheet behind that link, create one
now with a single tab named `Live Inventory` and publish it the same way
the other master-data tabs are published (File → Share → Publish to web →
that tab → CSV).

## Step 2 — Add the Apps Script project

1. In that spreadsheet: **Extensions → Apps Script**.
2. Delete the default `Code.gs` boilerplate and paste in the contents of
   [`apps-script/InventorySync.gs`](apps-script/InventorySync.gs) from this repo.
3. Confirm the two `PRODUCT_GID_*` values in `CONFIG` match the gids already
   used in `index.html`'s `MASTER_DATA_URLS.productsGT` / `.productsSupplement`
   (they should — both files were written against the same sheet).
4. Enable the **Drive API Advanced Service** (needed to convert the `.xlsx`
   attachment): in the Apps Script editor, click **Services (+)** → find
   **Drive API** → **Add**.
5. Save, then run `syncInventoryFromGmail` once from the editor's function
   picker. The first run will prompt for authorization — review and accept
   the Gmail (read-only) and Sheets/Drive permissions. **You must be logged
   into Google as `claude7@mensabrands.com`** when you click Allow — this
   authorizes whichever account is active at that moment, and the search
   query only finds the email in that specific mailbox (where
   sanjeev.khakre@mensabrands.com's daily forward actually lands).
6. Check the spreadsheet — you should now see populated `Live Inventory`,
   `Inventory Sync History`, and `Unmatched SKUs` tabs, plus a hidden
   `Processed Emails` tab.

## Step 3 — Publish the two new tabs as CSV

Same mechanism as every other master-data tab:

1. File → Share → **Publish to web**.
2. Select the `Inventory Sync History` tab → CSV → Publish. Copy the link.
3. Repeat for `Unmatched SKUs`.
4. Paste both links into `index.html`'s new `SYNC_HISTORY_URL` and
   `UNMATCHED_SKU_URL` constants (see the CONFIG block near
   `MASTER_DATA_URLS`).

(`Live Inventory` itself is presumably already published, since
`MASTER_DATA_URLS.inventory` already points at it.)

## Step 4 — Deploy the manual "Sync Now" Web App

1. In the Apps Script editor: **Deploy → New deployment**.
2. Type: **Web app**. Execute as: **Me**. Who has access: **Anyone** (this
   matches how the existing order-logging Web App is set up — it's an
   unauthenticated POST endpoint, same trust model as the rest of the app).
3. Deploy, copy the `.../exec` URL.
4. Paste it into `index.html`'s new `INVENTORY_SYNC_WEBAPP_URL` constant.

## Step 5 — Install the background trigger

Run `createDailyTrigger` once from the Apps Script editor's function picker
(or use the **Inventory Sync → Install Daily Trigger** menu item that
appears in the spreadsheet after step 2's first run). This installs hourly
checks, 9 AM–2 PM IST — safe to re-run, it clears old triggers first.

## Step 6 — Wire up live Booked Qty on order submission

1. Note this spreadsheet's ID (from its URL) — you'll need it in the next
   step.
2. Open the **existing** order-logging Apps Script project (the one behind
   `index.html`'s `SHEET_WEBAPP_URL`).
3. Add a new script file to that project, paste in
   [`apps-script/OrderLoggingAddition.gs`](apps-script/OrderLoggingAddition.gs),
   and fill in `LIVE_INVENTORY_SPREADSHEET_ID` at the top with the ID from
   step 1 above.
4. In that project's existing `doPost(e)` function, add one line —
   `applyBookedQtyForOrder(payload);` — right after the point where the
   order row is already appended to the Order History sheet. See the
   comment block at the top of `OrderLoggingAddition.gs` for exact
   placement guidance.
5. Save and re-deploy that Web App (Deploy → Manage deployments → edit →
   New version) so the change takes effect.

## Step 7 — Turn on the Inventory section in the app

In `index.html`, fill in the URLs from steps 3–4 and, when you're ready to
start blocking over-quantity bookings (rather than just warning), flip
`STOCK_VALIDATION_ENABLED` to `true`.

## Dependency to be aware of

This whole sync depends on `sanjeev.khakre@mensabrands.com` continuing to
manually forward the daily email to `claude7@mensabrands.com` each morning
— if that forward is ever missed, that day's sync simply finds nothing new
(`No New Email` in Sync History) rather than failing loudly. If you'd
rather remove that manual step later (e.g. a Gmail forwarding filter, or
adding `claude7@mensabrands.com` directly to `tech@mensabrands.com`'s
distribution list), the only thing that would need to change in
`InventorySync.gs` is `CONFIG.GMAIL_SEARCH`'s `from:` address.
