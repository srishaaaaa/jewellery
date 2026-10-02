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
VALUES
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
  ('Other', '', TRUE, 18)
ON CONFLICT (name_en) DO NOTHING;

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
  p_notes TEXT DEFAULT ''
)
RETURNS public.jewellery_schemes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone TEXT := BTRIM(COALESCE(p_phone, ''));
  v_customer_id UUID;
  v_scheme public.jewellery_schemes;
  v_number TEXT;
  i INTEGER;
BEGIN
  IF v_phone = '' THEN RAISE EXCEPTION 'Customer phone number is required.'; END IF;
  IF COALESCE(p_monthly_amount, 0) <= 0 THEN RAISE EXCEPTION 'Monthly installment must be greater than zero.'; END IF;
  IF COALESCE(p_total_installments, 0) <= 0 THEN RAISE EXCEPTION 'Number of installments must be at least 1.'; END IF;
  IF p_start_date IS NULL OR p_maturity_date IS NULL OR p_maturity_date < p_start_date THEN
    RAISE EXCEPTION 'Maturity date must be on or after the start date.';
  END IF;

  -- Reuse the existing customer record (keyed by phone) or create it.
  INSERT INTO public.customers (phone, name)
  VALUES (v_phone, COALESCE(BTRIM(p_customer_name), ''))
  ON CONFLICT (phone) DO UPDATE
    SET name = CASE WHEN BTRIM(COALESCE(EXCLUDED.name, '')) <> '' THEN EXCLUDED.name ELSE public.customers.name END,
        updated_at = NOW()
  RETURNING id INTO v_customer_id;

  LOOP
    v_number := 'SCH' || LPAD(nextval('public.scheme_number_seq')::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.jewellery_schemes WHERE scheme_number = v_number);
  END LOOP;

  INSERT INTO public.jewellery_schemes (
    scheme_number, customer_id, customer_name, phone, scheme_name, monthly_amount,
    duration_months, total_installments, start_date, maturity_date, benefit_type,
    making_benefit_value, making_benefit_unit, wastage_benefit_value, wastage_benefit_unit,
    status, next_due_date, notes, created_by
  ) VALUES (
    v_number, v_customer_id, COALESCE(BTRIM(p_customer_name), ''), v_phone, BTRIM(p_scheme_name), p_monthly_amount,
    COALESCE(p_duration_months, p_total_installments), p_total_installments, p_start_date, p_maturity_date,
    COALESCE(p_benefit_type, 'making'),
    COALESCE(p_making_benefit_value, 0), COALESCE(p_making_benefit_unit, 'percent'),
    COALESCE(p_wastage_benefit_value, 0), COALESCE(p_wastage_benefit_unit, 'percent'),
    'active', p_start_date, COALESCE(p_notes, ''), COALESCE(p_created_by, 'Admin')
  ) RETURNING * INTO v_scheme;

  FOR i IN 1..p_total_installments LOOP
    INSERT INTO public.scheme_installments (scheme_id, installment_number, due_date, amount_due)
    VALUES (v_scheme.id, i, (p_start_date + make_interval(months => i - 1))::DATE, p_monthly_amount);
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

  INSERT INTO public.customers (phone, name)
  VALUES (v_phone, COALESCE(BTRIM(p_customer_name), ''))
  ON CONFLICT (phone) DO UPDATE
    SET name = CASE WHEN BTRIM(COALESCE(EXCLUDED.name, '')) <> '' THEN EXCLUDED.name ELSE public.customers.name END,
        updated_at = NOW()
  RETURNING id INTO v_customer_id;

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

GRANT EXECUTE ON FUNCTION public.create_jewellery_scheme(TEXT, TEXT, TEXT, NUMERIC, INTEGER, INTEGER, DATE, DATE, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO anon, authenticated;
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
