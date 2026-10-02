-- ============================================================================
-- Fix invoice numbering, public invoice lookup and advance orders
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- 1. Sequential invoice numbers (INV + 16 digits) from a dedicated sequence.
--    The live POS functions are patched in place (only their invoice-number
--    line changes), so any stock / inventory logic they contain is kept.
-- 2. get_public_invoice_by_number returns the whole order row, so the public
--    invoice page gets total, payment mode and credit status.
-- 3. create_advance_order: casts the delivery date to DATE and no longer
--    writes the generated remaining_balance column (both made it fail on
--    every call). Returns the full row and records the deposit payment.
-- 4. complete_advance_order_v2: creates the final bill in public.orders,
--    links it via completed_order_id and returns order_id, so the WhatsApp
--    invoice link resolves.
-- ============================================================================

-- ── 1. Invoice number sequence ──────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.invoice_no_seq START WITH 1 INCREMENT BY 1;

-- Continue after any sequential numbers that already exist.
SELECT setval(
  'public.invoice_no_seq',
  GREATEST(
    COALESCE((SELECT MAX(SUBSTRING(invoice_no FROM 4)::BIGINT) FROM public.orders WHERE invoice_no ~ '^INV[0-9]{16}$'), 0),
    (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM public.invoice_no_seq)
  ) + 1,
  false
);

CREATE OR REPLACE FUNCTION public.next_invoice_no()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'INV' || LPAD(nextval('public.invoice_no_seq')::TEXT, 16, '0');
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_no() TO anon, authenticated;

-- Patch the invoice-number assignment inside the live order functions.
DO $$
DECLARE
  r RECORD;
  v_def TEXT;
  v_new TEXT;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('complete_pos_sale_with_inventory', 'create_order_with_stock', 'create_order_without_stock')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_def, '(\mv_invoice_no\s*:=\s*)[^;]+;', '\1public.next_invoice_no();', 'g');
    IF v_new = v_def THEN
      IF position('next_invoice_no' IN v_def) = 0 THEN
        RAISE WARNING '%: no "v_invoice_no := ..." line found, NOT patched', r.proname;
      END IF;
    ELSE
      EXECUTE v_new;
      RAISE NOTICE '%: invoice numbering patched', r.proname;
    END IF;
  END LOOP;
END $$;

-- ── 2. Public invoice lookup ────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'get_public_invoice_by_number'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::TEXT;
  END LOOP;
END $$;

CREATE FUNCTION public.get_public_invoice_by_number(p_invoice_no TEXT)
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

-- ── 3 & 4. Advance orders ───────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('create_advance_order', 'complete_advance_order_v2')
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::TEXT;
  END LOOP;
END $$;

