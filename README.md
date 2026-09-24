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

**https://data-dun-beta.vercel.app/**

Open this link in Chrome on any computer. Bookmark it. Nothing to install.

> Every change pushed to this repo goes live on Vercel by itself in about a minute.

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
5. Also download CSV Type **Orders** (recommended) - it has the discount, tax and buyer country, so revenue is exact.

Do this for each shop.

**Monthly statement (for exact fees and tax):** Etsy **Shop Manager** → **Finances** → **Payment account** → open the **monthly statement** → **Download CSV**. One file per shop per month.

### 2. Upload
1. In the app click **Upload**
2. Click the shop name
3. Drop the file (you can drop the orders file and the monthly statement together)
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

## How revenue is counted (₹)

The app does **not** use the total from the CSV. For each order:

1. **Sales** = Item Total - Discount Amount + postage (tax paid by the buyer is left out). Etsy's Item Total is BEFORE the discount, so the discount is subtracted first - exactly as you asked.
2. Changed to **₹** using the ECB exchange rate of the order date (free, from frankfurter.dev). ₹ orders stay as they are.
3. Minus **transaction fee**: 6.5% of the sales amount
4. Minus **payment processing**: buyer in India 3% + ₹10, other countries 5% + ₹25 (charged on what the buyer paid, tax included)
5. Minus **regulatory operating fee** if you set a % for it (0 by default)
6. Minus **listing fee (auto-renew)**: Etsy renews the listing on every sale - $0.20 for $ orders (changed to ₹), ₹19 for ₹ shops. Editable in Revenue rules.
7. What is left = **Net revenue**. Dashboard, shops, clients and listings all use this.

### With a monthly statement: exact numbers
When you upload the Etsy monthly statement, orders in it use **Etsy's real numbers** instead of the steps above: sale, tax paid by buyer (Etsy keeps it), transaction fee, processing fee, regulatory operating fee, refunds and other order fees. Net revenue = the sum of Etsy's "Net" column for that order, in ₹. The order page shows **Actual (from statement)** or **Estimated**.

- Orders not in any statement stay **Estimated** (the steps above).
- Statement lines for orders you have not uploaded yet are kept and added when you upload that orders file.
- Uploading the same statement again is safe - lines already saved are skipped.
- The auto-renew fee of each sale is taken from the statement (matched by listing ID). If the statement has none for an order, the rule value is used.
- **Shop costs** (dashboard): new listing fees, Etsy Ads and other charges not tied to an order. They do not change order revenue; the dashboard shows **Net after shop costs** for months with a statement.
- **Backup & Settings → Monthly statements uploaded** lists every shop and month you have uploaded.

Open any order to see each step. The fee numbers can be changed in **Backup & Settings → Revenue rules**.
If an order has no country (only the Order Items file was uploaded), it is counted as "other countries".

## Phone numbers

Etsy's order files normally do not include buyer phone numbers. If a file has a phone column, the app reads it. Otherwise you can add a phone on the order page.

## For developers

Plain HTML/CSS/JavaScript, no build step. Data is stored through the GitHub Contents API in a private repo (`orders.json`, `pdfs/`), with an IndexedDB cache. Excel reading via SheetJS (`vendor/`).

- `index.html` - layout
- `css/app.css` - design
- `js/parser.js` - Etsy CSV/Excel reading (works in Node too)
- `js/revenue.js` - net revenue: ₹ conversion (ECB rates) and Etsy fees
- `js/store.js` - GitHub storage (private repo) + local cache
- `js/ui.js` - small UI helpers and chart
- `js/app.js` - screens

Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
Hosted on Vercel (static site, auto-deploys from `main`). No build step.
