-- ============================================================================
-- Save birthday / anniversary offers and WhatsApp message template.
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Stored on the single store_settings row as
--   { "birthday":    { "offers": [...], "selectedOffer": "...", "message": "..." },
--     "anniversary": { ... } }
-- Until this is run, the Save button keeps the settings on that device only.
-- ============================================================================

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS customer_event_messages JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Refresh the API schema cache so the app sees the new column immediately
NOTIFY pgrst, 'reload schema';

-- Result: should list the column
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'store_settings' AND column_name = 'customer_event_messages';
