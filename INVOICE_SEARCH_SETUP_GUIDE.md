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

## Naming convention — much looser than it sounds

Ideally, for Order Number `SO-2026-00125`, name the file:

```
SO-2026-00125.pdf
```

But it doesn't have to be exact — search matches any part of the filename,
case-insensitively, and by actual file type (not by whether the name ends
in ".pdf") — so a PDF renamed to just `Ajfan` with no extension at all
still gets found by searching "ajfan". The one thing that DOES matter: a
typo in the filename is a typo in what's searchable — a file saved as
`Body Fu Invoice.pdf` will never turn up for a search of "Body Fuel",
because that exact text genuinely isn't in the name. If a real invoice
isn't showing up, check the filename for typos first.

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

## How matching works

Typing anything checks it against, all at once: every order's Order
Number, Customer Name, and Date (as shown in the app, e.g. `08-Sep-2026`)
in the Order History sheet, AND every invoice filename in the Drive
folder — whichever contains the typed text, case-insensitively, no
minimum length. So "ajfan", "08-Sep", "sep-2026", or a single letter all
work the same way, and a date search really just means "does the date
column contain this text" — no fixed format is required.

## If a search comes back "No orders found" but you know the order exists

- For a Customer Name or Date search: it only matches Order History's own
  columns, so it can only find orders already logged there — an order
  submitted before the order-logging Web App was working won't show up
  this way (searching its Order Number directly still finds its invoice,
  independent of the sheet).
- For any search that should be matching a Drive file: the file has to
  genuinely be a PDF (checked by its actual file type, not its name) and
  its filename has to actually contain the text you typed — check for a
  typo in the filename itself (copy-paste from the app instead of
  retyping, to rule that out) and confirm the file is inside the
  configured folder, not a subfolder or a shortcut elsewhere in Drive.

## If the app shows an error instead of "not found"

That means the request reached `InvoiceSearch.gs` but it couldn't read the
folder — almost always `CONFIG.INVOICE_FOLDER_ID` is blank, wrong, or the
Google account that deployed the Web App doesn't have access to that
folder. The error message returned is Apps Script's own, which is usually
specific enough to tell which of those it is.
