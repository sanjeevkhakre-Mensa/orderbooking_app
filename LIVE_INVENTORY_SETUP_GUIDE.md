# Live Inventory (Gmail Sync) — Setup Guide

One-time setup to turn on automatic SKU-level inventory sync from the daily
"Myfitness B2B inventory view" email into the Order Booking Tool.

## What you're setting up

```
tech@mensabrands.com  →  sanjeev.khakre@mensabrands.com (Gmail, receives it directly)
                       →  InventorySync.gs
                       →  "Live Inventory" Google Sheet
                       →  index.html (reads as CSV, same as Product/Customer Master)
```

The automated report is sent by `tech@mensabrands.com` to a distribution
list that includes `sanjeev.khakre@mensabrands.com` directly, so the script
runs under his account and reads the original email — no forwarding step,
no dependency on a forward happening every day.

(An earlier version of this setup ran the script under
`claude7@mensabrands.com` against a manually-forwarded copy instead. That
hit a hard blocker: `claude7@mensabrands.com`'s Workspace admin has the
Gmail/Mail service disabled for that account, so `GmailApp` failed with
"Mail service not enabled" — an admin-level restriction no code change can
work around. Since `Live_Inventory_tab` and `MyFitness_Master_Data` are
both owned by `claude7@mensabrands.com`, both have already been shared
with `sanjeev.khakre@mensabrands.com` as an editor so Step 2 below works.)

Plus one small addition to the *existing* order-logging Apps Script so
Booked Qty updates the instant an order is submitted, not just on the next
sync.

## Step 1 — Identify the Live Inventory spreadsheet

Already confirmed (2026-08-24, via Drive): this is the spreadsheet named
**"Live_Inventory_tab"**, owned by `claude7@mensabrands.com`:

```
https://docs.google.com/spreadsheets/d/19K5gNBYtMYwPraUIIqJB06m1VwfdJq7AdGJUfgb9asA/edit
```

Open that link directly — this is the spreadsheet everything below gets
added to. `InventorySync.gs` and `OrderLoggingAddition.gs` are already
configured with this exact spreadsheet ID, and `InventorySync.gs` looks up
its existing tab by `gid` (matching `MASTER_DATA_URLS.inventory`'s
published link) rather than by name, so it updates the real tab your app
already reads regardless of what that tab is actually named inside the
sheet.

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
   into Google as `sanjeev.khakre@mensabrands.com`** when you click Allow —
   this authorizes whichever account is active at that moment, and the
   search query only finds the email in that specific mailbox. You'll
   likely see a "Google hasn't verified this app" warning first — that's
   normal for a personal script; click **Advanced → Go to (project name)
   (unsafe)** to get to the actual permission list, then **Allow**.
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

1. Open the **existing** order-logging Apps Script project (the one behind
   `index.html`'s `SHEET_WEBAPP_URL`) — this is most likely bound to the
   "MyFitness Order History" spreadsheet
   (`1echLxpMrYI7QRc3x-in8sskct3UuupzDHloKqhA4ikE`), found the same way as
   Step 1 — open that sheet and check Extensions → Apps Script for an
   existing project.
2. Add a new script file to that project, paste in
   [`apps-script/OrderLoggingAddition.gs`](apps-script/OrderLoggingAddition.gs)
   as-is — `LIVE_INVENTORY_SPREADSHEET_ID` is already filled in.
3. In that project's existing `doPost(e)` function, add one line —
   `applyBookedQtyForOrder(payload);` — right after the point where the
   order row is already appended to the Order History sheet. See the
   comment block at the top of `OrderLoggingAddition.gs` for exact
   placement guidance.
4. Save and re-deploy that Web App (Deploy → Manage deployments → edit →
   New version) so the change takes effect.

## Step 7 — Turn on the Inventory section in the app

In `index.html`, fill in the URLs from steps 3–4 and, when you're ready to
start blocking over-quantity bookings (rather than just warning), flip
`STOCK_VALIDATION_ENABLED` to `true`.

## Dependency to be aware of

`Live_Inventory_tab` and `MyFitness_Master_Data` are owned by
`claude7@mensabrands.com`; `sanjeev.khakre@mensabrands.com` only has editor
access via sharing, not ownership. If that sharing is ever revoked, the
script starts failing with a permissions error in Sync History — sharing
access, not the Gmail flow, is now the thing to check first if sync stops
working.
