# Image-Based SKU & Quantity Scan — Setup Guide

One-time setup to turn on the "📷 Scan Order Photo" button in Search & Add
Products, which reads a photo of a handwritten/printed order note (or
product packages) and auto-adds the matching products to the cart.

## What you're setting up

```
Rep's phone camera / photo library
  →  index.html ("📷 Scan Order Photo" button)
  →  apps-script/ImageOrderScan.gs (Web App)
  →  Gemini API (reads the photo, returns product names + quantities)
  →  index.html (matches each against the Product Master, adds to cart)
```

The matching against the Product Master happens in `index.html` itself,
not in the Apps Script — the master data is already loaded there.

## Step 1 — Get a Gemini API key

1. Go to <https://aistudio.google.com/apikey> and sign in with whichever
   Google account you want billed (a free tier is available and is enough
   for normal usage; this is a separate thing from your Workspace account
   permissions).
2. Click **Create API key** and copy it. Keep this private — anyone with
   it can make requests billed to that account.

## Step 2 — Add the Apps Script project

1. Go to <https://script.google.com> → **New project**.
2. Delete the default `Code.gs` boilerplate and paste in the contents of
   [`apps-script/ImageOrderScan.gs`](apps-script/ImageOrderScan.gs) from
   this repo.
3. In `CONFIG.GEMINI_API_KEY`, replace `'PASTE_YOUR_GEMINI_API_KEY_HERE'`
   with the key from Step 1 (keep the quotes).
4. Save the project (give it a name like "MyFitness Image Order Scan").

## Step 3 — Deploy as a Web App

1. **Deploy → New deployment**.
2. Type: **Web app**. Execute as: **Me**. Who has access: **Anyone** (same
   trust model as the existing order-logging Web App — an unauthenticated
   endpoint that only this app's own frontend is expected to call).
3. Deploy, and copy the `.../exec` URL.
4. Authorize when prompted (first-time only) — you'll see a "Google hasn't
   verified this app" warning, which is normal for a personal script;
   click **Advanced → Go to (project name) (unsafe)** → **Allow**.

## Step 4 — Wire the URL into the app

In `index.html`, find `IMAGE_SCAN_WEBAPP_URL` near the other `CONFIG`/URL
constants and paste in the `.../exec` URL from Step 3. The "📷 Scan Order
Photo" button stays hidden until this is filled in.

## Cost and privacy notes

- Every photo scanned is one Gemini API call, billed to whichever Google
  account created the key in Step 1. Gemini's free tier covers normal
  day-to-day usage for a sales team; check
  <https://ai.google.dev/pricing> if usage grows heavy.
- The photo is sent to Google's Gemini API for processing — the same way
  it already gets sent to your own phone's camera roll. No image is
  stored by this app itself; `ImageOrderScan.gs` doesn't write anything to
  any sheet.

## If matching looks wrong

The Apps Script only returns raw `{product, qty}` text pairs — all fuzzy
matching against the Product Master happens in `index.html` (see the
`matchScannedProduct` function). If Gemini is reading photos correctly
but items are landing in "SKU Not Found" that should have matched, that's
a matching-logic tuning question, not a Gemini/API problem — mention the
specific product names that failed to match.
