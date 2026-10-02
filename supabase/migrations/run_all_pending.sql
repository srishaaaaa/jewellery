-- ============================================================================
-- ALL PENDING DATABASE UPDATES IN ONE FILE (New Mahalashmi Stores)
-- Run once in the Supabase SQL Editor: paste everything and click Run.
-- Runs as one transaction: if any part fails, nothing is changed.
-- Safe to re-run.
--
-- Contains, in order:
--   1. stock_deduction_on_sale.sql            - billing takes stock off, deleting a bill puts it back
--   2. fix_adjust_stock_and_credit_status.sql - fixes the stock-adjust uuid error; old credit bills get a status
--   3. customer_event_messages.sql            - birthday / anniversary messages save for every device
--   4. invoice_number_8_digits.sql            - new bills numbered INV10000028, INV10000029, ...
--   5. expense_metrics_full_periods.sql       - expense cards cover the full week / month / year
--   6. variant_mfg_date.sql                   - each pack size keeps its own Mfg date
-- ============================================================================

BEGIN;


-- ############################################################################
-- 1. stock_deduction_on_sale.sql
-- ############################################################################

-- ============================================================================
-- Take stock off when a bill is completed, put it back if the bill is removed.
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- A trigger on public.orders covers every way a bill is completed: POS sales,
-- advance orders completed by final payment, and online orders marked
-- completed in the dashboard.
--   * Bill becomes completed/paid  -> each catalogue item's quantity is taken
--     off its product (or off its variant and the parent product's total) and
--     logged as a SALE movement.
--   * Completed bill deleted, or moved back to pending/cancelled -> exactly
--     what that bill took off is put back, logged as VOID.
-- Manual / Unregistered items are never stock-tracked. Sales are never
-- blocked: stock can go below zero until the next restock or adjustment.
-- Bills completed before this was installed took nothing off, so deleting
-- them does not add stock.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_inv_movements_reference
  ON public.inventory_movements(reference_type, reference_id);

CREATE OR REPLACE FUNCTION public.order_counts_as_sold(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(TRIM(COALESCE(p_status, ''))) IN ('completed', 'paid');
$$;

-- Takes stock off for one order's items (no-op if this order already holds stock).
CREATE OR REPLACE FUNCTION public.apply_order_sale_stock(p_order public.orders)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_pid BIGINT;
  v_vid UUID;
  v_qty NUMERIC;
  v_before NUMERIC;
  v_after NUMERIC;
BEGIN
  IF jsonb_typeof(p_order.items) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;
  -- Already holding stock for this bill (e.g. status set to completed twice).
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE reference_type = 'order' AND reference_id = p_order.id::TEXT
    GROUP BY product_id, variant_id
    HAVING SUM(quantity_delta) <> 0
  ) THEN
    RETURN;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_order.items) LOOP
    CONTINUE WHEN LOWER(COALESCE(v_item->>'is_manual', 'false')) = 'true'
               OR LOWER(COALESCE(v_item->>'source', '')) = 'manual';
    CONTINUE WHEN COALESCE(v_item->>'product_id', '') !~ '^[0-9]+$';
    v_qty := CASE WHEN COALESCE(v_item->>'quantity', '') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN (v_item->>'quantity')::NUMERIC ELSE 0 END;
    CONTINUE WHEN v_qty <= 0;
    v_pid := (v_item->>'product_id')::BIGINT;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.products WHERE id = v_pid AND COALESCE(category, '') <> 'Unregistered'
    );

    v_vid := NULL;
    IF COALESCE(v_item->>'variant_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT id INTO v_vid FROM public.product_variants
      WHERE id = (v_item->>'variant_id')::UUID AND product_id = v_pid;
    END IF;

    IF v_vid IS NOT NULL THEN
      SELECT stock INTO v_before FROM public.product_variants WHERE id = v_vid FOR UPDATE;
      v_after := COALESCE(v_before, 0) - v_qty;
      UPDATE public.product_variants SET stock = v_after, updated_at = NOW() WHERE id = v_vid;
      -- The parent product's stock is the total of its variants.
      UPDATE public.products SET stock_quantity = stock_quantity - v_qty, updated_at = NOW() WHERE id = v_pid;
    ELSE
      SELECT stock_quantity INTO v_before FROM public.products WHERE id = v_pid FOR UPDATE;
      v_after := COALESCE(v_before, 0) - v_qty;
      UPDATE public.products SET stock_quantity = v_after, updated_at = NOW() WHERE id = v_pid;
    END IF;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, movement_type, quantity_delta, quantity_before, quantity_after,
      reference_type, reference_id, note, created_by_name
    ) VALUES (
      v_pid, v_vid, 'SALE', -v_qty, COALESCE(v_before, 0), v_after,
      'order', p_order.id::TEXT, 'Bill ' || COALESCE(p_order.invoice_no, ''), 'POS'
    );
  END LOOP;
