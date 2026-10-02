# Jewellery POS

React, Vite and Supabase point-of-sale for a jewellery store: billing with barcode scanning, jewellery
stock, daily metal rates, jewellery pricing, savings schemes ("Schema"), invoices, receipts, WhatsApp
sharing and printing.

## Local setup

1. Create a Supabase project and set it up as described in `supabase/README.md`.
2. Copy `.env.example` to `.env` and fill in the values (see below).
3. `npm install`
4. `npm run dev`
5. Log in, open **Store Settings** and enter the shop name, phone, address and logo, then enter
   today's rates in **Metal Rates**.

## Environment

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon / publishable key (never the service-role key) |
| `VITE_ADMIN_ID`, `VITE_ADMIN_PASSWORD` | Admin login |
| `VITE_STAFF_ID`, `VITE_STAFF_PASSWORD` | Staff login |
| `VITE_SITE_URL` | The deployed app's address, used in WhatsApp invoice links |

`VITE_` values are built into the website, so change the passwords after the first login in
**Store Settings → Change Password** (stored in the database, these take priority).

## How jewellery pricing works

A jewellery item has no fixed selling price. At billing it is priced from the current metal rate:
net weight × rate + making + wastage + stone + other charges. Each invoice stores the rate, weights and
charges it used, so old invoices never change when the rate changes.
