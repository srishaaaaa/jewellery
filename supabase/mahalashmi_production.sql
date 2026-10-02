-- ============================================================================
-- Mahalashmi Stores - Complete Deployment Schema
--
-- PRODUCTION READY: All tables, functions, policies, and migrations merged
-- This is the ONLY file needed for fresh deployment, and it is safe to re-run on
-- the live database: tables are only created if missing, every function it drops
-- is recreated, invoice numbers continue from the current number, and existing
-- store settings are never overwritten.
-- Generated: 2026-09-27
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- DROP EXISTING RPC FUNCTIONS (Handle ALL signature conflicts)
-- Aggressive cleanup for function overloads and old versions
-- ============================================================================

-- Drops every version (overload) of these functions; a plain DROP FUNCTION name
-- fails when a function has more than one version. All are recreated below.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'complete_advance_order_v2', 'add_advance_order_event', 'update_advance_order_status',
        'create_advance_order', 'create_barcode_and_receive_stock', 'get_public_invoice_by_number',
        'create_order_without_stock', 'create_order_with_stock', 'complete_pos_sale_with_inventory',
        'adjust_inventory_stock', 'mark_credit_order_paid', 'get_expense_summary_metrics',
        'generate_barcode_value'
      )
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::TEXT || ' CASCADE';
  END LOOP;
END $$;

-- ============================================================================
-- SEQUENCES
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.customer_code_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START WITH 10000001;
CREATE SEQUENCE IF NOT EXISTS public.deposit_number_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS public.barcode_product_seq START WITH 10000001;
CREATE SEQUENCE IF NOT EXISTS public.barcode_variant_seq START WITH 10000001;