END;
$$;

-- Puts back whatever stock an order still holds (no-op if it holds none).
CREATE OR REPLACE FUNCTION public.reverse_order_sale_stock(p_order_id UUID, p_invoice_no TEXT, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_before NUMERIC;
  v_after NUMERIC;
BEGIN
  FOR r IN
    SELECT product_id, variant_id, -SUM(quantity_delta) AS qty
    FROM public.inventory_movements
    WHERE reference_type = 'order' AND reference_id = p_order_id::TEXT AND product_id IS NOT NULL
    GROUP BY product_id, variant_id
    HAVING SUM(quantity_delta) < 0
  LOOP
    IF r.variant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.product_variants WHERE id = r.variant_id) THEN
      SELECT stock INTO v_before FROM public.product_variants WHERE id = r.variant_id FOR UPDATE;
      v_after := COALESCE(v_before, 0) + r.qty;
      UPDATE public.product_variants SET stock = v_after, updated_at = NOW() WHERE id = r.variant_id;
      UPDATE public.products SET stock_quantity = stock_quantity + r.qty, updated_at = NOW() WHERE id = r.product_id;
    ELSE
      SELECT stock_quantity INTO v_before FROM public.products WHERE id = r.product_id FOR UPDATE;
      CONTINUE WHEN NOT FOUND;
      v_after := COALESCE(v_before, 0) + r.qty;
      UPDATE public.products SET stock_quantity = v_after, updated_at = NOW() WHERE id = r.product_id;
    END IF;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, movement_type, quantity_delta, quantity_before, quantity_after,
      reference_type, reference_id, note, created_by_name
    ) VALUES (
      r.product_id, CASE WHEN EXISTS (SELECT 1 FROM public.product_variants WHERE id = r.variant_id) THEN r.variant_id END,
      'VOID', r.qty, COALESCE(v_before, 0), v_after,
      'order', p_order_id::TEXT, p_reason || ' ' || COALESCE(p_invoice_no, ''), 'POS'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.orders_stock_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.order_counts_as_sold(OLD.status) THEN
      PERFORM public.reverse_order_sale_stock(OLD.id, OLD.invoice_no, 'Bill deleted');
    END IF;
    RETURN OLD;
  END IF;

  IF public.order_counts_as_sold(NEW.status)
     AND (TG_OP = 'INSERT' OR NOT public.order_counts_as_sold(OLD.status)) THEN
    PERFORM public.apply_order_sale_stock(NEW);
  ELSIF TG_OP = 'UPDATE' AND public.order_counts_as_sold(OLD.status) AND NOT public.order_counts_as_sold(NEW.status) THEN
    PERFORM public.reverse_order_sale_stock(NEW.id, NEW.invoice_no, 'Bill set to ' || COALESCE(NEW.status, '') || ':');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_stock_trigger ON public.orders;
CREATE TRIGGER orders_stock_trigger
AFTER INSERT OR DELETE OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_stock_trigger();


-- ############################################################################
-- 2. fix_adjust_stock_and_credit_status.sql
-- ############################################################################

-- ============================================================================
-- 1. Fix "column variant_id is of type uuid but expression is of type text"
--    when adjusting stock (Restock / Customer Return / Loss / Reconciliation).
--    The variant id arrives as TEXT and was written into UUID columns without
--    a cast, so every adjustment failed. A size/variant change now also keeps
--    the parent product's total in step, the same way sales do.
-- 2. Credit bills saved without a credit_status (older bills) are marked
--    'outstanding', so they show in Outstanding Credits and can be marked paid.
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(
  p_product_id INTEGER, p_variant_id TEXT DEFAULT NULL,
  p_new_quantity NUMERIC DEFAULT 0, p_reason TEXT DEFAULT 'CORRECTION',
  p_note TEXT DEFAULT '', p_created_by_name TEXT DEFAULT 'Admin'
)
RETURNS JSON AS $$
DECLARE
  v_variant_id UUID := NULLIF(TRIM(COALESCE(p_variant_id, '')), '')::UUID;
  v_quantity_before NUMERIC;
  v_quantity_after NUMERIC := p_new_quantity;
  v_quantity_delta NUMERIC;
BEGIN
  IF v_variant_id IS NOT NULL THEN
    SELECT stock INTO v_quantity_before FROM public.product_variants WHERE id = v_variant_id FOR UPDATE;
    UPDATE public.product_variants SET stock = p_new_quantity, updated_at = NOW() WHERE id = v_variant_id;
  ELSE
    SELECT stock_quantity INTO v_quantity_before FROM public.products WHERE id = p_product_id FOR UPDATE;
    UPDATE public.products SET stock_quantity = p_new_quantity, updated_at = NOW() WHERE id = p_product_id;
  END IF;

  v_quantity_delta := COALESCE(v_quantity_after, 0) - COALESCE(v_quantity_before, 0);

  -- The parent product's stock is the total of its variants.
  IF v_variant_id IS NOT NULL THEN
    UPDATE public.products SET stock_quantity = stock_quantity + v_quantity_delta, updated_at = NOW() WHERE id = p_product_id;
  END IF;

  INSERT INTO public.inventory_movements (
    product_id, variant_id, movement_type, quantity_delta, quantity_before, quantity_after,
    reference_type, note, created_by_name, created_at
  ) VALUES (
    p_product_id, v_variant_id, p_reason, v_quantity_delta,
    COALESCE(v_quantity_before, 0), COALESCE(v_quantity_after, 0),
    'adjustment', COALESCE(p_note, ''), COALESCE(p_created_by_name, 'Admin'), NOW()
  );

  RETURN json_build_object(
    'product_id', p_product_id,
    'variant_id', v_variant_id,
    'quantity_before', COALESCE(v_quantity_before, 0),
    'quantity_after', v_quantity_after,
    'quantity_delta', v_quantity_delta
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.adjust_inventory_stock(INTEGER, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated, anon, public;

UPDATE public.orders
SET credit_status = 'outstanding'
WHERE is_credit = TRUE AND credit_status IS NULL;

NOTIFY pgrst, 'reload schema';


-- ############################################################################
-- 3. customer_event_messages.sql
-- ############################################################################

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


-- ############################################################################
-- 4. invoice_number_8_digits.sql
-- ############################################################################

-- ============================================================================
-- Invoice numbers as INV + 8 digits (INV10000028) instead of INV + 16 digits.
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- * New bills: 'INV' || (10000000 + next sequence value). The sequence is not
--   reset, so numbering simply continues (bill #28 -> INV10000028). Numbers
--   already used by older bills are skipped.
-- * Existing bills keep their stored number (WhatsApp links already sent keep
--   working); the app shows INV0000000000000025 as INV10000025, and the public
--   invoice page accepts either form.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.next_invoice_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_no TEXT;
BEGIN
  LOOP
    v_no := 'INV' || (10000000 + nextval('public.invoice_no_seq'))::TEXT;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE UPPER(invoice_no) = v_no OR invoice_no = SUBSTRING(v_no FROM 4)
    );
  END LOOP;
  RETURN v_no;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_no() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_invoice_by_number(p_invoice_no TEXT)
RETURNS SETOF public.orders
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id TEXT := TRIM(COALESCE(p_invoice_no, ''));
BEGIN
  RETURN QUERY
  SELECT o.* FROM public.orders o
  WHERE UPPER(o.invoice_no) = UPPER(v_id)
  ORDER BY o.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN;
  END IF;

  -- 8-digit display number of a bill stored with 16 digits:
  -- INV10000025 -> INV0000000000000025.
  IF v_id ~* '^(INV)?1[0-9]{7}$' THEN
    RETURN QUERY
    SELECT o.* FROM public.orders o
    WHERE o.invoice_no = 'INV' || LPAD((RIGHT(v_id, 8)::BIGINT - 10000000)::TEXT, 16, '0')
    LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  -- Links sent before the link fix shortened sequential numbers to their last
  -- 8 digits (INV0000000000000013 -> INV00000013): expand them back.
  IF v_id ~* '^(INV)?[0-9]{1,16}$' THEN
    RETURN QUERY
    SELECT o.* FROM public.orders o
    WHERE o.invoice_no = 'INV' || LPAD(LTRIM(regexp_replace(v_id, '^INV', '', 'i'), '0'), 16, '0')
    LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  -- WhatsApp links sent before the link fix carried only the last 8 digits of
  -- timestamp-style invoice numbers (INV1790499910038.6 -> INV99100386).
  IF v_id ~* '^(INV)?[0-9]{8}$' THEN
    RETURN QUERY
    SELECT o.* FROM public.orders o
    WHERE o.invoice_no !~ '^INV[0-9]{8}$'
      AND o.invoice_no !~ '^INV[0-9]{16}$'
      AND RIGHT(regexp_replace(o.invoice_no, '[^0-9]', '', 'g'), 8) = RIGHT(v_id, 8)
    ORDER BY o.created_at DESC
    LIMIT 1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_invoice_by_number(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- ############################################################################
-- 5. expense_metrics_full_periods.sql
-- ############################################################################

-- ============================================================================
-- Expense Tracker cards use whole periods, like every date filter in the app:
--   This Week  = Monday to Sunday
--   This Month = 1st to the last day of the month
--   This Year  = 1 January to 31 December
-- (Before, each card stopped at today, so expenses dated later in the period
-- were left out.) The app passes today's local (IST) date as p_current_date.
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_expense_summary_metrics(
  p_current_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today NUMERIC(12,2) := 0;
  v_this_week NUMERIC(12,2) := 0;
  v_this_month NUMERIC(12,2) := 0;
  v_this_year NUMERIC(12,2) := 0;
  v_total_all_time NUMERIC(12,2) := 0;
  v_week_start DATE := date_trunc('week', p_current_date)::DATE;          -- Monday
  v_week_end DATE := (date_trunc('week', p_current_date) + INTERVAL '6 days')::DATE;  -- Sunday
  v_month_start DATE := date_trunc('month', p_current_date)::DATE;
  v_month_end DATE := (date_trunc('month', p_current_date) + INTERVAL '1 month - 1 day')::DATE;
  v_year_start DATE := date_trunc('year', p_current_date)::DATE;
  v_year_end DATE := (date_trunc('year', p_current_date) + INTERVAL '1 year - 1 day')::DATE;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN expense_date = p_current_date THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN expense_date BETWEEN v_week_start AND v_week_end THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN expense_date BETWEEN v_month_start AND v_month_end THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN expense_date BETWEEN v_year_start AND v_year_end THEN amount ELSE 0 END), 0),
    COALESCE(SUM(amount), 0)
  INTO
    v_today, v_this_week, v_this_month, v_this_year, v_total_all_time
  FROM public.expenses;

  RETURN jsonb_build_object(
    'today', v_today,
    'this_week', v_this_week,
    'this_month', v_this_month,
    'this_year', v_this_year,
    'total_all_time', v_total_all_time
  );
END;
$$;

NOTIFY pgrst, 'reload schema';


-- ############################################################################
-- 6. variant_mfg_date.sql
-- ############################################################################

-- ============================================================================
-- Each pack size (product variant) keeps its own batch dates.
-- product_variants already has expiry_date; this adds mfg_date.
-- Until this is run, the app still saves each pack size's expiry date and
-- simply skips its Mfg date. Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS mfg_date DATE;

NOTIFY pgrst, 'reload schema';


COMMIT;

-- ============================================================================
-- CHECK: every column below should say true
-- ============================================================================
SELECT
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_stock_trigger')                                         AS stock_reduces_on_bill,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'store_settings' AND column_name = 'customer_event_messages') AS birthday_messages_save,
  (SELECT COUNT(*) = 0 FROM public.orders WHERE is_credit = TRUE AND credit_status IS NULL)                      AS credit_bills_have_status,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'product_variants' AND column_name = 'mfg_date') AS pack_size_mfg_date,
  (SELECT 'INV' || (10000000 + last_value + 1)::TEXT FROM public.invoice_no_seq)                                  AS next_invoice_number;
