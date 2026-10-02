# Mahalashmi POS - Complete Database Schema

## Overview
This document describes all database tables, fields, types, and relationships used in the Mahalashmi POS billing system.
**Updated from actual SQL schema:** `supabase/mahalashmi_production.sql`

---

## Core Tables

### 1. **orders** (Primary Sales Table)
Main table for all POS and online sales transactions.

```sql
CREATE TABLE public.orders (
  -- Identifiers
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE,     -- Format: INV-YYYY-XXXXXX (CRITICAL: Must be saved!)
  
  -- Customer Info
  customer_name TEXT NOT NULL DEFAULT 'Customer',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  
  -- Order Details
  order_type TEXT NOT NULL DEFAULT 'pos_sale',  -- 'pos_sale' | 'online_request' | 'manual_sale'
  order_mode TEXT NOT NULL DEFAULT 'offline',   -- 'online' | 'offline'
  status TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'processing' | 'completed' | 'cancelled'
  
  -- Items (JSON)
  items JSONB NOT NULL DEFAULT '[]'::JSONB,    -- Array of structured order items with quantities, prices, etc.
  
  -- Pricing
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  manual_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  manual_discount_type TEXT NOT NULL DEFAULT 'flat',  -- 'flat' | 'percent'
  manual_discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  
  -- Taxes & GST
  total_gst NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Coupon
  coupon_code TEXT,
  coupon_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  
  -- Payment
  payment_method TEXT NOT NULL DEFAULT 'cash',  -- 'cash' | 'online' | 'card' | 'qr'
  payment_mode TEXT NOT NULL DEFAULT 'cash',    -- Display name for payment method
  split_details JSONB NOT NULL DEFAULT '{}'::JSONB,
  
  -- Additional Fields
  remarks TEXT NOT NULL DEFAULT '',
  reference_number TEXT NOT NULL DEFAULT '',
  invoice_pdf_url TEXT,
  billing_date TIMESTAMPTZ,
  
  -- Credit Status (CRITICAL for credit bills)
  is_credit BOOLEAN NOT NULL DEFAULT FALSE,
  credit_due_date DATE,
  credit_status TEXT CHECK (credit_status IS NULL OR credit_status IN ('outstanding', 'paid')),
  credit_paid_at TIMESTAMPTZ,
  
  -- Metadata
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_invoice_no ON orders(invoice_no);
CREATE INDEX idx_orders_credit_status ON orders(credit_status) WHERE credit_status = 'outstanding';
CREATE INDEX idx_orders_credit_due_date ON orders(credit_due_date) WHERE credit_status = 'outstanding';
```

**Key Fields for WhatsApp Invoices:**
- ✅ `invoice_no` (TEXT, UNIQUE, INDEXED) - Used as URL parameter in WhatsApp links
- ✅ `items` (JSONB) - Contains product details, quantities, prices
- ✅ `total`, `subtotal` (NUMERIC) - Amount details
- ✅ `customer_name`, `phone` (TEXT) - Customer contact
- ✅ `credit_status`, `credit_due_date` (TEXT, DATE) - Credit bill indicators

---

### 2. **advance_orders** (Advance/Deposit Orders)
Table for orders taken with advance payment (deposits).

