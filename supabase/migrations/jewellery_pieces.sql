-- Every piece of a jewellery item has its own serial number and hallmark (HUID) number.
-- Safe to run more than once.

-- [{ "serial": "12", "huid": "AB12CD" }, ...]  Sold pieces are taken off the list.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pieces JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
