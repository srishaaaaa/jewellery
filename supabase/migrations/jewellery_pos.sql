-- ============================================================================
-- Jewellery POS extension
--
-- Adds jewellery item fields, daily metal rates (with permanent history),
-- the savings "Schema" (scheme) module and scheme redemption on invoices.
--
-- Safe to re-run: everything is additive (ADD COLUMN IF NOT EXISTS / CREATE
-- TABLE IF NOT EXISTS / CREATE OR REPLACE). No existing rows are changed or
-- deleted — existing products, customers, orders and invoices keep working.
-- Apply AFTER production_schema.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Jewellery fields on products
--    The selling price of a jewellery item is NOT stored: it is calculated at
--    billing time from net weight x the current metal rate + charges.
-- ----------------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS metal_type TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS purity TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gross_weight NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stone_weight NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS net_weight NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS making_charge NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS making_charge_type TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS wastage NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS wastage_type TEXT NOT NULL DEFAULT 'percentage';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stone_charge NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS other_charge NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS huid TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS design_number TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS subcategory TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_metal_type_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_metal_type_check
      CHECK (metal_type IS NULL OR metal_type IN ('gold', 'silver', 'platinum', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_making_charge_type_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_making_charge_type_check
      CHECK (making_charge_type IN ('per_gram', 'percentage', 'fixed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_wastage_type_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_wastage_type_check
      CHECK (wastage_type IN ('percentage', 'grams'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_jewellery_weights_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_jewellery_weights_check
      CHECK (gross_weight >= 0 AND stone_weight >= 0 AND net_weight >= 0
             AND making_charge >= 0 AND wastage >= 0 AND stone_charge >= 0 AND other_charge >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS products_metal_idx ON public.products(metal_type, purity) WHERE metal_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_huid_idx ON public.products(huid) WHERE huid IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Jewellery categories (only added if missing; existing ones untouched)
-- ----------------------------------------------------------------------------
INSERT INTO public.categories (name_en, name_ta, is_active, sort_order)
SELECT v.name_en, v.name_ta, v.is_active, v.sort_order
FROM (VALUES
  ('Gold Jewellery', '', TRUE, 1),
  ('Silver Jewellery', '', TRUE, 2),
  ('Platinum Jewellery', '', TRUE, 3),
  ('Diamond Jewellery', '', TRUE, 4),
  ('Rings', '', TRUE, 5),
  ('Necklaces', '', TRUE, 6),
  ('Chains', '', TRUE, 7),
  ('Bangles', '', TRUE, 8),
  ('Bracelets', '', TRUE, 9),
  ('Earrings', '', TRUE, 10),
  ('Pendants', '', TRUE, 11),
  ('Nose Pins', '', TRUE, 12),
  ('Anklets', '', TRUE, 13),
  ('Mangalsutra', '', TRUE, 14),
  ('Wedding Jewellery', '', TRUE, 15),
  ('Kids Jewellery', '', TRUE, 16),
  ('Coins', '', TRUE, 17),
  ('Other', '', TRUE, 18),
  ('German Silver Products', '', TRUE, 19),
  ('Photo Frames', '', TRUE, 20)
) AS v(name_en, name_ta, is_active, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE LOWER(BTRIM(c.name_en)) = LOWER(v.name_en));

-- ----------------------------------------------------------------------------
-- 3. Daily metal rates — append-only history.
--    The CURRENT rate for a metal/purity is its latest row by effective_from.
--    Rows are never updated or deleted, so every past rate stays on record.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metal_rates (
  id BIGSERIAL PRIMARY KEY,
  metal_type TEXT NOT NULL,
  purity TEXT NOT NULL,
  rate_per_gram NUMERIC(12,2) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT 'Admin',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT metal_rates_rate_check CHECK (rate_per_gram > 0),
  CONSTRAINT metal_rates_metal_purity_check CHECK (
    (metal_type = 'gold' AND purity IN ('24K', '22K', '20K', '18K', '14K'))
    OR (metal_type IN ('silver', 'platinum') AND purity = 'STANDARD')
  )
);

CREATE INDEX IF NOT EXISTS metal_rates_lookup_idx
  ON public.metal_rates(metal_type, purity, effective_from DESC, id DESC);

CREATE OR REPLACE VIEW public.current_metal_rates AS
SELECT DISTINCT ON (metal_type, purity) *
FROM public.metal_rates
WHERE effective_from <= NOW()
ORDER BY metal_type, purity, effective_from DESC, id DESC;

CREATE OR REPLACE FUNCTION public.metal_rates_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Metal rate history cannot be changed. Enter a new rate instead.';
END;
$$;

DROP TRIGGER IF EXISTS metal_rates_no_update ON public.metal_rates;
CREATE TRIGGER metal_rates_no_update
  BEFORE UPDATE OR DELETE ON public.metal_rates
  FOR EACH ROW EXECUTE FUNCTION public.metal_rates_append_only();

-- ----------------------------------------------------------------------------
-- 4. Scheme ("Schema") rules — one small JSON document on store_settings
-- ----------------------------------------------------------------------------
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS scheme_rules JSONB;

-- ----------------------------------------------------------------------------
-- 5. Savings schemes, installments and redemptions
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.scheme_number_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS public.scheme_receipt_seq START WITH 1;

CREATE TABLE IF NOT EXISTS public.jewellery_schemes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_number TEXT NOT NULL UNIQUE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  scheme_name TEXT NOT NULL,
  monthly_amount NUMERIC(12,2) NOT NULL CHECK (monthly_amount > 0),
  duration_months INTEGER NOT NULL CHECK (duration_months > 0),
  total_installments INTEGER NOT NULL CHECK (total_installments > 0),
  start_date DATE NOT NULL,
  maturity_date DATE NOT NULL,
  benefit_type TEXT NOT NULL DEFAULT 'making' CHECK (benefit_type IN ('making', 'wastage', 'both')),
  making_benefit_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (making_benefit_value >= 0),
  making_benefit_unit TEXT NOT NULL DEFAULT 'percent' CHECK (making_benefit_unit IN ('percent', 'fixed')),
  wastage_benefit_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (wastage_benefit_value >= 0),
  wastage_benefit_unit TEXT NOT NULL DEFAULT 'percent' CHECK (wastage_benefit_unit IN ('percent', 'fixed')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'matured', 'redeemed', 'cancelled')),
  installments_paid INTEGER NOT NULL DEFAULT 0,
  total_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_redeemed NUMERIC(12,2) NOT NULL DEFAULT 0,
  benefit_used BOOLEAN NOT NULL DEFAULT FALSE,
  next_due_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  transfer_history JSONB NOT NULL DEFAULT '[]'::JSONB,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_by TEXT NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT jewellery_schemes_balance_check CHECK (amount_redeemed >= 0 AND amount_redeemed <= total_paid)
);

-- Savings plan: installments every day / week / month, or a single one-time deposit.
ALTER TABLE public.jewellery_schemes ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'monthly';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jewellery_schemes_frequency_check') THEN
    ALTER TABLE public.jewellery_schemes ADD CONSTRAINT jewellery_schemes_frequency_check
      CHECK (frequency IN ('daily', 'weekly', 'monthly', 'one_time'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS jewellery_schemes_phone_idx ON public.jewellery_schemes(phone);
CREATE INDEX IF NOT EXISTS jewellery_schemes_status_idx ON public.jewellery_schemes(status);
CREATE INDEX IF NOT EXISTS jewellery_schemes_next_due_idx ON public.jewellery_schemes(next_due_date) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.scheme_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id UUID NOT NULL REFERENCES public.jewellery_schemes(id) ON DELETE RESTRICT,
  installment_number INTEGER NOT NULL CHECK (installment_number > 0),
  due_date DATE NOT NULL,
  amount_due NUMERIC(12,2) NOT NULL CHECK (amount_due > 0),
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_date TIMESTAMPTZ,
  payment_method TEXT,
  receipt_number TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scheme_installments_unique UNIQUE (scheme_id, installment_number)
);

CREATE INDEX IF NOT EXISTS scheme_installments_scheme_idx ON public.scheme_installments(scheme_id, installment_number);
CREATE INDEX IF NOT EXISTS scheme_installments_paid_idx ON public.scheme_installments(payment_date DESC) WHERE status = 'paid';

-- A paid installment is a permanent payment record: it can never be edited or deleted.
CREATE OR REPLACE FUNCTION public.scheme_installments_protect_paid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'Installment % of this scheme is already paid and cannot be changed.', OLD.installment_number;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scheme_installments_protect ON public.scheme_installments;
CREATE TRIGGER scheme_installments_protect
  BEFORE UPDATE OR DELETE ON public.scheme_installments
  FOR EACH ROW EXECUTE FUNCTION public.scheme_installments_protect_paid();

CREATE TABLE IF NOT EXISTS public.scheme_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id UUID NOT NULL REFERENCES public.jewellery_schemes(id) ON DELETE RESTRICT,
  invoice_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  invoice_no TEXT,
  amount_used NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_used >= 0),
  benefit_applied NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (benefit_applied >= 0),
  balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reversed')),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT 'Admin'
);

CREATE INDEX IF NOT EXISTS scheme_redemptions_scheme_idx ON public.scheme_redemptions(scheme_id, redeemed_at DESC);

-- ----------------------------------------------------------------------------
-- 6. Scheme redemption details on invoices (orders)
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheme_id UUID REFERENCES public.jewellery_schemes(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheme_number TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheme_amount_used NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheme_discount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheme_balance_after NUMERIC(12,2);

-- ----------------------------------------------------------------------------
-- 7. Scheme RPCs (atomic, row-locked)
-- ----------------------------------------------------------------------------

-- Status for a scheme whose installments are all paid.
CREATE OR REPLACE FUNCTION public.scheme_paid_status(p_maturity DATE)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_maturity <= CURRENT_DATE THEN 'matured' ELSE 'completed' END;
$$;

-- Finds the customer by phone (updating the name if given) or creates them.
CREATE OR REPLACE FUNCTION public.jewellery_upsert_customer(p_phone TEXT, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_name TEXT := COALESCE(BTRIM(p_name), '');
BEGIN
  SELECT id INTO v_id FROM public.customers WHERE phone = p_phone ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_name <> '' THEN
      UPDATE public.customers SET name = v_name, updated_at = NOW() WHERE id = v_id;
    END IF;
    RETURN v_id;
  END IF;
  INSERT INTO public.customers (phone, name) VALUES (p_phone, v_name) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Earlier version without the plan (frequency) parameter.
DROP FUNCTION IF EXISTS public.create_jewellery_scheme(TEXT, TEXT, TEXT, NUMERIC, INTEGER, INTEGER, DATE, DATE, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_jewellery_scheme(
  p_phone TEXT,
  p_customer_name TEXT,
  p_scheme_name TEXT,
  p_monthly_amount NUMERIC,
  p_total_installments INTEGER,
  p_duration_months INTEGER,
  p_start_date DATE,
  p_maturity_date DATE,
  p_benefit_type TEXT,
  p_making_benefit_value NUMERIC,
  p_making_benefit_unit TEXT,
  p_wastage_benefit_value NUMERIC,
  p_wastage_benefit_unit TEXT,
  p_created_by TEXT DEFAULT 'Admin',
  p_notes TEXT DEFAULT '',
  p_frequency TEXT DEFAULT 'monthly'
)
RETURNS public.jewellery_schemes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone TEXT := BTRIM(COALESCE(p_phone, ''));
  v_freq TEXT := COALESCE(NULLIF(BTRIM(p_frequency), ''), 'monthly');
  v_customer_id UUID;
  v_scheme public.jewellery_schemes;
  v_number TEXT;
  i INTEGER;
BEGIN
  IF v_phone = '' THEN RAISE EXCEPTION 'Customer phone number is required.'; END IF;
  IF COALESCE(p_monthly_amount, 0) <= 0 THEN RAISE EXCEPTION 'Monthly installment must be greater than zero.'; END IF;
  IF COALESCE(p_total_installments, 0) <= 0 THEN RAISE EXCEPTION 'Number of installments must be at least 1.'; END IF;
  IF v_freq NOT IN ('daily', 'weekly', 'monthly', 'one_time') THEN RAISE EXCEPTION 'Invalid savings plan: %.', v_freq; END IF;
  IF v_freq = 'one_time' AND p_total_installments <> 1 THEN RAISE EXCEPTION 'A one-time deposit has exactly one payment.'; END IF;
  IF p_start_date IS NULL OR p_maturity_date IS NULL OR p_maturity_date < p_start_date THEN
    RAISE EXCEPTION 'Maturity date must be on or after the start date.';
  END IF;

  -- Reuse the existing customer record (keyed by phone) or create it.
  v_customer_id := public.jewellery_upsert_customer(v_phone, p_customer_name);

  LOOP
    v_number := 'SCH' || LPAD(nextval('public.scheme_number_seq')::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.jewellery_schemes WHERE scheme_number = v_number);
  END LOOP;

  INSERT INTO public.jewellery_schemes (
    scheme_number, customer_id, customer_name, phone, scheme_name, monthly_amount,
    duration_months, total_installments, start_date, maturity_date, benefit_type,
    making_benefit_value, making_benefit_unit, wastage_benefit_value, wastage_benefit_unit,
    status, next_due_date, notes, created_by, frequency
  ) VALUES (
    v_number, v_customer_id, COALESCE(BTRIM(p_customer_name), ''), v_phone, BTRIM(p_scheme_name), p_monthly_amount,
    COALESCE(p_duration_months, p_total_installments), p_total_installments, p_start_date, p_maturity_date,
    COALESCE(p_benefit_type, 'making'),
    COALESCE(p_making_benefit_value, 0), COALESCE(p_making_benefit_unit, 'percent'),
    COALESCE(p_wastage_benefit_value, 0), COALESCE(p_wastage_benefit_unit, 'percent'),
    'active', p_start_date, COALESCE(p_notes, ''), COALESCE(p_created_by, 'Admin'), v_freq
  ) RETURNING * INTO v_scheme;

  FOR i IN 1..p_total_installments LOOP
    INSERT INTO public.scheme_installments (scheme_id, installment_number, due_date, amount_due)
    VALUES (v_scheme.id, i, CASE v_freq
      WHEN 'daily' THEN p_start_date + (i - 1)
      WHEN 'weekly' THEN p_start_date + 7 * (i - 1)
      ELSE (p_start_date + make_interval(months => i - 1))::DATE
    END, p_monthly_amount);
  END LOOP;

  RETURN v_scheme;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_scheme_installment(
  p_scheme_id UUID,
  p_payment_method TEXT,
  p_created_by TEXT DEFAULT 'Admin',
  p_notes TEXT DEFAULT ''
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scheme public.jewellery_schemes;
  v_inst public.scheme_installments;
  v_receipt TEXT;
  v_next_due DATE;
  v_status TEXT;
BEGIN
  SELECT * INTO v_scheme FROM public.jewellery_schemes WHERE id = p_scheme_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scheme not found.'; END IF;
  IF v_scheme.status <> 'active' THEN
    RAISE EXCEPTION 'Scheme % is %, no further installments can be collected.', v_scheme.scheme_number, v_scheme.status;
  END IF;

  SELECT * INTO v_inst FROM public.scheme_installments
  WHERE scheme_id = p_scheme_id AND status = 'pending'
  ORDER BY installment_number
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'All installments of this scheme are already paid.'; END IF;

  LOOP
    v_receipt := 'SR' || LPAD(nextval('public.scheme_receipt_seq')::TEXT, 7, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.scheme_installments WHERE receipt_number = v_receipt);
  END LOOP;

  UPDATE public.scheme_installments
  SET status = 'paid',
      amount_paid = v_inst.amount_due,
      payment_date = NOW(),
      payment_method = COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash'),
      receipt_number = v_receipt,
      created_by = COALESCE(p_created_by, 'Admin'),
      notes = COALESCE(p_notes, '')
  WHERE id = v_inst.id
  RETURNING * INTO v_inst;

  SELECT MIN(due_date) INTO v_next_due FROM public.scheme_installments
  WHERE scheme_id = p_scheme_id AND status = 'pending';

  v_status := CASE WHEN v_next_due IS NULL THEN public.scheme_paid_status(v_scheme.maturity_date) ELSE 'active' END;

  UPDATE public.jewellery_schemes
  SET installments_paid = installments_paid + 1,
      total_paid = total_paid + v_inst.amount_paid,
      next_due_date = v_next_due,
      status = v_status,
      updated_at = NOW()
  WHERE id = p_scheme_id
  RETURNING * INTO v_scheme;

  RETURN json_build_object('installment', row_to_json(v_inst), 'scheme', row_to_json(v_scheme));
END;
$$;

-- Reserves scheme balance / benefit for a bill. Called before the order is
-- created; linked to the order afterwards, or reversed if the bill fails.
CREATE OR REPLACE FUNCTION public.redeem_jewellery_scheme(
  p_scheme_id UUID,
  p_amount NUMERIC,
  p_benefit_amount NUMERIC,
  p_allow_partial BOOLEAN DEFAULT TRUE,
  p_require_maturity BOOLEAN DEFAULT FALSE,
  p_expiry_months INTEGER DEFAULT 0,
  p_created_by TEXT DEFAULT 'Admin'
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scheme public.jewellery_schemes;
  v_status TEXT;
  v_balance NUMERIC;
  v_amount NUMERIC := ROUND(COALESCE(p_amount, 0), 2);
  v_benefit NUMERIC := ROUND(COALESCE(p_benefit_amount, 0), 2);
  v_redemption public.scheme_redemptions;
BEGIN
  SELECT * INTO v_scheme FROM public.jewellery_schemes WHERE id = p_scheme_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scheme not found.'; END IF;

  v_status := CASE WHEN v_scheme.status IN ('completed', 'matured')
                   THEN public.scheme_paid_status(v_scheme.maturity_date)
                   ELSE v_scheme.status END;
  IF v_status NOT IN ('completed', 'matured') THEN
    RAISE EXCEPTION 'Scheme % is not eligible for redemption (status: %).', v_scheme.scheme_number, v_scheme.status;
  END IF;
  IF p_require_maturity AND v_status <> 'matured' THEN
    RAISE EXCEPTION 'Scheme % can only be redeemed on or after its maturity date (%).', v_scheme.scheme_number, v_scheme.maturity_date;
  END IF;
  IF COALESCE(p_expiry_months, 0) > 0
     AND (v_scheme.maturity_date + make_interval(months => p_expiry_months))::DATE < CURRENT_DATE THEN
    RAISE EXCEPTION 'Scheme % expired and can no longer be redeemed.', v_scheme.scheme_number;
  END IF;

  v_balance := v_scheme.total_paid - v_scheme.amount_redeemed;
  IF v_amount < 0 OR v_benefit < 0 THEN RAISE EXCEPTION 'Redemption amounts cannot be negative.'; END IF;
  IF v_amount > v_balance THEN
    RAISE EXCEPTION 'Only % is available in scheme %.', v_balance, v_scheme.scheme_number;
  END IF;
  IF NOT p_allow_partial AND v_amount <> v_balance THEN
    RAISE EXCEPTION 'Partial redemption is not allowed: the full balance of % must be used.', v_balance;
  END IF;
  IF v_benefit > 0 AND v_scheme.benefit_used THEN
    RAISE EXCEPTION 'The benefit of scheme % has already been used.', v_scheme.scheme_number;
  END IF;
  IF v_amount = 0 AND v_benefit = 0 THEN RAISE EXCEPTION 'Nothing to redeem.'; END IF;

  UPDATE public.jewellery_schemes
  SET amount_redeemed = amount_redeemed + v_amount,
      benefit_used = benefit_used OR v_benefit > 0,
      status = CASE WHEN total_paid - (amount_redeemed + v_amount) <= 0 THEN 'redeemed' ELSE v_status END,
      updated_at = NOW()
  WHERE id = p_scheme_id
  RETURNING * INTO v_scheme;

  INSERT INTO public.scheme_redemptions (scheme_id, amount_used, benefit_applied, balance_after, created_by)
  VALUES (p_scheme_id, v_amount, v_benefit, v_scheme.total_paid - v_scheme.amount_redeemed, COALESCE(p_created_by, 'Admin'))
  RETURNING * INTO v_redemption;

  RETURN json_build_object('redemption', row_to_json(v_redemption), 'scheme', row_to_json(v_scheme));
END;
$$;

CREATE OR REPLACE FUNCTION public.link_scheme_redemption(p_redemption_id UUID, p_order_id UUID, p_invoice_no TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.scheme_redemptions
  SET invoice_id = p_order_id, invoice_no = p_invoice_no
  WHERE id = p_redemption_id AND status = 'applied';
END;
$$;

-- Releases a reservation whose bill was never created. Linked redemptions
-- (with an invoice) are permanent and cannot be reversed here.
CREATE OR REPLACE FUNCTION public.reverse_scheme_redemption(p_redemption_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_red public.scheme_redemptions;
  v_scheme public.jewellery_schemes;
BEGIN
  SELECT * INTO v_red FROM public.scheme_redemptions WHERE id = p_redemption_id FOR UPDATE;
  IF NOT FOUND OR v_red.status <> 'applied' THEN RETURN; END IF;
  IF v_red.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'This redemption is already on an invoice and cannot be reversed.';
  END IF;

  SELECT * INTO v_scheme FROM public.jewellery_schemes WHERE id = v_red.scheme_id FOR UPDATE;

  UPDATE public.jewellery_schemes
  SET amount_redeemed = GREATEST(0, amount_redeemed - v_red.amount_used),
      benefit_used = CASE WHEN v_red.benefit_applied > 0 THEN FALSE ELSE benefit_used END,
      status = CASE WHEN status = 'redeemed' THEN public.scheme_paid_status(maturity_date) ELSE status END,
      updated_at = NOW()
  WHERE id = v_red.scheme_id;

  UPDATE public.scheme_redemptions SET status = 'reversed' WHERE id = p_redemption_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_jewellery_scheme(p_scheme_id UUID, p_reason TEXT, p_created_by TEXT DEFAULT 'Admin')
RETURNS public.jewellery_schemes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scheme public.jewellery_schemes;
BEGIN
  SELECT * INTO v_scheme FROM public.jewellery_schemes WHERE id = p_scheme_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scheme not found.'; END IF;
  IF v_scheme.status IN ('redeemed', 'cancelled') THEN
    RAISE EXCEPTION 'Scheme % is already %.', v_scheme.scheme_number, v_scheme.status;
  END IF;
  IF v_scheme.amount_redeemed > 0 THEN
    RAISE EXCEPTION 'Scheme % has been partly redeemed and cannot be cancelled.', v_scheme.scheme_number;
  END IF;

  UPDATE public.jewellery_schemes
  SET status = 'cancelled', cancelled_at = NOW(),
      cancel_reason = COALESCE(p_reason, '') || CASE WHEN p_created_by IS NOT NULL THEN ' (by ' || p_created_by || ')' ELSE '' END,
      next_due_date = NULL, updated_at = NOW()
  WHERE id = p_scheme_id
  RETURNING * INTO v_scheme;
  RETURN v_scheme;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_jewellery_scheme(p_scheme_id UUID, p_phone TEXT, p_customer_name TEXT, p_created_by TEXT DEFAULT 'Admin')
RETURNS public.jewellery_schemes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scheme public.jewellery_schemes;
  v_phone TEXT := BTRIM(COALESCE(p_phone, ''));
  v_customer_id UUID;
BEGIN
  IF v_phone = '' THEN RAISE EXCEPTION 'New customer phone number is required.'; END IF;
  SELECT * INTO v_scheme FROM public.jewellery_schemes WHERE id = p_scheme_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scheme not found.'; END IF;
  IF v_scheme.status IN ('redeemed', 'cancelled') THEN
    RAISE EXCEPTION 'Scheme % is % and cannot be transferred.', v_scheme.scheme_number, v_scheme.status;
  END IF;

  v_customer_id := public.jewellery_upsert_customer(v_phone, p_customer_name);

  UPDATE public.jewellery_schemes
  SET transfer_history = transfer_history || jsonb_build_array(jsonb_build_object(
        'from_phone', phone, 'from_name', customer_name, 'to_phone', v_phone,
        'to_name', COALESCE(BTRIM(p_customer_name), ''), 'at', NOW(), 'by', COALESCE(p_created_by, 'Admin'))),
      customer_id = v_customer_id,
      phone = v_phone,
      customer_name = COALESCE(NULLIF(BTRIM(p_customer_name), ''), customer_name),
      updated_at = NOW()
  WHERE id = p_scheme_id
  RETURNING * INTO v_scheme;
  RETURN v_scheme;
END;
$$;

-- Promotes paid-up schemes to "matured" once their maturity date arrives.
CREATE OR REPLACE FUNCTION public.refresh_scheme_maturity()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.jewellery_schemes
  SET status = 'matured', updated_at = NOW()
  WHERE status = 'completed' AND maturity_date <= CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_jewellery_scheme(TEXT, TEXT, TEXT, NUMERIC, INTEGER, INTEGER, DATE, DATE, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_scheme_installment(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_jewellery_scheme(UUID, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_scheme_redemption(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_scheme_redemption(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_jewellery_scheme(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_jewellery_scheme(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_scheme_maturity() TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. Row level security — same portal model as the rest of the schema
-- ----------------------------------------------------------------------------
ALTER TABLE public.metal_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jewellery_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheme_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheme_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS metal_rates_portal_manage ON public.metal_rates;
CREATE POLICY metal_rates_portal_manage ON public.metal_rates FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS jewellery_schemes_portal_manage ON public.jewellery_schemes;
CREATE POLICY jewellery_schemes_portal_manage ON public.jewellery_schemes FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS scheme_installments_portal_manage ON public.scheme_installments;
CREATE POLICY scheme_installments_portal_manage ON public.scheme_installments FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS scheme_redemptions_portal_manage ON public.scheme_redemptions;
CREATE POLICY scheme_redemptions_portal_manage ON public.scheme_redemptions FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

GRANT SELECT ON public.current_metal_rates TO anon, authenticated;

-- Live updates for the POS when rates change.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'metal_rates'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.metal_rates;
  END IF;
END $$;

-- ============================================================================
-- 9. More jewellery item details
-- ============================================================================
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS other_weight NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS hallmark_status TEXT;
-- Optional stone / diamond details: { type, count, value, carat, clarity, colour, cut, certificate }
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stone_details JSONB;

-- ============================================================================
-- 10. Invoice / permission settings
-- ============================================================================
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS gstin TEXT NOT NULL DEFAULT '';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS state_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS state_code TEXT NOT NULL DEFAULT '';
-- { staffMaxDiscountPercent, staffCanCustomiseSchemes }
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS pos_permissions JSONB;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_gstin TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS exchange_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS advance_amount_used NUMERIC(12,2) NOT NULL DEFAULT 0;
-- Amount collected at the counter (total minus scheme, advance and old-gold adjustments).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2);

-- ============================================================================
-- 11. Audit log — append-only record of sensitive changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  old_value JSONB,
  new_value JSONB,
  user_name TEXT NOT NULL DEFAULT 'System',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON public.audit_logs(created_at DESC);

CREATE OR REPLACE FUNCTION public.audit_logs_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit log entries cannot be changed or deleted.';
END;
$$;
DROP TRIGGER IF EXISTS audit_logs_no_change ON public.audit_logs;
CREATE TRIGGER audit_logs_no_change
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_append_only();

-- Every metal rate change is logged by the database itself (old -> new).
CREATE OR REPLACE FUNCTION public.audit_metal_rate_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev NUMERIC;
BEGIN
  SELECT rate_per_gram INTO v_prev FROM public.metal_rates
  WHERE metal_type = NEW.metal_type AND purity = NEW.purity AND id <> NEW.id AND effective_from <= NEW.effective_from
  ORDER BY effective_from DESC, id DESC LIMIT 1;
  INSERT INTO public.audit_logs (action, entity_type, entity_id, old_value, new_value, user_name, note)
  VALUES ('metal_rate_changed', 'metal_rate', NEW.metal_type || ':' || NEW.purity,
          CASE WHEN v_prev IS NULL THEN NULL ELSE jsonb_build_object('rate_per_gram', v_prev) END,
          jsonb_build_object('rate_per_gram', NEW.rate_per_gram, 'effective_from', NEW.effective_from),
          NEW.created_by, NEW.note);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS metal_rates_audit ON public.metal_rates;
CREATE TRIGGER metal_rates_audit AFTER INSERT ON public.metal_rates
  FOR EACH ROW EXECUTE FUNCTION public.audit_metal_rate_insert();

-- ============================================================================
-- 12. Customer advances (advance payments usable on later bills)
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS public.advance_receipt_seq START WITH 1;
CREATE TABLE IF NOT EXISTS public.customer_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE DEFAULT ('ADV' || LPAD(nextval('public.advance_receipt_seq')::TEXT, 6, '0')),
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  amount_used NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  purpose TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'payment' CHECK (source IN ('payment', 'exchange')),
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_advances_used_check CHECK (amount_used >= 0 AND amount_used <= amount)
);
CREATE INDEX IF NOT EXISTS customer_advances_phone_idx ON public.customer_advances(phone);

CREATE TABLE IF NOT EXISTS public.advance_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id UUID NOT NULL REFERENCES public.customer_advances(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  invoice_no TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reversed')),
  created_by TEXT NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS advance_usages_advance_idx ON public.advance_usages(advance_id);

-- Reserves part of an advance for a bill (row-locked so it can never be used twice).
CREATE OR REPLACE FUNCTION public.reserve_customer_advance(p_advance_id UUID, p_amount NUMERIC, p_created_by TEXT DEFAULT 'Admin')
RETURNS public.advance_usages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_adv public.customer_advances;
  v_amount NUMERIC := ROUND(COALESCE(p_amount, 0), 2);
  v_usage public.advance_usages;
BEGIN
  SELECT * INTO v_adv FROM public.customer_advances WHERE id = p_advance_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Advance not found.'; END IF;
  IF v_adv.status <> 'active' THEN RAISE EXCEPTION 'Advance % is %.', v_adv.receipt_number, v_adv.status; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Advance amount to use must be greater than zero.'; END IF;
  IF v_amount > v_adv.amount - v_adv.amount_used THEN
    RAISE EXCEPTION 'Only % is left on advance %.', v_adv.amount - v_adv.amount_used, v_adv.receipt_number;
  END IF;
  UPDATE public.customer_advances
  SET amount_used = amount_used + v_amount,
      status = CASE WHEN amount_used + v_amount >= amount THEN 'used' ELSE 'active' END,
      updated_at = NOW()
  WHERE id = p_advance_id;
  INSERT INTO public.advance_usages (advance_id, amount, created_by)
  VALUES (p_advance_id, v_amount, COALESCE(p_created_by, 'Admin'))
  RETURNING * INTO v_usage;
  RETURN v_usage;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_advance_usage(p_usage_id UUID, p_order_id UUID, p_invoice_no TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.advance_usages SET order_id = p_order_id, invoice_no = p_invoice_no
  WHERE id = p_usage_id AND status = 'applied';
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_advance_usage(p_usage_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_use public.advance_usages;
BEGIN
  SELECT * INTO v_use FROM public.advance_usages WHERE id = p_usage_id FOR UPDATE;
  IF NOT FOUND OR v_use.status <> 'applied' THEN RETURN; END IF;
  IF v_use.order_id IS NOT NULL THEN RAISE EXCEPTION 'This advance is already on an invoice.'; END IF;
  UPDATE public.customer_advances
  SET amount_used = GREATEST(0, amount_used - v_use.amount), status = 'active', updated_at = NOW()
  WHERE id = v_use.advance_id;
  UPDATE public.advance_usages SET status = 'reversed' WHERE id = p_usage_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_customer_advance(p_advance_id UUID, p_reason TEXT, p_created_by TEXT DEFAULT 'Admin')
RETURNS public.customer_advances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_adv public.customer_advances;
BEGIN
  SELECT * INTO v_adv FROM public.customer_advances WHERE id = p_advance_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Advance not found.'; END IF;
  IF v_adv.amount_used > 0 THEN RAISE EXCEPTION 'Advance % has already been used on a bill.', v_adv.receipt_number; END IF;
  IF v_adv.status <> 'active' THEN RAISE EXCEPTION 'Advance % is already %.', v_adv.receipt_number, v_adv.status; END IF;
  UPDATE public.customer_advances
  SET status = 'cancelled',
      notes = BTRIM(notes || ' Cancelled: ' || COALESCE(p_reason, '') || ' (by ' || COALESCE(p_created_by, 'Admin') || ')'),
      updated_at = NOW()
  WHERE id = p_advance_id RETURNING * INTO v_adv;
  RETURN v_adv;
END;
$$;

-- ============================================================================
-- 13. Old gold exchange (taken in part-payment, linked to the bill)
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS public.old_gold_seq START WITH 1;
CREATE TABLE IF NOT EXISTS public.old_gold_exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_number TEXT NOT NULL UNIQUE DEFAULT ('OG' || LPAD(nextval('public.old_gold_seq')::TEXT, 6, '0')),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  invoice_no TEXT,
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  metal_type TEXT NOT NULL DEFAULT 'gold',
  purity TEXT NOT NULL DEFAULT '',
  tested_purity NUMERIC(6,2),
  gross_weight NUMERIC(12,3) NOT NULL DEFAULT 0,
  stone_weight NUMERIC(12,3) NOT NULL DEFAULT 0,
  net_weight NUMERIC(12,3) NOT NULL DEFAULT 0,
  melting_deduction_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  exchange_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_value NUMERIC(12,2) NOT NULL CHECK (net_value >= 0),
  created_by TEXT NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS old_gold_exchanges_order_idx ON public.old_gold_exchanges(order_id);
CREATE INDEX IF NOT EXISTS old_gold_exchanges_phone_idx ON public.old_gold_exchanges(phone);

-- ============================================================================
-- 14. Returns & exchanges — linked to the original invoice, which is never changed
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS public.return_number_seq START WITH 1;
CREATE TABLE IF NOT EXISTS public.sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT NOT NULL UNIQUE DEFAULT ('RT' || LPAD(nextval('public.return_number_seq')::TEXT, 6, '0')),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  invoice_no TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  -- [{ line, name, quantity, line_total, amount, product_id, variant_id, is_manual, jewellery }]
  items JSONB NOT NULL DEFAULT '[]'::JSONB,
  return_type TEXT NOT NULL DEFAULT 'refund' CHECK (return_type IN ('refund', 'exchange')),
  reason TEXT NOT NULL DEFAULT '',
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  refund_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  credit_advance_id UUID REFERENCES public.customer_advances(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL DEFAULT 'Staff',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sales_returns_order_idx ON public.sales_returns(order_id);

-- Approving a return puts catalogue items back in stock and, for an exchange,
-- creates a customer credit (advance) to use on the new bill.
CREATE OR REPLACE FUNCTION public.approve_sales_return(p_return_id UUID, p_approved_by TEXT DEFAULT 'Admin')
RETURNS public.sales_returns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ret public.sales_returns;
  v_item JSONB;
  v_pid BIGINT;
  v_vid UUID;
  v_qty NUMERIC;
  v_before NUMERIC;
  v_adv_id UUID;
BEGIN
  SELECT * INTO v_ret FROM public.sales_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Return not found.'; END IF;
  IF v_ret.status <> 'pending' THEN RAISE EXCEPTION 'Return % is already %.', v_ret.return_number, v_ret.status; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_ret.items) LOOP
    CONTINUE WHEN LOWER(COALESCE(v_item->>'is_manual', 'false')) = 'true';
    CONTINUE WHEN COALESCE(v_item->>'product_id', '') !~ '^[0-9]+$';
    v_pid := (v_item->>'product_id')::BIGINT;
    v_qty := CASE WHEN COALESCE(v_item->>'quantity', '') ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_item->>'quantity')::NUMERIC ELSE 0 END;
    CONTINUE WHEN v_qty <= 0;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_pid AND COALESCE(category, '') <> 'Unregistered');
    v_vid := NULL;
    IF COALESCE(v_item->>'variant_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_vid := (v_item->>'variant_id')::UUID;
      UPDATE public.product_variants SET stock = stock + v_qty, updated_at = NOW() WHERE id = v_vid;
    END IF;
    SELECT stock_quantity INTO v_before FROM public.products WHERE id = v_pid FOR UPDATE;
    UPDATE public.products SET stock_quantity = COALESCE(v_before, 0) + v_qty, updated_at = NOW() WHERE id = v_pid;
    INSERT INTO public.inventory_movements (product_id, variant_id, movement_type, quantity_delta, quantity_before, quantity_after, reference_type, reference_id, note, created_by_name)
    VALUES (v_pid, v_vid, 'RETURN', v_qty, COALESCE(v_before, 0), COALESCE(v_before, 0) + v_qty,
            'return', v_ret.return_number, 'Returned from ' || v_ret.invoice_no, COALESCE(p_approved_by, 'Admin'));
  END LOOP;

  IF v_ret.return_type = 'exchange' AND v_ret.refund_amount > 0 THEN
    INSERT INTO public.customer_advances (customer_name, phone, amount, payment_method, purpose, source, source_ref, created_by)
    VALUES (v_ret.customer_name, v_ret.phone, v_ret.refund_amount, 'exchange',
            'Exchange credit for ' || v_ret.invoice_no, 'exchange', v_ret.return_number, COALESCE(p_approved_by, 'Admin'))
    RETURNING id INTO v_adv_id;
  END IF;

  UPDATE public.sales_returns
  SET status = 'approved', approved_by = COALESCE(p_approved_by, 'Admin'), approved_at = NOW(), credit_advance_id = v_adv_id
  WHERE id = p_return_id RETURNING * INTO v_ret;
  RETURN v_ret;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_sales_return(p_return_id UUID, p_rejected_by TEXT DEFAULT 'Admin')
RETURNS public.sales_returns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ret public.sales_returns;
BEGIN
  UPDATE public.sales_returns SET status = 'rejected', approved_by = COALESCE(p_rejected_by, 'Admin'), approved_at = NOW()
  WHERE id = p_return_id AND status = 'pending' RETURNING * INTO v_ret;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a pending return can be rejected.'; END IF;
  RETURN v_ret;
END;
$$;

-- ============================================================================
-- 15. Quotations (estimates at the current rate — never an invoice)
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS public.quotation_number_seq START WITH 1;
CREATE TABLE IF NOT EXISTS public.quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number TEXT NOT NULL UNIQUE DEFAULT ('QT' || LPAD(nextval('public.quotation_number_seq')::TEXT, 6, '0')),
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]'::JSONB,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  valid_until DATE,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'cancelled')),
  created_by TEXT NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 16. Repairs
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS public.repair_number_seq START WITH 1;
CREATE TABLE IF NOT EXISTS public.repairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_number TEXT NOT NULL UNIQUE DEFAULT ('RP' || LPAD(nextval('public.repair_number_seq')::TEXT, 6, '0')),
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  metal_type TEXT NOT NULL DEFAULT '',
  weight NUMERIC(12,3) NOT NULL DEFAULT 0,
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  repair_charge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (repair_charge >= 0),
  advance_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (advance_paid >= 0),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'in_repair', 'ready', 'delivered', 'cancelled')),
  delivered_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS repairs_phone_idx ON public.repairs(phone);

-- ============================================================================
-- 17. Access (same portal model) and grants for the new tables / functions
-- ============================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_logs', 'customer_advances', 'advance_usages', 'old_gold_exchanges', 'sales_returns', 'quotations', 'repairs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_portal_manage', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE)', t || '_portal_manage', t);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.reserve_customer_advance(UUID, NUMERIC, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_advance_usage(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_advance_usage(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_customer_advance(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_sales_return(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_sales_return(UUID, TEXT) TO anon, authenticated;