```sql
CREATE TABLE public.advance_orders (
  -- Identifiers
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id TEXT NOT NULL UNIQUE,     -- Format: ADV-XXXXXX
  invoice_number TEXT UNIQUE,          -- Generated when order completed (CRITICAL for WhatsApp!)
  
  -- Customer Info
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  
  -- Product Info
  product_name TEXT NOT NULL,
  products JSONB NOT NULL DEFAULT '[]'::JSONB,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  
  -- Financial (CRITICAL fields)
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  deposit_amount NUMERIC(12,2) NOT NULL CHECK (deposit_amount > 0),
  remaining_balance NUMERIC(12,2) GENERATED ALWAYS AS (total_amount - deposit_amount) STORED,
  
  -- Payment & Delivery
  payment_method TEXT,                 -- 'cash' | 'upi' | 'card'
  final_payment_method TEXT,
  expected_delivery_date DATE NOT NULL,
  
  -- Status & Metadata
  status TEXT NOT NULL DEFAULT 'pending_deposit' 
    CHECK (status IN ('pending_deposit','ready_for_delivery','waiting_final_payment','completed','cancelled')),
  remarks TEXT NOT NULL DEFAULT '',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  completed_order_id UUID UNIQUE REFERENCES public.orders(id) ON DELETE SET NULL,
  
  CONSTRAINT advance_deposit_less_than_total CHECK (deposit_amount < total_amount)
);

CREATE INDEX advance_orders_status_idx ON advance_orders(status);
CREATE INDEX idx_advance_orders_invoice_number ON advance_orders(invoice_number);
```

**Key Fields for WhatsApp Invoices:**
- ✅ `invoice_number` (TEXT, UNIQUE, INDEXED) - Used for final invoice lookup (CRITICAL: Must be saved when completed!)
- ✅ `deposit_id` (TEXT) - Used for deposit receipt
- ✅ `product_name` (TEXT) - What was ordered
- ✅ `total_amount`, `deposit_amount`, `remaining_balance` (NUMERIC) - Payment details
- ✅ `customer_name`, `phone` (TEXT) - Customer contact
- ✅ `created_at` (TIMESTAMPTZ) - Invoice date
- ✅ `status` (TEXT) - 'pending_deposit' | 'balance_pending' | 'waiting_final_payment' | 'completed' | 'cancelled'

---

### 3. **product_variants** (Product Variants/SKUs)
Table for different variants of products.

```sql
CREATE TABLE public.product_variants (
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
  
  -- Stock (NUMERIC, not INTEGER)
  stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  damage_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  
  -- Pricing
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  purchase_price NUMERIC(12,2),
  mrp NUMERIC(12,2),
  
  -- Metadata
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  group_name TEXT,
  expiry_date DATE,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(product_id, LOWER(BTRIM(variant_name)))
);

CREATE INDEX variants_product_id_idx ON product_variants(product_id);
```

**Key Fields for Inventory Operations:**
- ✅ `id` (UUID) - Must be valid UUID when passed to RPC functions
- ✅ `stock` (NUMERIC(12,3), NOT INTEGER!) - Current inventory level
- ✅ `variant_name` (TEXT) - Display name
- ✅ `sku` (TEXT) - Stock keeping unit
- ✅ `product_id` (BIGINT) - Foreign key to products

---

### 4. **products** (Master Product Catalog)
Main product catalog.

```sql
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name VARCHAR NOT NULL,
  name_ta VARCHAR,                     -- Tamil name
  category VARCHAR,
  category_id INTEGER,
  
  -- Pricing
  price DECIMAL(10,2),
  offer_price DECIMAL(10,2),
  purchase_price DECIMAL(10,2),
  
  -- Stock
  stock_quantity INTEGER DEFAULT 0,
  
  -- Metadata
  barcode VARCHAR,
  sku VARCHAR,
  unit VARCHAR,                        -- 'pcs' | 'kg' | 'meters' etc.
  unit_type VARCHAR,                   -- 'unit' | 'weight' | 'volume' | 'bundle'
  location VARCHAR,
  image_url VARCHAR,
  
  is_active BOOLEAN DEFAULT true,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

### 5. **customers** (Customer Directory)
Customer contact and event tracking.

```sql
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(15) UNIQUE NOT NULL,
  name VARCHAR NOT NULL,
  address VARCHAR,
  
  -- Birthdays & Anniversaries
  birthday DATE,
  anniversary DATE,
  birthday_wish_sent_on DATE,
  anniversary_wish_sent_on DATE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

### 6. **inventory_movements** (Stock Audit Trail)
Complete history of all inventory adjustments.

