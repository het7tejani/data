# Order Book - Etsy Orders Manager

One simple place for the orders of all 5 Etsy shops:
**PsychicEra, PsychicSutra, DaisyMediumStudio, RosyMediumStudio, ladygeorgia**.

- Upload the Etsy orders file (CSV or Excel) - client name, listing, date, price, city/country fill in by themselves
- Add the reading PDF you sent for each order
- Write notes for any order
- Dashboard: sales by month, sales by shop, best-selling listings, repeat clients, where clients are from
- Search any client, listing, order number or phone
- Export to Excel any time
- Same data on every computer (saved in your private GitHub repo)

## Open the app

**https://het7tejani.github.io/data/**

Open this link in Chrome on any computer. Bookmark it. Nothing to install.

> If the link does not open yet, wait 2-3 minutes after the first setup (GitHub needs a moment).

### First time on each computer: connect GitHub
1. Make a GitHub token: github.com → your photo → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)** → tick **repo** → **Generate token**. Copy the code (starts with `ghp_`).
2. Open the app, paste the token, leave "Data repo" as it is, click **Connect**.
3. The app makes a **private** repo `orderbook-data` for your data (first time only). On the next computer it finds the same repo, so you see the same orders.

## Use it

### 1. Download the file from Etsy
1. Etsy **Shop Manager** → **Settings** → **Options**
2. **Download Data** tab → **Orders**
3. CSV Type: **Order Items** (this has listing names). Choose the year. Leave month empty for full year.
4. Click **Download CSV**
5. Optional: also download CSV Type **Orders** - it adds the buyer username and order total.

Do this for each shop.

### 2. Upload
1. In the app click **Upload**
2. Click the shop name
3. Drop the file (you can drop "Order Items" and "Orders" files together)
4. Check the numbers → click **Save**

Uploading the same file again is safe. Orders are updated, not doubled. Your notes and PDFs stay.

### 3. Add reading PDFs
- **Many at once:** Upload → **Reading PDFs** → drop all PDFs. The app matches each PDF to the order by the **order number** or **client name** in the file name. Check the matches, pick an order for any that did not match, then **Save**.
- **One order:** open the order (click it in Orders) → drop the PDF in the box.

Tip: name PDFs like `3456789012 Sarah Johnson.pdf` and they match every time.

### 4. Notes
Open any order and type in **Notes**. It saves by itself.

## Where your data is saved (same on every computer)

- Orders, notes and PDFs are saved in your **private** GitHub repo **orderbook-data** (`orders.json` + `pdfs/` folder). Only you can see it.
- This repo (`data`) is public and has **only the app code** - no client data. The app refuses to save data into a public repo.
- Every change is a saved version in GitHub, so old data can be recovered from the repo history.
- Bottom-left of the app shows **Saved to GitHub** when everything is saved. If it shows **Not saved**, check internet and click it to retry.
- Using two computers at the same time is fine. Changes are merged. Click **Get latest data** (Backup & Settings) to pull changes made on the other computer.
- The token stays only in that computer's browser. On a shared computer, click **Disconnect this computer** when done.
- Optional: **Download backup** gives one file with all orders and notes.

## Phone numbers

Etsy's order files normally do not include buyer phone numbers. If a file has a phone column, the app reads it. Otherwise you can add a phone on the order page.

## For developers

Plain HTML/CSS/JavaScript, no build step. Data is stored through the GitHub Contents API in a private repo (`orders.json`, `pdfs/`), with an IndexedDB cache. Excel reading via SheetJS (`vendor/`).

- `index.html` - layout
- `css/app.css` - design
- `js/parser.js` - Etsy CSV/Excel reading (works in Node too)
- `js/store.js` - GitHub storage (private repo) + local cache
- `js/ui.js` - small UI helpers and chart
- `js/app.js` - screens

Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
Hosted with GitHub Pages from the `main` branch root.
