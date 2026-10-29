-- Send coupons to customers on WhatsApp.
-- Safe to run more than once.

-- Phones a coupon is locked to ("Only for this customer"). Empty = anyone can use it.
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS allowed_phones TEXT[] NOT NULL DEFAULT '{}';

-- Every coupon sent from Coupon Management.
CREATE TABLE IF NOT EXISTS public.coupon_sends (
  id BIGSERIAL PRIMARY KEY,
  coupon_id BIGINT REFERENCES public.coupons(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  phone TEXT NOT NULL,
  customer_name TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'pdf')),
  only_for_customer BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS coupon_sends_coupon_idx ON public.coupon_sends (coupon_id, sent_at DESC);

ALTER TABLE public.coupon_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coupon_sends_portal_manage ON public.coupon_sends;
CREATE POLICY coupon_sends_portal_manage ON public.coupon_sends FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';