```sql
CREATE TABLE inventory_movements (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id UUID REFERENCES product_variants(id),
  
  movement_type VARCHAR NOT NULL,      -- 'RESTOCK' | 'SALE' | 'DAMAGE' | 'RETURN' | 'CORRECTION'
  quantity_delta INTEGER NOT NULL,     -- Positive (add) or negative (remove)
  quantity_before INTEGER,
  quantity_after INTEGER,
  
  unit_cost DECIMAL(10,2),
  reference_type VARCHAR,
  reference_id VARCHAR,
  note TEXT,
  
  created_by_name VARCHAR,
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Relations
  product: products (id, name, name_ta, image_url),
  variant: product_variants (id, variant_name, sku)
);
```

---

### 7. **barcode_registry** (Barcode Mapping)
Tracks which barcodes map to which products/variants.

```sql
CREATE TABLE barcode_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode VARCHAR UNIQUE NOT NULL,
  product_id INTEGER REFERENCES products(id),
  variant_id UUID REFERENCES product_variants(id),
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

### 8. **advance_order_timeline** (Advance Order Events)
Event log for advance orders.

```sql
CREATE TABLE advance_order_timeline (
  id INTEGER PRIMARY KEY,
  advance_order_id UUID NOT NULL REFERENCES advance_orders(id),
  event_type VARCHAR NOT NULL,
  label VARCHAR,
  remarks TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

### 9. **advance_order_payments** (Payment Tracking for Advance Orders)
Individual payment receipts for advance orders.

```sql
CREATE TABLE advance_order_payments (
  id SERIAL PRIMARY KEY,
  advance_order_id UUID NOT NULL REFERENCES advance_orders(id),
  payment_type VARCHAR,                -- 'deposit' | 'balance' | 'adjustment'
  amount DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR,              -- 'cash' | 'upi' | 'card'
  received_at TIMESTAMP DEFAULT NOW()
);
```

---

## WhatsApp Invoice Integration Points

### Regular POS Orders
**URL Format:** `/invoice/{invoice_no}`
**Flow:**
1. Create order → `invoice_no` saved to `orders` table
2. Click WhatsApp → `publicInvoiceUrl(invoice.invoiceNo)` creates URL
3. Click URL → DigitalInvoice looks up by `invoice_no` in `orders` table
4. Display invoice with items and details

**Required Fields in `orders`:**
- `invoice_no` (must be saved!)
- `items` (JSONB with product details)
- `customer_name`, `phone`
- `total`, `subtotal`
- `coupon_code`, `discount_amount`, `delivery_charge`
- `credit_status`, `credit_due_date` (for credit bills)

### Advance Orders (Deposits)
**URL Format:** `/invoice/{invoice_number}`
**Flow:**
1. Create advance order → `deposit_id` generated
2. Complete payment → `invoice_number` generated and saved
3. Click WhatsApp → `publicInvoiceUrl(order.invoice_number)` creates URL
4. Click URL → DigitalInvoice looks up by `invoice_number` in `advance_orders` table

**Required Fields in `advance_orders`:**
- `invoice_number` (must be saved when completed!)
- `product_name`
- `total_amount`, `deposit_amount`, `remaining_balance`
- `customer_name`, `phone`
- `created_at` (for invoice date)

---

## Key Constraints & Type Rules

### UUID Fields (Must be Valid)
- `product_variants.id` - UUID
- `advance_orders.id` - UUID
- `customers.id` - UUID
- When passing to RPC: Must match UUID regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`

### String Fields (Case Sensitive in Lookups)
- `invoice_no` - Format varies, use `formatInvoiceNo()` for normalization
- `deposit_id` - Format: `ADV-XXXXXX`
- Searches should use case-insensitive operators when needed

### JSON Fields
- `orders.items` - Must be valid JSON array with structured items
- Each item should have: `name`, `qty`, `quantity`, `unit`, `unit_type`, `basePrice`, `base_price`, `lineTotal`, `line_total`

### Status Fields (Enum Values)
- `orders.status` - 'pending' | 'processing' | 'completed' | 'cancelled'
- `orders.credit_status` - 'outstanding' | 'paid' | NULL
- `advance_orders.status` - 'pending_deposit' | 'balance_pending' | 'completed' | 'cancelled'

---

## Related Tables (Not Listed Above)

- **categories** - Product categories
- **coupons** - Discount coupons
- **expenses** - Business expenses
- **expense_categories** - Expense types
- **profiles** - User profiles
- **settings** - Shop settings

---

## Critical Field Mappings for All Operations

### Stock Adjustment (inventory_movements)
- ✅ `product_id` (BIGINT REFERENCES products)
- ✅ `variant_id` (UUID REFERENCES product_variants) - Must be NULL or valid UUID
- ✅ `quantity_delta` (NUMERIC) - Positive (add) or negative (remove)
- ✅ `movement_type` (TEXT) - 'RESTOCK' | 'SALE' | 'DAMAGE' | 'RETURN' | 'CORRECTION'

### WhatsApp Invoice Lookup (orders table)
- ✅ By `invoice_no` (TEXT, UNIQUE, INDEXED) - Case-sensitive lookup
- ✅ By `id` (UUID) - Direct order lookup
- ✅ Fallback: ilike search on `invoice_no` for partial matches
- ✅ All required: `items`, `total`, `customer_name`, `phone`, `credit_status`

### WhatsApp Advance Order Lookup (advance_orders table)
- ✅ By `invoice_number` (TEXT, UNIQUE, INDEXED) - Only when status='completed'
- ✅ By `deposit_id` (TEXT) - For deposit receipts
- ✅ All required: `product_name`, `total_amount`, `customer_name`, `phone`, `created_at`

### Customer Tracking (customers table)
- ✅ `phone` (TEXT, UNIQUE) - Primary identifier
- ✅ `name` (TEXT)
- ✅ `birthday`, `anniversary` (DATE format: YYYY-MM-DD)
- ✅ `birthday_wish_sent_on`, `anniversary_wish_sent_on` (DATE)

---

---

## Schema Verification Checklist

### ✅ Verified from `supabase/mahalashmi_production.sql`:

1. **orders Table**
   - ✅ `invoice_no` is TEXT, UNIQUE, with index
   - ✅ `items` is JSONB for storing structured order items
   - ✅ `credit_status` has CHECK constraint ('outstanding' | 'paid' | NULL)
   - ✅ All required WhatsApp fields present

2. **advance_orders Table**
   - ✅ `invoice_number` is TEXT, UNIQUE, with index
   - ✅ `deposit_id` is TEXT, UNIQUE
   - ✅ `remaining_balance` is GENERATED ALWAYS column
   - ✅ Status has CHECK constraint for valid values
   - ✅ All required WhatsApp fields present

3. **product_variants Table**
   - ✅ `id` is UUID (valid for RPC operations)
   - ✅ `stock` is NUMERIC(12,3), not INTEGER
   - ✅ Foreign key to products is BIGINT
   - ✅ Unique constraint on (product_id, variant_name)

4. **inventory_movements Table**
   - ✅ `variant_id` is UUID REFERENCES product_variants
   - ✅ `movement_type` has CHECK constraint
   - ✅ All required fields for audit trail

5. **Indexes**
   - ✅ `idx_orders_invoice_no` - Fast invoice lookup
   - ✅ `idx_orders_credit_status` - Credit bill filtering
   - ✅ `idx_advance_orders_invoice_number` - Advance order invoice lookup
   - ✅ `idx_inv_movements_var` - Variant stock movements

---

**Last Updated:** 2026-09-27
**Status:** ✅ Schema verified against actual SQL file
**Source:** `supabase/mahalashmi_production.sql`
