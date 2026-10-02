# Mahalashmi Stores Supabase setup

Apply the migrations in filename order to the dedicated Mahalashmi Stores Supabase project.

1. Run `20260716_0001_purple_boutique_schema.sql`.
2. Run `20260716_0002_purple_boutique_catalog.sql`.
3. Create the owner account in Supabase Authentication and set its `role` metadata to `admin` if customer login is enabled.

The schema migration is idempotent. Invoice numbers use the format `PB-YYYY-000001` and are allocated under a locked database counter to prevent duplicates during concurrent billing.

## Jewellery POS (metal rates, jewellery items, savings schemes)

After `mahalashmi_production.sql`, run `migrations/jewellery_pos.sql` once in the Supabase SQL editor.
It is additive and safe to re-run: it adds jewellery columns to `products`, scheme columns to `orders`,
the append-only `metal_rates` history (current rate = latest row), `jewellery_schemes`,
`scheme_installments` (paid rows are locked by a trigger), `scheme_redemptions`, the scheme RPCs, and the
jewellery categories (existing categories are left untouched). No existing rows are modified.

Until it is applied the app keeps working as before; Metal Rates and Schema show a "database update needed" message.