-- ============================================================================
-- TABLES - UNITS & MEASUREMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.unit_types (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL UNIQUE,
  name_ta TEXT NOT NULL DEFAULT '',
  abbreviation TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('weight', 'volume', 'count', 'length', 'area')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.unit_conversions (
  id BIGSERIAL PRIMARY KEY,
  from_unit_id BIGINT NOT NULL REFERENCES public.unit_types(id) ON DELETE RESTRICT,
  to_unit_id BIGINT NOT NULL REFERENCES public.unit_types(id) ON DELETE RESTRICT,
  conversion_factor NUMERIC(12,4) NOT NULL CHECK (conversion_factor > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(from_unit_id, to_unit_id)
);

-- ============================================================================
-- TABLES - CORE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_code TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  email TEXT,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.categories (
  id BIGSERIAL PRIMARY KEY,
  name_en TEXT NOT NULL UNIQUE,
  name_ta TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_ta TEXT NOT NULL DEFAULT '',
  tamil_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  category_id BIGINT REFERENCES public.categories(id) ON DELETE SET NULL,
  remedy TEXT[] NOT NULL DEFAULT '{}',
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  offer_price NUMERIC(12,2),
  purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  mrp NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  unit_type TEXT NOT NULL DEFAULT 'unit' CHECK (unit_type IN ('unit', 'weight', 'volume', 'bundle')),
  unit_label TEXT NOT NULL DEFAULT 'piece',
  unit TEXT NOT NULL DEFAULT 'piece',
  base_quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  stock_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  opening_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  stock_unit TEXT NOT NULL DEFAULT 'piece',
  low_stock_alert NUMERIC(12,3) NOT NULL DEFAULT 5,
  allow_decimal_quantity BOOLEAN NOT NULL DEFAULT FALSE,
  predefined_options JSONB NOT NULL DEFAULT '[]'::JSONB,
  description TEXT NOT NULL DEFAULT '',
  description_ta TEXT NOT NULL DEFAULT '',
  benefits TEXT NOT NULL DEFAULT '',
  benefits_ta TEXT NOT NULL DEFAULT '',
  image TEXT,
  image_url TEXT,
  sku TEXT,
  barcode TEXT,
  brand TEXT,
  supplier TEXT,
  size TEXT,
  color TEXT,
  rating NUMERIC(3,1) NOT NULL DEFAULT 5,
  has_variants BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  has_special_offer BOOLEAN NOT NULL DEFAULT FALSE,
  special_offer_note TEXT NOT NULL DEFAULT '',
  special_offer_cost NUMERIC NOT NULL DEFAULT 0,
  expiry_date DATE,
  mfg_date DATE,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS products_category_name_unique
  ON public.products (category_id, LOWER(BTRIM(name)));

CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_name TEXT NOT NULL,
  size_label TEXT,
  quantity NUMERIC(12,3),
  quantity_unit_id BIGINT REFERENCES public.unit_types(id) ON DELETE SET NULL,
  weight_value NUMERIC(12,3),
  weight_unit TEXT,
  sku TEXT,
  barcode TEXT,
  purchase_price NUMERIC(12,2),
  mrp NUMERIC(12,2),
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  damage_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  expiry_date DATE,
  mfg_date DATE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  group_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pack size batch manufacturing date (added after launch)
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS mfg_date DATE;


CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_name_unique
  ON public.product_variants (product_id, LOWER(BTRIM(variant_name)));

CREATE TABLE IF NOT EXISTS public.product_price_history (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
  old_purchase_price NUMERIC(12,2),
  new_purchase_price NUMERIC(12,2) NOT NULL,
  old_selling_price NUMERIC(12,2),
  new_selling_price NUMERIC(12,2) NOT NULL,
  change_reason TEXT,
  changed_by_name TEXT NOT NULL DEFAULT 'Staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.damage_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_id BIGINT REFERENCES public.unit_types(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  reported_by_name TEXT NOT NULL DEFAULT 'Staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.coupons (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  percentage NUMERIC(5,2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expiry_date TIMESTAMPTZ,
  usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
  usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  min_order_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_upper_unique ON public.coupons (UPPER(BTRIM(code)));

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

CREATE TABLE IF NOT EXISTS public.order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL DEFAULT 'Product',
  name TEXT NOT NULL DEFAULT 'Product',
  product_tamil_name TEXT,
  tamil_name TEXT,
  variant_name TEXT,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'piece',
  unit_type TEXT NOT NULL DEFAULT 'unit',
  base_quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  base_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  image_url TEXT,
  is_manual BOOLEAN NOT NULL DEFAULT FALSE,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'catalogue',
  note TEXT,
  category TEXT,
  special_offer_note TEXT,
  special_offer_cost NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.store_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'New Mahalashmi Stores',
  owner_name TEXT NOT NULL DEFAULT 'M. Senthamil',
  phone TEXT NOT NULL DEFAULT '9865975714, 8668151051',
  email TEXT NOT NULL DEFAULT 'senthamil75714@gmail.com',
  address TEXT NOT NULL DEFAULT '5/85, Teacher''s Colony, Masinaickanpatty, Ayyothiyapattanam, Salem - 636103',
  gst_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  instagram_handle TEXT NOT NULL DEFAULT 'mahalashmi_stores',
  low_stock_threshold NUMERIC(12,3) NOT NULL DEFAULT 5,
  logo_url TEXT,
  admin_id TEXT,
  admin_password TEXT,
  staff_id TEXT,
  staff_password TEXT,
  expiry_alert_days INTEGER NOT NULL DEFAULT 30,
  accent_color TEXT NOT NULL DEFAULT '#2E7D32',
  business_type TEXT NOT NULL DEFAULT '',
  shop_contact_number TEXT NOT NULL DEFAULT '9865975714, 8668151051',
  customer_event_messages JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Birthday / anniversary offer list and WhatsApp message template (added after launch)
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS customer_event_messages JSONB NOT NULL DEFAULT '{}'::JSONB;

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

CREATE TABLE IF NOT EXISTS public.advance_order_timeline (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  advance_order_id UUID NOT NULL REFERENCES public.advance_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  label TEXT NOT NULL,
  remarks TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.advance_order_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_order_id UUID NOT NULL REFERENCES public.advance_orders(id) ON DELETE CASCADE,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('deposit','remaining')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','upi','card')),
  remarks TEXT NOT NULL DEFAULT '',
  received_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (advance_order_id, payment_type)
);

CREATE TABLE IF NOT EXISTS public.store_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT,
  reviewer TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.barcode_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode_value TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product', 'variant')),
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_barcode_entity_target CHECK (
    (entity_type = 'product' AND variant_id IS NULL) OR
    (entity_type = 'variant' AND variant_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  barcode_id UUID REFERENCES public.barcode_registry(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL CHECK (
    movement_type IN ('INITIAL_BARCODE_STOCK', 'RESTOCK', 'SALE', 'RETURN', 'DAMAGE', 'CORRECTION', 'VOID')
  ),
  quantity_delta NUMERIC NOT NULL,
  quantity_before NUMERIC NOT NULL,
  quantity_after NUMERIC NOT NULL,
  unit_cost NUMERIC DEFAULT NULL,
  reference_type TEXT DEFAULT NULL,
  reference_id TEXT DEFAULT NULL,
  note TEXT DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_expense_category_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category_id BIGINT REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  category_name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  description TEXT DEFAULT '',
  payment_mode TEXT DEFAULT 'cash',
  recorded_by_name TEXT DEFAULT 'Staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.barcode_custom_sizes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  labels_per_row INTEGER NOT NULL DEFAULT 1 CHECK (labels_per_row >= 1),
  width_mm NUMERIC(8, 2) NOT NULL CHECK (width_mm > 0),
  height_mm NUMERIC(8, 2) NOT NULL CHECK (height_mm > 0),
  horizontal_gap_mm NUMERIC(8, 2) NOT NULL DEFAULT 0 CHECK (horizontal_gap_mm >= 0),
  is_custom BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  birthday DATE,
  anniversary DATE,
  birthday_wish_sent_on DATE,
  anniversary_wish_sent_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'product_variants'
    AND column_name = 'expiry_date'
  ) THEN
    ALTER TABLE public.product_variants ADD COLUMN expiry_date DATE;
  END IF;
END $$;

-- The app saves a reference number on advance orders.
ALTER TABLE public.advance_orders ADD COLUMN IF NOT EXISTS reference_number TEXT NOT NULL DEFAULT '';

-- Columns added to product_variants after some databases were created.
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS quantity NUMERIC(12,3);
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS quantity_unit_id BIGINT REFERENCES public.unit_types(id) ON DELETE SET NULL;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS damage_stock NUMERIC(12,3) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_unit_conversions ON public.unit_conversions(from_unit_id, to_unit_id);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON public.product_price_history(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_damage_stock_product ON public.damage_stock(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_variants_expiry ON public.product_variants(expiry_date) WHERE expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_category_id_idx ON public.products(category_id);
CREATE INDEX IF NOT EXISTS products_active_sort_idx ON public.products(is_active, sort_order);
CREATE INDEX IF NOT EXISTS variants_product_id_idx ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_phone_idx ON public.orders(phone);
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_invoice_no ON public.orders(invoice_no);
CREATE INDEX IF NOT EXISTS idx_orders_billing_date ON public.orders(billing_date);
CREATE INDEX IF NOT EXISTS idx_orders_credit_status ON public.orders(credit_status) WHERE credit_status = 'outstanding';
CREATE INDEX IF NOT EXISTS idx_orders_credit_due_date ON public.orders(credit_due_date) WHERE credit_status = 'outstanding';

CREATE INDEX IF NOT EXISTS advance_orders_created_idx ON public.advance_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS advance_orders_status_idx ON public.advance_orders(status);
CREATE INDEX IF NOT EXISTS advance_orders_delivery_idx ON public.advance_orders(expected_delivery_date);
CREATE INDEX IF NOT EXISTS advance_order_timeline_order_idx ON public.advance_order_timeline(advance_order_id, created_at);
CREATE INDEX IF NOT EXISTS advance_order_payments_order_idx ON public.advance_order_payments(advance_order_id, received_at);
CREATE INDEX IF NOT EXISTS idx_advance_orders_invoice_number ON public.advance_orders(invoice_number);

CREATE INDEX IF NOT EXISTS idx_barcode_registry_val ON public.barcode_registry(barcode_value);
CREATE INDEX IF NOT EXISTS idx_barcode_registry_prod ON public.barcode_registry(product_id);
CREATE INDEX IF NOT EXISTS idx_barcode_registry_var ON public.barcode_registry(variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_movements_prod ON public.inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_var ON public.inventory_movements(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_type ON public.inventory_movements(movement_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_barcode_custom_sizes_created_at ON public.barcode_custom_sizes(created_at ASC);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expense_categories_active ON public.expense_categories(is_active);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := CASE WHEN COALESCE(NEW.raw_user_meta_data ->> 'role', '') = 'admin' THEN 'admin' ELSE 'customer' END;
BEGIN
  INSERT INTO public.profiles (id, customer_code, name, mobile, email, role)
  VALUES (
    NEW.id,
    'CUST-' || LPAD(nextval('public.customer_code_seq')::TEXT, 5, '0'),
    COALESCE(NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'name'), ''), split_part(COALESCE(NEW.email, ''), '@', 1), 'Customer'),
    COALESCE(NEW.raw_user_meta_data ->> 'mobile', ''),
    NEW.email,
    v_role
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    mobile = EXCLUDED.mobile,
    email = EXCLUDED.email,
    updated_at = NOW();

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::JSONB) || jsonb_build_object('role', v_role)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.sync_product_category_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT name_en INTO NEW.category FROM public.categories WHERE id = NEW.category_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_product_category_name_trigger ON public.products;
CREATE TRIGGER sync_product_category_name_trigger
BEFORE INSERT OR UPDATE OF category_id ON public.products
FOR EACH ROW EXECUTE FUNCTION public.sync_product_category_name();

CREATE OR REPLACE FUNCTION public.sync_category_name_to_products()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name_en IS DISTINCT FROM OLD.name_en THEN
    UPDATE public.products SET category = NEW.name_en, updated_at = NOW() WHERE category_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_category_name_to_products_trigger ON public.categories;
CREATE TRIGGER sync_category_name_to_products_trigger
AFTER UPDATE OF name_en ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.sync_category_name_to_products();

CREATE OR REPLACE FUNCTION public.ensure_one_default_variant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.product_variants
    SET is_default = FALSE, updated_at = NOW()
    WHERE product_id = NEW.product_id AND id <> NEW.id AND is_default;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_one_default_variant_trigger ON public.product_variants;
CREATE TRIGGER ensure_one_default_variant_trigger
AFTER INSERT OR UPDATE OF is_default ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.ensure_one_default_variant();

CREATE OR REPLACE FUNCTION public.generate_barcode_value(p_entity_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_entity_type = 'variant' THEN
    RETURN 'PBV' || LPAD(nextval('public.barcode_variant_seq')::TEXT, 8, '0');
  ELSE
    RETURN 'PBP' || LPAD(nextval('public.barcode_product_seq')::TEXT, 8, '0');
  END IF;
END;
$$;

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

-- ============================================================================
-- INVOICE COUNTER SEQUENCE
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.invoice_no_seq START WITH 1 INCREMENT BY 1;

-- Continue after any sequential invoice numbers that already exist (never goes backwards).
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

-- ============================================================================
-- RPC FUNCTIONS - ORDER & INVENTORY MANAGEMENT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_pos_sale_with_inventory(
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
  v_item JSONB;
BEGIN
  v_order_id := gen_random_uuid();
  v_order_created_at := NOW();
  v_invoice_no := public.next_invoice_no();

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
  v_invoice_no := public.next_invoice_no();

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

CREATE OR REPLACE FUNCTION public.create_advance_order(
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

CREATE OR REPLACE FUNCTION public.complete_advance_order_v2(
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

-- Returns the full advance order row: the app replaces its list entry with it.
CREATE OR REPLACE FUNCTION public.update_advance_order_status(
  p_order_id UUID, p_status TEXT, p_remarks TEXT DEFAULT ''
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.advance_orders;
BEGIN
  IF p_status = 'completed' THEN
    RAISE EXCEPTION 'Use complete_advance_order_v2 to complete an advance order';
  END IF;

  UPDATE public.advance_orders
  SET status = p_status,
      remarks = COALESCE(NULLIF(p_remarks, ''), remarks),
      updated_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advance order not found';
  END IF;

  INSERT INTO public.advance_order_timeline (advance_order_id, event_type, label, remarks)
  VALUES (
    p_order_id, p_status,
    CASE p_status
      WHEN 'ready_for_delivery' THEN 'Ready for Pickup'
      WHEN 'waiting_final_payment' THEN 'Customer Contacted'
      WHEN 'cancelled' THEN 'Cancelled'
      ELSE 'Pending Deposit'
    END,
    COALESCE(p_remarks, '')
  );

  RETURN row_to_json(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_advance_order_event(
  p_order_id UUID, p_event_type TEXT, p_label TEXT, p_remarks TEXT DEFAULT ''
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.advance_order_timeline;
BEGIN
  INSERT INTO public.advance_order_timeline (advance_order_id, event_type, label, remarks)
  VALUES (p_order_id, p_event_type, p_label, COALESCE(p_remarks, ''))
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

-- Assigns a barcode to a product or variant (reusing it if it is already theirs)
-- and optionally receives stock, logging an inventory movement.
CREATE OR REPLACE FUNCTION public.create_barcode_and_receive_stock(
  p_product_id INTEGER, p_variant_id TEXT DEFAULT NULL,
  p_quantity_received NUMERIC DEFAULT 1, p_unit_cost NUMERIC DEFAULT NULL,
  p_created_by_name TEXT DEFAULT 'Admin', p_custom_barcode TEXT DEFAULT NULL,
  p_note TEXT DEFAULT ''
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant_id UUID := NULLIF(TRIM(COALESCE(p_variant_id, '')), '')::UUID;
  v_entity TEXT := CASE WHEN NULLIF(TRIM(COALESCE(p_variant_id, '')), '') IS NULL THEN 'product' ELSE 'variant' END;
  v_qty NUMERIC := GREATEST(0, COALESCE(p_quantity_received, 0));
  v_by TEXT := COALESCE(NULLIF(p_created_by_name, ''), 'Admin');
  v_barcode public.barcode_registry;
  v_value TEXT;
  v_is_new BOOLEAN := FALSE;
  v_before NUMERIC := 0;
  v_after NUMERIC := 0;
  v_product_name TEXT;
  v_variant_name TEXT;
BEGIN
  SELECT name INTO v_product_name FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;
  IF v_variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = v_variant_id AND product_id = p_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found for this product';
    END IF;
  END IF;

  v_value := UPPER(NULLIF(TRIM(COALESCE(p_custom_barcode, '')), ''));

  IF v_value IS NOT NULL THEN
    SELECT * INTO v_barcode FROM public.barcode_registry WHERE UPPER(barcode_value) = v_value;
    IF FOUND AND (v_barcode.product_id <> p_product_id OR v_barcode.variant_id IS DISTINCT FROM v_variant_id) THEN
      RAISE EXCEPTION 'Barcode % is already assigned to another item', v_value;
    END IF;
  ELSE
    -- No barcode given: reuse the item's active barcode, or generate a new one.
    SELECT * INTO v_barcode FROM public.barcode_registry
    WHERE product_id = p_product_id AND variant_id IS NOT DISTINCT FROM v_variant_id AND is_active
    ORDER BY created_at LIMIT 1;
    IF NOT FOUND THEN
      v_value := public.generate_barcode_value(v_entity);
    END IF;
  END IF;

  IF v_barcode.id IS NULL THEN
    INSERT INTO public.barcode_registry (barcode_value, entity_type, product_id, variant_id, is_active, created_by_name)
    VALUES (v_value, v_entity, p_product_id, v_variant_id, TRUE, v_by)
    RETURNING * INTO v_barcode;
    v_is_new := TRUE;
  ELSIF NOT v_barcode.is_active THEN
    UPDATE public.barcode_registry SET is_active = TRUE, updated_at = NOW() WHERE id = v_barcode.id;
  END IF;

  -- Keep the barcode on the item itself so scans that fall back to it still match.
  IF v_variant_id IS NOT NULL THEN
    UPDATE public.product_variants SET barcode = v_barcode.barcode_value, updated_at = NOW()
    WHERE id = v_variant_id AND COALESCE(barcode, '') = '';
    SELECT stock INTO v_before FROM public.product_variants WHERE id = v_variant_id FOR UPDATE;
  ELSE
    UPDATE public.products SET barcode = v_barcode.barcode_value, updated_at = NOW()
    WHERE id = p_product_id AND COALESCE(barcode, '') = '';
    SELECT stock_quantity INTO v_before FROM public.products WHERE id = p_product_id FOR UPDATE;
  END IF;
  v_before := COALESCE(v_before, 0);
  v_after := v_before + v_qty;

  IF v_qty > 0 THEN
    IF v_variant_id IS NOT NULL THEN
      UPDATE public.product_variants SET stock = v_after, updated_at = NOW() WHERE id = v_variant_id;
    ELSE
      UPDATE public.products SET stock_quantity = v_after, updated_at = NOW() WHERE id = p_product_id;
    END IF;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, barcode_id, movement_type, quantity_delta, quantity_before, quantity_after,
      unit_cost, reference_type, reference_id, note, created_by_name
    ) VALUES (
      p_product_id, v_variant_id, v_barcode.id,
      CASE WHEN v_is_new THEN 'INITIAL_BARCODE_STOCK' ELSE 'RESTOCK' END,
      v_qty, v_before, v_after, p_unit_cost, 'barcode', v_barcode.id::TEXT, COALESCE(p_note, ''), v_by
    );
  END IF;

  RETURN json_build_object(
    'success', TRUE,
    'barcode_id', v_barcode.id::TEXT,
    'barcode_value', v_barcode.barcode_value,
    'is_new_barcode', v_is_new,
    'movement_type', CASE WHEN v_qty = 0 THEN 'NONE' WHEN v_is_new THEN 'INITIAL_BARCODE_STOCK' ELSE 'RESTOCK' END,
    'quantity_before', v_before,
    'quantity_received', v_qty,
    'quantity_after', v_after,
    'product_id', p_product_id,
    'variant_id', v_variant_id::TEXT,
    'product_name', v_product_name,
    'variant_name', v_variant_name
  );
END;
$$;

-- Legacy fallback used by the app only when the newer order RPCs are missing.
CREATE OR REPLACE FUNCTION public.create_order_without_stock(
  p_customer_name TEXT, p_phone TEXT, p_address TEXT, p_items JSONB,
  p_shipping NUMERIC, p_status TEXT, p_order_mode TEXT, p_order_type TEXT,
  p_delivery_charge NUMERIC, p_discount_amount NUMERIC,
  p_manual_discount_amount NUMERIC, p_manual_discount_type TEXT,
  p_manual_discount_value NUMERIC, p_coupon_code TEXT, p_coupon_percentage NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID := gen_random_uuid();
  v_invoice_no TEXT := public.next_invoice_no();
  v_now TIMESTAMPTZ := NOW();
BEGIN
  INSERT INTO public.orders (
    id, invoice_no, customer_name, phone, address, items, shipping,
    status, order_mode, order_type, delivery_charge, discount_amount,
    manual_discount_amount, manual_discount_type, manual_discount_value,
    coupon_code, coupon_percentage, created_at, updated_at
  ) VALUES (
    v_order_id, v_invoice_no, p_customer_name, p_phone, p_address, p_items,
    COALESCE(p_shipping, 0), COALESCE(p_status, 'pending'), COALESCE(p_order_mode, 'online'),
    COALESCE(p_order_type, 'pos_sale'), COALESCE(p_delivery_charge, 0), COALESCE(p_discount_amount, 0),
    COALESCE(p_manual_discount_amount, 0), COALESCE(p_manual_discount_type, 'flat'),
    COALESCE(p_manual_discount_value, 0), p_coupon_code, COALESCE(p_coupon_percentage, 0),
    v_now, v_now
  );

  RETURN json_build_object('order_id', v_order_id::TEXT, 'invoice_no', v_invoice_no, 'created_at', v_now);
END;
$$;

-- Every RPC the app calls must be executable by the portal (anon) and signed-in users.
GRANT EXECUTE ON FUNCTION
  public.complete_pos_sale_with_inventory(TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, JSONB, TEXT, BOOLEAN),
  public.create_order_with_stock(TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, JSONB, TEXT, BOOLEAN),
  public.create_order_without_stock(TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, NUMERIC),
  public.get_public_invoice_by_number(TEXT),
  public.adjust_inventory_stock(INTEGER, TEXT, NUMERIC, TEXT, TEXT, TEXT),
  public.create_advance_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB),
  public.complete_advance_order_v2(UUID, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT),
  public.update_advance_order_status(UUID, TEXT, TEXT),
  public.add_advance_order_event(UUID, TEXT, TEXT, TEXT),
  public.create_barcode_and_receive_stock(INTEGER, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT),
  public.get_expense_summary_metrics(DATE),
  public.generate_barcode_value(TEXT)
TO anon, authenticated;

-- ============================================================================
-- STOCK: taken off when a bill is completed, put back if the bill is removed
-- (see supabase/migrations/stock_deduction_on_sale.sql for details)
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

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advance_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advance_order_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advance_order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barcode_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barcode_custom_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_portal_manage ON public.profiles;
CREATE POLICY profiles_portal_manage ON public.profiles FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS categories_portal_manage ON public.categories;
CREATE POLICY categories_portal_manage ON public.categories FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS products_portal_manage ON public.products;
CREATE POLICY products_portal_manage ON public.products FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS product_variants_portal_manage ON public.product_variants;
CREATE POLICY product_variants_portal_manage ON public.product_variants FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS coupons_portal_manage ON public.coupons;
CREATE POLICY coupons_portal_manage ON public.coupons FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS orders_portal_manage ON public.orders;
CREATE POLICY orders_portal_manage ON public.orders FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS order_items_portal_manage ON public.order_items;
CREATE POLICY order_items_portal_manage ON public.order_items FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS store_settings_portal_manage ON public.store_settings;
CREATE POLICY store_settings_portal_manage ON public.store_settings FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Allow all for advance orders" ON public.advance_orders;
CREATE POLICY "Allow all for advance orders" ON public.advance_orders FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for advance timeline" ON public.advance_order_timeline;
CREATE POLICY "Allow all for advance timeline" ON public.advance_order_timeline FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for advance payments" ON public.advance_order_payments;
CREATE POLICY "Allow all for advance payments" ON public.advance_order_payments FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can insert reviews" ON public.store_reviews;
CREATE POLICY "Anyone can insert reviews" ON public.store_reviews FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can read reviews" ON public.store_reviews;
CREATE POLICY "Anyone can read reviews" ON public.store_reviews FOR SELECT USING (true);

DROP POLICY IF EXISTS barcode_registry_all ON public.barcode_registry;
CREATE POLICY barcode_registry_all ON public.barcode_registry FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS inventory_movements_all ON public.inventory_movements;
CREATE POLICY inventory_movements_all ON public.inventory_movements FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS expense_categories_all ON public.expense_categories;
CREATE POLICY expense_categories_all ON public.expense_categories FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS expenses_all ON public.expenses;
CREATE POLICY expenses_all ON public.expenses FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS barcode_custom_sizes_all ON public.barcode_custom_sizes;
CREATE POLICY barcode_custom_sizes_all ON public.barcode_custom_sizes FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS customers_all ON public.customers;
CREATE POLICY customers_all ON public.customers FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================================
-- SEED DATA - MAHALASHMI STORES (Fresh Deployment)
-- ============================================================================

INSERT INTO public.categories (name_en, name_ta, is_active, sort_order) VALUES
  ('Spices', 'Spices', TRUE, 1),
  ('Grains', 'Grains', TRUE, 2),
  ('Beverages', 'Beverages', TRUE, 3),
  ('Oils & Condiments', 'Oils & Condiments', TRUE, 4),
  ('Snacks & Dry Fruits', 'Snacks & Dry Fruits', TRUE, 5),
  ('Dairy & Eggs', 'Dairy & Eggs', TRUE, 6),
  ('Vegetables', 'Vegetables', TRUE, 7),
  ('Fruits', 'Fruits', TRUE, 8),
  ('Unregistered', 'Unregistered', TRUE, 999)
ON CONFLICT (name_en) DO NOTHING;

INSERT INTO public.store_settings (id, name, owner_name, phone, email, address, instagram_handle, shop_contact_number, accent_color)
VALUES (
  1,
  'New Mahalashmi Stores',
  'M. Senthamil',
  '9865975714, 8668151051',
  'senthamil75714@gmail.com',
  '5/85, Teacher''s Colony, Masinaickanpatty, Ayyothiyapattanam, Salem - 636103',
  'mahalashmi_stores',
  '9865975714, 8668151051',
  '#2E7D32'
)
-- Only seeds a fresh database: never overwrite settings the shop has edited.
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