CREATE FUNCTION public.create_advance_order(
  p_customer_name TEXT, p_phone TEXT, p_address TEXT, p_product_name TEXT,
  p_category TEXT, p_description TEXT, p_total_amount NUMERIC,
  p_deposit_amount NUMERIC, p_expected_delivery_date TEXT,
  p_remarks TEXT DEFAULT '', p_payment_method TEXT DEFAULT 'cash',
  p_created_by_name TEXT DEFAULT 'Admin', p_products JSONB DEFAULT '[]'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.advance_orders;
  v_deposit_id TEXT;
  v_method TEXT;
BEGIN
  v_method := LOWER(COALESCE(p_payment_method, 'cash'));
  IF v_method NOT IN ('cash', 'upi', 'card') THEN
    v_method := 'cash';
  END IF;

  LOOP
    v_deposit_id := 'DEP-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((FLOOR(RANDOM() * 9000) + 1000)::INT::TEXT, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.advance_orders WHERE deposit_id = v_deposit_id);
  END LOOP;

  INSERT INTO public.advance_orders (
    deposit_id, customer_name, phone, address, product_name, products,
    category, description, total_amount, deposit_amount,
    expected_delivery_date, status, remarks, created_by_name
  ) VALUES (
    v_deposit_id,
    COALESCE(NULLIF(TRIM(p_customer_name), ''), 'Customer'),
    COALESCE(p_phone, ''),
    COALESCE(p_address, ''),
    COALESCE(NULLIF(TRIM(p_product_name), ''), 'Product'),
    COALESCE(p_products, '[]'::JSONB),
    COALESCE(p_category, ''),
    COALESCE(p_description, ''),
    p_total_amount,
    p_deposit_amount,
    NULLIF(TRIM(p_expected_delivery_date), '')::DATE,
    'pending_deposit',
    COALESCE(p_remarks, ''),
    COALESCE(p_created_by_name, 'Admin')
  )
  RETURNING * INTO v_row;

  INSERT INTO public.advance_order_timeline (advance_order_id, event_type, label, remarks)
  VALUES
    (v_row.id, 'created', 'Deposit Created', COALESCE(p_remarks, '')),
    (v_row.id, 'deposit_received', 'Deposit Received', 'Received INR ' || p_deposit_amount || ' via ' || CASE WHEN v_method = 'upi' THEN 'QR' ELSE UPPER(v_method) END);

  INSERT INTO public.advance_order_payments (advance_order_id, payment_type, amount, payment_method, remarks)
  VALUES (v_row.id, 'deposit', p_deposit_amount, v_method, COALESCE(p_remarks, ''))
  ON CONFLICT (advance_order_id, payment_type) DO NOTHING;

  RETURN row_to_json(v_row);
END;
$$;

CREATE FUNCTION public.complete_advance_order_v2(
  p_order_id UUID, p_payment_method TEXT, p_final_amount NUMERIC,
  p_coupon_code TEXT DEFAULT NULL, p_coupon_percentage NUMERIC DEFAULT 0,
  p_manual_discount NUMERIC DEFAULT 0, p_remarks TEXT DEFAULT ''
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adv public.advance_orders;
  v_order_id UUID;
  v_invoice_no TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_method TEXT;
  v_final NUMERIC;
  v_manual NUMERIC;
  v_coupon NUMERIC;
  v_items JSONB;
BEGIN
  SELECT * INTO v_adv FROM public.advance_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advance order not found';
  END IF;

  -- Already completed: return the existing bill instead of creating another.
  IF v_adv.status = 'completed' AND v_adv.completed_order_id IS NOT NULL THEN
    RETURN json_build_object('order_id', v_adv.completed_order_id::TEXT, 'invoice_no', v_adv.invoice_number, 'completed_at', v_adv.completed_at);
  END IF;
  IF v_adv.status = 'cancelled' THEN
    RAISE EXCEPTION 'Advance order is cancelled';
  END IF;

  v_method := LOWER(COALESCE(p_payment_method, 'cash'));
  IF v_method NOT IN ('cash', 'upi', 'card') THEN
    v_method := 'cash';
  END IF;
  v_final  := GREATEST(0, COALESCE(p_final_amount, v_adv.remaining_balance));
  v_manual := GREATEST(0, COALESCE(p_manual_discount, 0));
  v_coupon := GREATEST(0, v_adv.remaining_balance - v_final - v_manual);
  v_items  := CASE WHEN jsonb_typeof(v_adv.products) = 'array' AND jsonb_array_length(v_adv.products) > 0 THEN v_adv.products
                   ELSE jsonb_build_array(jsonb_build_object(
                     'name', v_adv.product_name, 'category', v_adv.category, 'quantity', 1,
                     'base_price', v_adv.total_amount, 'line_total', v_adv.total_amount,
                     'unit', 'piece', 'unit_type', 'unit', 'source', 'advance_order'))
              END;

  v_order_id := gen_random_uuid();
  v_invoice_no := public.next_invoice_no();

  INSERT INTO public.orders (
    id, invoice_no, customer_name, phone, address, items, subtotal, shipping, total,
    status, order_mode, order_type, delivery_charge, discount_amount,
    manual_discount_amount, manual_discount_type, manual_discount_value,
    coupon_code, coupon_percentage, payment_method, payment_mode,
    remarks, billing_date, created_at, updated_at
  ) VALUES (
    v_order_id, v_invoice_no, v_adv.customer_name, v_adv.phone, v_adv.address, v_items,
    v_adv.total_amount, 0, v_adv.deposit_amount + v_final,
    'completed', 'offline', 'advance_order', 0, v_coupon,
    v_manual, 'flat', v_manual,
    p_coupon_code, COALESCE(p_coupon_percentage, 0), v_method, v_method,
    COALESCE(p_remarks, ''), v_now, v_now, v_now
  );

  UPDATE public.advance_orders
  SET status = 'completed',
      completed_at = v_now,
      completed_order_id = v_order_id,
      invoice_number = v_invoice_no,
      final_payment_method = v_method,
      remarks = COALESCE(NULLIF(p_remarks, ''), remarks),
      updated_at = v_now
  WHERE id = p_order_id;

  INSERT INTO public.advance_order_payments (advance_order_id, payment_type, amount, payment_method, remarks, received_at)
  VALUES (p_order_id, 'remaining', v_final, v_method, COALESCE(p_remarks, ''), v_now)
  ON CONFLICT (advance_order_id, payment_type) DO NOTHING;

  INSERT INTO public.advance_order_timeline (advance_order_id, event_type, label, remarks, created_at)
  VALUES
    (p_order_id, 'remaining_payment_received', 'Final Payment Received', COALESCE(p_remarks, ''), v_now),
    (p_order_id, 'delivered', 'Delivered', COALESCE(p_remarks, ''), v_now),
    (p_order_id, 'revenue_posted', 'Revenue Posted (INR ' || (v_adv.deposit_amount + v_final) || ')', COALESCE(p_remarks, ''), v_now),
    (p_order_id, 'invoice_generated', 'Invoice Generated (' || v_invoice_no || ')', COALESCE(p_remarks, ''), v_now);

  RETURN json_build_object('order_id', v_order_id::TEXT, 'invoice_no', v_invoice_no, 'completed_at', v_now);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_advance_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_advance_order_v2(UUID, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Result: every row should say TRUE ───────────────────────────────────────
SELECT p.proname AS function_name,
       pg_get_functiondef(p.oid) LIKE '%next_invoice_no%' AS uses_sequential_invoice_no
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('complete_pos_sale_with_inventory', 'create_order_with_stock', 'complete_advance_order_v2')
ORDER BY 1;
