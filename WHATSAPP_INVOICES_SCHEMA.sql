-- ============================================================================
-- WHATSAPP INVOICES SCHEMA - COMPLETE
-- WhatsApp Invoice Generation & Lookup for Mahalashmi POS
-- Generated: 2026-09-27
-- ============================================================================

-- ============================================================================
-- 1. TABLES FOR WHATSAPP INVOICES
-- ============================================================================

-- POS Invoices (Regular Billing, Credit Bills)
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT 'Customer',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]'::JSONB,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  order_mode TEXT NOT NULL DEFAULT 'offline',
  order_type TEXT NOT NULL DEFAULT 'pos_sale',
  delivery_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  manual_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  manual_discount_type TEXT NOT NULL DEFAULT 'flat',
  manual_discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  coupon_code TEXT,
  coupon_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_gst NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_mode TEXT NOT NULL DEFAULT 'cash',
  split_details JSONB NOT NULL DEFAULT '{}'::JSONB,
  remarks TEXT NOT NULL DEFAULT '',
  reference_number TEXT NOT NULL DEFAULT '',
  billing_date TIMESTAMPTZ,
  invoice_pdf_url TEXT,
  is_credit BOOLEAN NOT NULL DEFAULT FALSE,
  credit_due_date DATE,
  credit_status TEXT,
  credit_paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_credit_status_check CHECK (credit_status IS NULL OR credit_status IN ('outstanding', 'paid'))
);

-- Advance Orders (Deposits + Final Invoices)
CREATE TABLE IF NOT EXISTS public.advance_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL,
  products JSONB NOT NULL DEFAULT '[]'::JSONB,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  deposit_amount NUMERIC(12,2) NOT NULL CHECK (deposit_amount > 0),
  remaining_balance NUMERIC(12,2) GENERATED ALWAYS AS (total_amount - deposit_amount) STORED,
  expected_delivery_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_deposit' CHECK (status IN ('pending_deposit','ready_for_delivery','waiting_final_payment','completed','cancelled')),
  remarks TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  completed_order_id UUID UNIQUE REFERENCES public.orders(id) ON DELETE SET NULL,
  invoice_number TEXT UNIQUE,
  final_payment_method TEXT,
  CONSTRAINT advance_deposit_less_than_total CHECK (deposit_amount < total_amount)
);

-- ============================================================================
-- 2. INDEXES FOR WHATSAPP INVOICE LOOKUPS
-- ============================================================================

-- Fast invoice_no lookup for POS invoices
CREATE INDEX IF NOT EXISTS idx_orders_invoice_no ON public.orders(invoice_no);

-- Fast credit bill filtering
CREATE INDEX IF NOT EXISTS idx_orders_credit_status ON public.orders(credit_status) WHERE credit_status = 'outstanding';

-- Fast advance order invoice lookup
CREATE INDEX IF NOT EXISTS idx_advance_orders_invoice_number ON public.advance_orders(invoice_number);

-- Fast advance order status filtering
CREATE INDEX IF NOT EXISTS advance_orders_status_idx ON public.advance_orders(status);

-- ============================================================================
-- 2.5. INVOICE COUNTER SEQUENCE
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.invoice_counter START WITH 1 INCREMENT BY 1;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_counter TO authenticated, anon, public;

-- ============================================================================
-- 3. RPC FUNCTIONS FOR WHATSAPP INVOICE GENERATION
-- ============================================================================

-- FUNCTION 1: Generate POS Invoices
CREATE OR REPLACE FUNCTION public.create_order_with_stock(
  p_customer_name TEXT, p_phone TEXT, p_address TEXT, p_items JSONB,
  p_shipping NUMERIC, p_status TEXT, p_order_mode TEXT, p_order_type TEXT,
  p_delivery_charge NUMERIC, p_discount_amount NUMERIC,
  p_manual_discount_amount NUMERIC, p_manual_discount_type TEXT,
  p_manual_discount_value NUMERIC, p_coupon_code TEXT, p_coupon_percentage NUMERIC,
  p_total_gst NUMERIC DEFAULT 0, p_gst_enabled BOOLEAN DEFAULT FALSE,
  p_payment_method TEXT DEFAULT 'cash', p_split_details JSONB DEFAULT '{}',
  p_credit_due_date TEXT DEFAULT NULL, p_is_credit BOOLEAN DEFAULT FALSE
)
RETURNS JSON AS $$
DECLARE
  v_order_id UUID;
  v_invoice_no TEXT;
  v_order_created_at TIMESTAMP;
