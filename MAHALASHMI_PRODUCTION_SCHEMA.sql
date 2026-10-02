-- ============================================================================
-- Mahalashmi Stores - Complete Deployment Schema
--
-- PRODUCTION READY: All tables, functions, policies, and migrations merged
-- This is the ONLY file needed for fresh deployment
-- Generated: 2026-09-27
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- DROP EXISTING RPC FUNCTIONS (Handle ALL signature conflicts)
-- Aggressive cleanup for function overloads and old versions
-- ============================================================================

DROP FUNCTION IF EXISTS public.complete_advance_order_v2 CASCADE;
DROP FUNCTION IF EXISTS public.add_advance_order_event CASCADE;
DROP FUNCTION IF EXISTS public.update_advance_order_status CASCADE;
DROP FUNCTION IF EXISTS public.create_advance_order CASCADE;
DROP FUNCTION IF EXISTS public.create_barcode_and_receive_stock CASCADE;
DROP FUNCTION IF EXISTS public.get_public_invoice_by_number CASCADE;
DROP FUNCTION IF EXISTS public.create_order_without_stock CASCADE;
DROP FUNCTION IF EXISTS public.create_order_with_stock CASCADE;
DROP FUNCTION IF EXISTS public.complete_pos_sale_with_inventory CASCADE;
DROP FUNCTION IF EXISTS public.adjust_inventory_stock CASCADE;

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
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  group_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS public.invoice_counter (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  counter BIGINT NOT NULL DEFAULT 0,
  year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.store_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'New Mahalashmi Stores',
  owner_name TEXT NOT NULL DEFAULT 'M. Senthamil',
  phone TEXT NOT NULL DEFAULT '9865975714, 8668151051',
  email TEXT NOT NULL DEFAULT 'senthamil75714@gmail.com',
  address TEXT NOT NULL DEFAULT '5/85, Teacher''s Colony, Masinaickanpatty, Ayyothiyapattanam, Salem - 636103',
  gst_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  instagram_handle TEXT NOT NULL DEFAULT '@mahalashmi_stores',
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  v_week_start DATE := date_trunc('week', p_current_date)::DATE;
  v_month_start DATE := date_trunc('month', p_current_date)::DATE;
  v_year_start DATE := date_trunc('year', p_current_date)::DATE;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN expense_date = p_current_date THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN expense_date >= v_week_start AND expense_date <= p_current_date THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN expense_date >= v_month_start AND expense_date <= p_current_date THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN expense_date >= v_year_start AND expense_date <= p_current_date THEN amount ELSE 0 END), 0),
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

CREATE SEQUENCE IF NOT EXISTS public.invoice_counter START WITH 1 INCREMENT BY 1;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_counter TO authenticated, anon, public;

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

CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(
  p_product_id INTEGER, p_variant_id TEXT DEFAULT NULL,
  p_new_quantity NUMERIC DEFAULT 0, p_reason TEXT DEFAULT 'CORRECTION',
  p_note TEXT DEFAULT '', p_created_by_name TEXT DEFAULT 'Admin'
)
RETURNS JSON AS $$
DECLARE
  v_quantity_before NUMERIC;
  v_quantity_after NUMERIC := p_new_quantity;
  v_quantity_delta NUMERIC;
  v_created_at TIMESTAMP;
BEGIN
  v_created_at := NOW();

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_quantity_before FROM public.product_variants WHERE id = p_variant_id;
    UPDATE public.product_variants SET stock = p_new_quantity WHERE id = p_variant_id;
  ELSE
    SELECT stock_quantity INTO v_quantity_before FROM public.products WHERE id = p_product_id;
    UPDATE public.products SET stock_quantity = p_new_quantity WHERE id = p_product_id;
  END IF;

  v_quantity_delta := COALESCE(v_quantity_after, 0) - COALESCE(v_quantity_before, 0);

  INSERT INTO public.inventory_movements (
    product_id, variant_id, movement_type, quantity_delta, quantity_before, quantity_after,
    reference_type, note, created_by_name, created_at
  ) VALUES (
    p_product_id, p_variant_id, p_reason, v_quantity_delta,
    COALESCE(v_quantity_before, 0), COALESCE(v_quantity_after, 0),
    'adjustment', COALESCE(p_note, ''), COALESCE(p_created_by_name, 'Admin'), v_created_at
  );

  RETURN json_build_object(
    'product_id', p_product_id,
    'variant_id', p_variant_id,
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

  INSERT INTO public.advance_order_timeline (advance_order_id, event_type, label, remarks, created_at)
  VALUES (v_order_id, 'created', 'Deposit Created', COALESCE(p_remarks, ''), v_created_at);

  RETURN json_build_object(
    'id', v_order_id::TEXT,
    'deposit_id', v_deposit_id,
    'created_at', v_created_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
  v_invoice_no := 'INV' || LPAD(CAST(FLOOR(EXTRACT(EPOCH FROM v_completed_at) * 1000) AS BIGINT)::TEXT, 15, '0');

  SELECT * INTO v_advance_order FROM public.advance_orders WHERE id = p_order_id;

  IF v_advance_order IS NULL THEN
    RAISE EXCEPTION 'Advance order not found';
  END IF;

  UPDATE public.advance_orders
  SET status = 'completed', completed_at = v_completed_at,
      invoice_number = v_invoice_no, final_payment_method = p_payment_method, remarks = COALESCE(p_remarks, remarks),
      updated_at = v_completed_at
  WHERE id = p_order_id;

  INSERT INTO public.advance_order_timeline (advance_order_id, event_type, label, remarks, created_at)
  VALUES
    (p_order_id, 'remaining_payment_received', 'Final Payment Received', COALESCE(p_remarks, ''), v_completed_at),
    (p_order_id, 'delivered', 'Delivered', COALESCE(p_remarks, ''), v_completed_at),
    (p_order_id, 'revenue_posted', 'Revenue Posted', COALESCE(p_remarks, ''), v_completed_at),
    (p_order_id, 'invoice_generated', 'Invoice Generated', v_invoice_no, v_completed_at);

  RETURN json_build_object(
    'order_id', v_completed_order_id::TEXT,
    'invoice_no', v_invoice_no,
    'completed_at', v_completed_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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

INSERT INTO public.invoice_counter (id, counter, year)
VALUES (1, 0, EXTRACT(YEAR FROM NOW())::INTEGER)
ON CONFLICT (id) DO NOTHING;

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
  '@mahalashmi_stores',
  '9865975714, 8668151051',
  '#2E7D32'
)
ON CONFLICT (id) DO UPDATE SET
  name = 'New Mahalashmi Stores',
  owner_name = 'M. Senthamil',
  phone = '9865975714, 8668151051',
  email = 'senthamil75714@gmail.com',
  address = '5/85, Teacher''s Colony, Masinaickanpatty, Ayyothiyapattanam, Salem - 636103',
  instagram_handle = '@mahalashmi_stores',
  shop_contact_number = '9865975714, 8668151051',
  accent_color = '#2E7D32';

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
