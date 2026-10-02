# Supabase setup

Run these in the Supabase SQL Editor of a new project, in this order:

1. `production_schema.sql` — all tables, functions and access policies for billing, stock, barcodes,
   customers, advance orders, credits, expenses and coupons.
2. `migrations/jewellery_pos.sql` — jewellery item fields, the append-only `metal_rates` history
   (current rate = latest row), savings schemes (`jewellery_schemes`, `scheme_installments` — paid
   rows are locked by a trigger — and `scheme_redemptions`), the scheme functions, and the jewellery
   categories.

Both files are safe to re-run: they only create what is missing and never change or delete existing rows.

Then, under **Storage**, create three **public** buckets: `product-images`, `invoices` and `branding`.

The other files in `migrations/` are already included in `production_schema.sql`; they are kept only
for databases that were set up before it.

After the first login, enter the shop name, phone, address and logo in **Store Settings**.
