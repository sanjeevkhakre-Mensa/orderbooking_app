# Proforma Invoice Search — Setup Guide

One-time setup to turn on the "🧾 Invoice Search" button in the topbar,
which lets an ASM look up a Proforma Invoice PDF by Order Number, Customer
Name, or Date, and View/Download it.

## What you're setting up

```
ASM types an Order Number, Customer Name, or Date into the app
  →  index.html ("🧾 Invoice Search" button)
  →  apps-script/InvoiceSearch.gs (Web App)
  →  the Order History sheet (to find which orders match) +
     the Drive folder where invoices are saved (to find each one's PDF)
  →  index.html shows a card per matching order, with View / Download
     when that order's invoice PDF exists
```

**This app never creates, uploads, or emails the invoice.** That stays
exactly as it is today — you (or whoever prepares Proforma Invoices) save
the finished PDF into one Drive folder, named after the Order Number. This
feature only searches Order History + that folder and hands back links.

A Customer Name or Date search can match several orders at once — each
shows as its own card, and one without an invoice yet still shows (with a
plain "No invoice uploaded yet" note) so an ASM can see every one of that
customer's orders, not just the ones already invoiced.

## Naming convention — this is the only rule that matters

For Order Number `SO-2026-00125`, the file must be named:

```
SO-2026-00125.pdf
```

Case doesn't matter (`so-2026-00125.pdf` also matches), but the rest of the
name must match the Order Number exactly — no extra spaces, no "(1)", no
" - copy". One file per Order Number.

## Step 1 — Pick (or create) the Drive folder

1. Create a Google Drive folder for Proforma Invoices, or use an existing
   one — e.g. "MyFitness Proforma Invoices".
2. Open it in Drive and copy its **folder ID** from the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART_IS_THE_ID`**
3. This folder can stay completely private — nothing about it needs to be
   shared. The script (Step 2) reads it under your own Google account, and
   only ever exposes the one specific file an ASM actually searched for
   (see "Privacy" below), never the whole folder.

## Step 2 — Add the Apps Script project

1. Go to <https://script.google.com> → **New project**.
2. Delete the default `Code.gs` boilerplate and paste in the contents of
   [`apps-script/InvoiceSearch.gs`](apps-script/InvoiceSearch.gs) from this
   repo.
3. In `CONFIG.INVOICE_FOLDER_ID`, paste the folder ID from Step 1.
4. In `CONFIG.ORDER_HISTORY_SPREADSHEET_ID`, paste the ID of the same
   spreadsheet the order-logging Web App writes to (its "Order History"
   tab) — open that spreadsheet and copy the ID out of its URL
   (`.../spreadsheets/d/`**`THIS_PART`**`/edit`). This is what makes
   Customer Name and Date search work; Order Number search alone would
   still work without it, checking the Drive folder directly.
5. Save the project (give it a name like "MyFitness Invoice Search").

## Step 3 — Deploy as a Web App

1. **Deploy → New deployment**.
2. Type: **Web app**. Execute as: **Me**. Who has access: **Anyone** (same
   trust model as the existing order-logging and inventory-sync Web Apps —
   an unauthenticated endpoint that only this app's own frontend is
   expected to call, and it can only ever return one already-known
   Order Number's invoice, never list or browse the folder).
3. Deploy, and copy the `.../exec` URL.
4. Authorize when prompted (first-time only) — you'll see a "Google hasn't
   verified this app" warning, which is normal for a personal script;
   click **Advanced → Go to (project name) (unsafe)** → **Allow**.

## Step 4 — Wire the URL into the app

In `index.html`, find `INVOICE_SEARCH_WEBAPP_URL` near the other Web App
URL constants and paste in the `.../exec` URL from Step 3. The "🧾 Invoice"
topbar button stays hidden until this is filled in — nothing else in the
app changes in the meantime.

## Privacy — what gets shared, and when

The Drive folder itself never needs to be shared with anyone. When an ASM
searches an Order Number and a matching PDF is found, the script marks
**that one file** "Anyone with the link can view" (falling back to "Anyone
in your organization" if your Workspace admin has disabled external
sharing) so the ASM's browser can open it without signing in. Every other
file in the folder — including invoices no one has searched for yet —
stays exactly as private as it already was.

## Accepted date formats

Typing a date searches for every order placed that day. Any of these work:
`2026-09-08`, `08-09-2026`, `08/09/2026`, or `08-Sep-2026` (the exact format
shown elsewhere in the app). Anything that doesn't match one of these
patterns is treated as a Customer Name search instead, never an error.

## If a search comes back "No orders found" but you know the order exists

- For a Customer Name search: it only matches Order History's own
  `Customer Name` column, so it can only find orders already logged there
  — an order submitted before the order-logging Web App was working won't
  show up this way (Order Number search still finds its invoice directly,
  independent of the sheet).
- For a Date search: double check the format against the list above.
- For an Order Number search: almost always a filename mismatch — check:
  - The file is a `.pdf` (not `.docx`, `.jpg`, a Drive-native Doc, etc.)
  - The name (minus `.pdf`) matches the Order Number exactly — copy-paste
    the Order Number from the app rather than retyping it, to rule out a
    typo.
  - The file is actually inside the configured folder, not a subfolder or
    a shortcut elsewhere in Drive.

## If the app shows an error instead of "not found"

That means the request reached `InvoiceSearch.gs` but it couldn't read the
folder — almost always `CONFIG.INVOICE_FOLDER_ID` is blank, wrong, or the
Google account that deployed the Web App doesn't have access to that
folder. The error message returned is Apps Script's own, which is usually
specific enough to tell which of those it is.