BEGIN
  v_order_id := gen_random_uuid();
  v_order_created_at := NOW();
  v_invoice_no := 'INV' || LPAD(CAST(nextval('public.invoice_counter') AS TEXT), 16, '0');

  INSERT INTO public.orders (
    id, invoice_no, customer_name, phone, address, items, shipping,
    status, order_mode, order_type, delivery_charge, discount_amount,
    manual_discount_amount, manual_discount_type, manual_discount_value,
    coupon_code, coupon_percentage, total_gst, gst_enabled, payment_method,
    split_details, is_credit, credit_due_date, created_at, updated_at
  ) VALUES (
    v_order_id, v_invoice_no, p_customer_name, p_phone, p_address, p_items,
    COALESCE(p_shipping, 0), COALESCE(p_status, 'pending'), COALESCE(p_order_mode, 'online'),
    COALESCE(p_order_type, 'pos_sale'), COALESCE(p_delivery_charge, 0), COALESCE(p_discount_amount, 0),
    COALESCE(p_manual_discount_amount, 0), COALESCE(p_manual_discount_type, 'flat'),
    COALESCE(p_manual_discount_value, 0), p_coupon_code, COALESCE(p_coupon_percentage, 0),
    COALESCE(p_total_gst, 0), COALESCE(p_gst_enabled, FALSE), COALESCE(p_payment_method, 'cash'),
    COALESCE(p_split_details, '{}'), COALESCE(p_is_credit, FALSE),
    CASE WHEN p_credit_due_date IS NOT NULL THEN p_credit_due_date::DATE ELSE NULL END,
    v_order_created_at, v_order_created_at
  );

  RETURN json_build_object(
    'order_id', v_order_id::TEXT,
    'invoice_no', v_invoice_no,
    'created_at', v_order_created_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- FUNCTION 2: Lookup POS Invoices by invoice_no
CREATE OR REPLACE FUNCTION public.get_public_invoice_by_number(p_invoice_no TEXT)
RETURNS TABLE (
  id UUID, invoice_no TEXT, customer_name TEXT, phone TEXT, address TEXT,
  items JSONB, shipping NUMERIC, status TEXT, order_mode TEXT, order_type TEXT,
  delivery_charge NUMERIC, discount_amount NUMERIC, manual_discount_amount NUMERIC,
  manual_discount_type TEXT, manual_discount_value NUMERIC, coupon_code TEXT,
  coupon_percentage NUMERIC, total_gst NUMERIC, gst_enabled BOOLEAN, payment_method TEXT,
  split_details JSONB, is_credit BOOLEAN, credit_due_date DATE, created_at TIMESTAMP,
  updated_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.invoice_no, o.customer_name, o.phone, o.address, o.items, o.shipping,
         o.status, o.order_mode, o.order_type, o.delivery_charge, o.discount_amount,
         o.manual_discount_amount, o.manual_discount_type, o.manual_discount_value,
         o.coupon_code, o.coupon_percentage, o.total_gst, o.gst_enabled, o.payment_method,
         o.split_details, o.is_credit, o.credit_due_date, o.created_at, o.updated_at
  FROM public.orders o
  WHERE UPPER(o.invoice_no) = UPPER(COALESCE(p_invoice_no, ''))
  ORDER BY o.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- FUNCTION 3: Create Advance Orders (Deposits)
CREATE OR REPLACE FUNCTION public.create_advance_order(
  p_customer_name TEXT, p_phone TEXT, p_address TEXT, p_product_name TEXT,
  p_category TEXT, p_description TEXT, p_total_amount NUMERIC,
  p_deposit_amount NUMERIC, p_expected_delivery_date TEXT,
  p_remarks TEXT DEFAULT '', p_payment_method TEXT DEFAULT 'cash',
  p_created_by_name TEXT DEFAULT 'Admin', p_products JSONB DEFAULT '[]'
)
RETURNS JSON AS $$
DECLARE
  v_order_id UUID;
  v_deposit_id TEXT;
  v_created_at TIMESTAMP;
BEGIN
  v_order_id := gen_random_uuid();
  v_created_at := NOW();
  v_deposit_id := 'DEP-' || TO_CHAR(v_created_at, 'YYYYMMDD') || '-' || LPAD(CAST(FLOOR(RANDOM()*9000 + 1000) AS TEXT), 4, '0');

  INSERT INTO public.advance_orders (
    id, deposit_id, customer_name, phone, address, product_name, products,
    category, description, total_amount, deposit_amount, remaining_balance,
    expected_delivery_date, status, remarks, created_by_name,
    created_at, updated_at
  ) VALUES (
    v_order_id, v_deposit_id, p_customer_name, p_phone, p_address, p_product_name,
    COALESCE(p_products, '[]'), p_category, p_description, COALESCE(p_total_amount, 0),
    COALESCE(p_deposit_amount, 0),
    COALESCE(p_total_amount, 0) - COALESCE(p_deposit_amount, 0),
    COALESCE(p_expected_delivery_date, NULL),
    'pending_deposit', COALESCE(p_remarks, ''), COALESCE(p_created_by_name, 'Admin'),
    v_created_at, v_created_at
  );

  RETURN json_build_object(
    'id', v_order_id::TEXT,
    'deposit_id', v_deposit_id,
    'created_at', v_created_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- FUNCTION 4: Complete Advance Orders (Final Invoice)
CREATE OR REPLACE FUNCTION public.complete_advance_order_v2(
  p_order_id UUID, p_payment_method TEXT, p_final_amount NUMERIC,
  p_coupon_code TEXT DEFAULT NULL, p_coupon_percentage NUMERIC DEFAULT 0,
  p_manual_discount NUMERIC DEFAULT 0, p_remarks TEXT DEFAULT ''
)
RETURNS JSON AS $$
DECLARE
  v_invoice_no TEXT;
  v_completed_at TIMESTAMP;
  v_advance_order RECORD;
BEGIN
  v_completed_at := NOW();
  v_invoice_no := 'INV' || LPAD(CAST(nextval('public.invoice_counter') AS TEXT), 16, '0');

  SELECT * INTO v_advance_order FROM public.advance_orders WHERE id = p_order_id;

  IF v_advance_order IS NULL THEN
    RAISE EXCEPTION 'Advance order not found';
  END IF;

  UPDATE public.advance_orders
  SET status = 'completed', completed_at = v_completed_at,
      invoice_number = v_invoice_no, final_payment_method = p_payment_method, remarks = COALESCE(p_remarks, remarks),
      updated_at = v_completed_at
  WHERE id = p_order_id;

  RETURN json_build_object(
    'invoice_no', v_invoice_no,
    'completed_at', v_completed_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- FUNCTION 5: Mark Credit Orders as Paid
CREATE OR REPLACE FUNCTION public.mark_credit_order_paid(p_order_id UUID)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.credit_status IS DISTINCT FROM 'outstanding' THEN
    RAISE EXCEPTION 'Order is not an outstanding credit sale';
  END IF;

  UPDATE public.orders
  SET credit_status = 'paid', credit_paid_at = NOW(), updated_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_credit_order_paid(uuid) TO authenticated, anon, public;

-- ============================================================================
-- 4. ROW LEVEL SECURITY FOR WHATSAPP INVOICES
-- ============================================================================

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advance_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_portal_manage ON public.orders;
CREATE POLICY orders_portal_manage ON public.orders FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Allow all for advance orders" ON public.advance_orders;
CREATE POLICY "Allow all for advance orders" ON public.advance_orders FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 5. FIELD REFERENCE FOR WHATSAPP MESSAGE BUILDING
-- ============================================================================

-- POS INVOICES (orders table):
-- ✅ invoice_no          → URL: /invoice/{invoice_no}
-- ✅ items               → Product details (product_name, qty, rate, lineTotal)
-- ✅ total               → Order amount
-- ✅ customer_name       → Recipient name
-- ✅ phone               → WhatsApp phone number
-- ✅ credit_status       → 'outstanding' | 'paid' | NULL
-- ✅ credit_due_date     → Payment deadline for credit bills

-- ADVANCE ORDER DEPOSITS (advance_orders table):
-- ✅ deposit_id          → Receipt identifier
-- ✅ product_name        → What was ordered
-- ✅ total_amount        → Final order amount
-- ✅ deposit_amount      → Advance paid
-- ✅ remaining_balance   → GENERATED: total_amount - deposit_amount
-- ✅ customer_name       → Recipient name
-- ✅ phone               → WhatsApp phone number

-- ADVANCE ORDER FINAL INVOICES (advance_orders table):
-- ✅ invoice_number      → URL: /invoice/{invoice_number}
-- ✅ product_name        → What was delivered
-- ✅ total_amount        → Final amount
-- ✅ customer_name       → Recipient name
-- ✅ phone               → WhatsApp phone number

-- ============================================================================
-- 6. INVOICE GENERATION FORMATS
-- ============================================================================

-- POS Invoice Number Format:
-- 'INV' + timestamp (milliseconds) padded to 15 digits
-- Example: INV44780194567890

-- Deposit Receipt ID Format:
-- 'DEP-' + YYYYMMDD + '-' + 4-digit random number
-- Example: DEP-20260927-1234

-- ============================================================================
-- END OF WHATSAPP INVOICES SCHEMA
-- ============================================================================
