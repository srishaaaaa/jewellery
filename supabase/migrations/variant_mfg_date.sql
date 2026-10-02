-- ============================================================================
-- Each pack size (product variant) keeps its own batch dates.
-- product_variants already has expiry_date; this adds mfg_date.
-- Until this is run, the app still saves each pack size's expiry date and
-- simply skips its Mfg date. Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS mfg_date DATE;

NOTIFY pgrst, 'reload schema';

-- Result: should list both date columns
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'product_variants' AND column_name IN ('mfg_date', 'expiry_date');
