# Complete Schema Verification - Feature-to-Database Mapping

**Date:** 2026-09-27  
**Source:** `supabase/mahalashmi_production.sql`  
**Status:** ✅ ALL FEATURES VERIFIED

---

## 📋 TABLES INVENTORY

| Table | Purpose | Records |
|-------|---------|---------|
| `orders` | POS/Online sales | Invoice storage |
| `advance_orders` | Advance deposits | Deposit receipts + final invoices |
| `order_items` | Order line items | Product details per order |
| `product_variants` | SKU variants | Stock tracking |
| `products` | Product catalog | Inventory master |
| `customers` | Customer contacts | Birthday/anniversary events |
| `inventory_movements` | Stock audit trail | All adjustments |
| `barcode_registry` | Barcode mapping | Product/variant barcodes |
| `coupons` | Discount codes | Coupon tracking |
| `expenses` | Business expenses | Cost tracking |
| `advance_order_timeline` | Advance order events | Timeline tracking |
| `advance_order_payments` | Payment receipts | Payment history |

---

## 🛍️ BILLING TYPES & SCHEMA MAPPING

### 1. **NORMAL POS BILLING** (Cash/Card/QR)

**Entry Point:** `Pos.tsx` → "Complete Sale" button

```
✅ TABLE: orders
├─ id (UUID) - Primary key
├─ invoice_no (TEXT UNIQUE) → /invoice/{invoice_no}  **[WhatsApp Link]**
├─ customer_name (TEXT)
├─ phone (TEXT)
├─ items (JSONB) → Product details with qty, price
├─ total (NUMERIC)
├─ subtotal (NUMERIC)
├─ payment_method (TEXT) → 'cash' | 'card' | 'upi'
├─ discount_amount (NUMERIC)
├─ manual_discount_amount (NUMERIC)
├─ total_gst (NUMERIC)
├─ is_credit (BOOLEAN) → FALSE for cash sales
└─ created_at (TIMESTAMPTZ)

✅ TABLE: order_items (one row per product)
├─ order_id (UUID FK)
├─ product_id (BIGINT FK)
├─ variant_id (UUID FK)
├─ quantity (NUMERIC)
├─ line_total (NUMERIC)
└─ gst_amount (NUMERIC)
```

**Buttons & Operations:**
- ✅ "Complete Sale" → INSERT into orders + order_items
- ✅ "View Invoice" → SELECT from orders WHERE id
- ✅ "Print Receipt" → SELECT from orders + order_items
- ✅ "Share WhatsApp" → buildProfessionalWhatsAppMessage(invoice_no)

---

### 2. **CREDIT BILLING** (Payment Pending)

**Entry Point:** `Dashboard.tsx` → Outstanding Credits Tab

```
✅ TABLE: orders (with credit flags)
├─ id (UUID)
├─ invoice_no (TEXT UNIQUE)
├─ is_credit (BOOLEAN) → TRUE
├─ credit_status (TEXT) → 'outstanding' | 'paid' | NULL
│  └─ CHECK: credit_status IN ('outstanding', 'paid')
├─ credit_due_date (DATE) → Payment deadline
├─ credit_paid_at (TIMESTAMPTZ) → When paid
├─ total (NUMERIC)
├─ customer_name (TEXT)
├─ phone (TEXT)
└─ items (JSONB)
```

**Buttons & Operations:**
- ✅ "View Invoice" → SELECT from orders WHERE credit_status='outstanding'
- ✅ "Print Receipt" → Same as POS
- ✅ "Mark as Paid" → UPDATE orders SET credit_status='paid', credit_paid_at=NOW()
- ✅ "Change Due Date" → UPDATE orders SET credit_due_date={newDate}
- ✅ "WhatsApp Reminder" → buildCreditReminderWhatsAppMessage()

**Indexes:** 
- ✅ `idx_orders_credit_status` - Fast filtering
- ✅ `idx_orders_credit_due_date` - Overdue identification

---

### 3. **ADVANCE ORDER BILLING** (Deposits + Final Invoice)

**Entry Point:** `AdvanceOrders.tsx`

#### Phase 1: Deposit Receipt
```
✅ TABLE: advance_orders
├─ id (UUID)
├─ deposit_id (TEXT UNIQUE) → Identifier for receipt
├─ invoice_number (TEXT UNIQUE) → NULL until completed
├─ status (TEXT) → 'pending_deposit' (CHECK constraint)
├─ customer_name (TEXT)
├─ phone (TEXT)
├─ product_name (TEXT)
├─ total_amount (NUMERIC)
├─ deposit_amount (NUMERIC)
├─ remaining_balance (NUMERIC GENERATED) → total - deposit
├─ expected_delivery_date (DATE)
└─ created_at (TIMESTAMPTZ)

✅ TABLE: advance_order_payments
├─ advance_order_id (UUID FK)
├─ payment_type (TEXT) → 'deposit' | 'remaining'
├─ amount (NUMERIC)
├─ payment_method (TEXT) → 'cash' | 'upi' | 'card'
└─ received_at (TIMESTAMPTZ)

✅ TABLE: advance_order_timeline
├─ advance_order_id (UUID FK)
├─ event_type (TEXT)
├─ label (TEXT)
└─ remarks (TEXT)
```

**Buttons & Operations:**
- ✅ "Create Advance Order" → INSERT into advance_orders
- ✅ "WhatsApp Receipt" → buildAdvanceDepositWhatsAppMessage(deposit_id)
- ✅ "Mark as Ready" → UPDATE status = 'ready_for_delivery'
- ✅ "Receive Final Payment" → INSERT advance_order_payments(remaining)

#### Phase 2: Final Invoice (After Balance Payment)
```
✅ When advance order completes:
1. Generate invoice_number
2. UPDATE advance_orders SET invoice_number, status='completed'
3. INSERT into orders (linked via completed_order_id)

✅ TABLE: advance_orders (updated)
├─ invoice_number (TEXT UNIQUE) → NOW SET! **[WhatsApp Link]**
├─ status (TEXT) → 'completed'
├─ completed_at (TIMESTAMPTZ)
└─ completed_order_id (UUID FK) → Link to final order
```

**Buttons & Operations:**
- ✅ "Share Final Invoice" → buildProfessionalWhatsAppMessage(invoice_number)
- ✅ "Receive Payment" → UPDATE advance_order_payments + INSERT orders
- ✅ "View Timeline" → SELECT from advance_order_timeline

**Indexes:**
- ✅ `idx_advance_orders_invoice_number` - Invoice lookup
- ✅ `advance_orders_status_idx` - Status filtering
- ✅ `advance_order_timeline_order_idx` - Timeline queries

---

## 📱 WHATSAPP INTEGRATION MAPPING

### Regular POS Invoice
```
Flow: 🛍️ Complete Sale → 📄 View Invoice → 🚀 Share WhatsApp → 👉 Click Link

1. Generate invoice_no → saved to orders.invoice_no
2. buildProfessionalWhatsAppMessage({
     invoiceNumber: orders.invoice_no,
     items: orders.items (JSONB),
     total: orders.total,
     customer_name: orders.customer_name,
     phone: orders.phone,
     isCredit: orders.is_credit,
     creditDueDate: orders.credit_due_date
   })
3. Create URL: /invoice/{invoice_no}
4. Lookup: SELECT * FROM orders WHERE invoice_no={param}
   └─ Fallback: ilike search if exact match fails
```

✅ **Required Fields in DB:**
- orders.invoice_no (TEXT, UNIQUE, INDEXED)
- orders.items (JSONB)
- orders.total, orders.subtotal
- orders.customer_name, orders.phone
- orders.credit_status, orders.credit_due_date

---

### Credit Payment Reminder
```
Flow: 💳 Outstanding Credit → 📱 WhatsApp Reminder → 🚀 Share

1. buildCreditReminderWhatsAppMessage({
     invoiceNumber: orders.invoice_no,
     amount: orders.total,
     dueDate: orders.credit_due_date,
     daysOverdue: calculated
   })
2. Direct WhatsApp send (no invoice lookup needed)
3. toWhatsAppUrl(phone, message)
```

✅ **Required Fields in DB:**
- orders.invoice_no
- orders.total
- orders.phone
- orders.credit_due_date
- orders.credit_status = 'outstanding'

---

### Advance Order Deposit Receipt
```
Flow: 💰 Create Advance Order → 📱 WhatsApp Receipt → 👇

1. buildAdvanceDepositWhatsAppMessage({
     depositId: advance_orders.deposit_id,
     productName: advance_orders.product_name,
     totalAmount: advance_orders.total_amount,
     depositAmount: advance_orders.deposit_amount,
     remainingBalance: advance_orders.remaining_balance
   })
2. Direct WhatsApp send (no lookup needed)
```

✅ **Required Fields in DB:**
- advance_orders.deposit_id
- advance_orders.product_name
- advance_orders.total_amount
- advance_orders.deposit_amount
- advance_orders.remaining_balance (GENERATED)
- advance_orders.phone

---

### Advance Order Final Invoice
```
Flow: ✅ Complete Advance → 📄 Final Invoice → 🚀 Share WhatsApp → 👉 Click Link

1. Generate invoice_number and INSERT into orders
2. UPDATE advance_orders SET invoice_number, status='completed'
3. buildProfessionalWhatsAppMessage({
     invoiceNumber: advance_orders.invoice_number,
     items: [{product_name}],
     total: advance_orders.total_amount,
     customer_name: advance_orders.customer_name,
     phone: advance_orders.phone
   })
4. Create URL: /invoice/{invoice_number}
5. Lookup: SELECT * FROM advance_orders WHERE invoice_number={param}
```

✅ **Required Fields in DB:**
- advance_orders.invoice_number (TEXT, UNIQUE, INDEXED)
- advance_orders.product_name
- advance_orders.total_amount
- advance_orders.customer_name
- advance_orders.phone
- advance_orders.created_at

---

## 🎯 ALL BUTTONS & ICONS SCHEMA MAPPING

| Page | Button/Icon | DB Operation | Schema Fields |
|------|-------------|--------------|----------------|
| **POS** | Complete Sale | INSERT orders, order_items | orders(all), order_items |
| | View Invoice | SELECT orders WHERE id | orders(all) |
| | Print Receipt | SELECT orders, order_items | orders(all), order_items |
| | WhatsApp Invoice | SELECT orders WHERE invoice_no | orders(invoice_no, items, total) |
| | Save as Deposit | INSERT advance_orders | advance_orders(all) |
| **Dashboard** | View Order | SELECT orders WHERE id | orders(all) |
| | Print Receipt | SELECT orders, order_items | orders(all), order_items |
| | Download Invoice | SELECT orders, generate PDF | orders(all) |
| | Share WhatsApp | SELECT orders + build msg | orders(invoice_no, total, items) |
| | Mark as Paid | UPDATE orders SET credit_paid_at | orders(credit_status, credit_paid_at) |
| | Change Due Date | UPDATE orders SET credit_due_date | orders(credit_due_date) |
| **Advance Orders** | Create | INSERT advance_orders | advance_orders(all) |
| | Receive Payment | INSERT advance_order_payments | advance_order_payments(all) |
| | WhatsApp Receipt | SELECT advance_orders | advance_orders(deposit_id, product_name) |
| | WhatsApp Invoice | SELECT advance_orders | advance_orders(invoice_number) |
| | Mark Completed | UPDATE advance_orders | advance_orders(status, invoice_number) |
| **Inventory** | Add Stock | INSERT inventory_movements | inventory_movements(variant_id, product_id) |
| | Remove Stock | INSERT inventory_movements | inventory_movements(variant_id, product_id) |
| | Reconcile | INSERT inventory_movements | inventory_movements(variant_id, product_id) |
| **Customers** | Birthday/Anniversary | UPDATE customers | customers(birthday_wish_sent_on) |

---

## ✅ CRITICAL FIELD VALIDATIONS

### UUID Fields (Type: UUID)
```sql
✅ orders.id - Primary key
✅ advance_orders.id - Primary key
✅ product_variants.id - Must validate in RPC calls
✅ advance_orders.completed_order_id - FK to orders
✅ customers.id - Primary key
```

**Validation Rule:** Must match UUID regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`

---

### Text Fields (Type: TEXT)
```sql
✅ orders.invoice_no - UNIQUE, INDEXED
✅ advance_orders.invoice_number - UNIQUE, INDEXED
✅ advance_orders.deposit_id - UNIQUE
✅ barcode_registry.barcode_value - UNIQUE
```

**Validation:** All unique fields have indexes for fast lookup

---

### Numeric Fields (Type: NUMERIC)
```sql
✅ orders.total, subtotal (NUMERIC(12,2))
✅ orders.discount_amount (NUMERIC(12,2))
✅ advance_orders.total_amount (NUMERIC(12,2))
✅ advance_orders.deposit_amount (NUMERIC(12,2))
✅ advance_orders.remaining_balance (NUMERIC GENERATED)
✅ product_variants.stock (NUMERIC(12,3)) - NOT INTEGER!
✅ inventory_movements.quantity_delta (NUMERIC)
```

---

### Date/DateTime Fields
```sql
✅ orders.credit_due_date (DATE)
✅ orders.credit_paid_at (TIMESTAMPTZ)
✅ orders.created_at (TIMESTAMPTZ)
✅ advance_orders.expected_delivery_date (DATE)
✅ customers.birthday (DATE)
✅ customers.anniversary (DATE)
```

---

## 🔒 CONSTRAINTS & CHECKS

```sql
-- Credit Status Constraint
✅ CONSTRAINT orders_credit_status_check 
   CHECK (credit_status IS NULL OR credit_status IN ('outstanding', 'paid'))

-- Advance Order Amount Constraint
✅ CONSTRAINT advance_deposit_less_than_total 
   CHECK (deposit_amount < total_amount)

-- Advance Order Status Constraint
✅ CHECK (status IN ('pending_deposit','ready_for_delivery','waiting_final_payment','completed','cancelled'))

-- Payment Method Constraint
✅ CHECK (payment_method IN ('cash','upi','card'))

-- Coupon Percentage Constraint
✅ CHECK (percentage > 0 AND percentage <= 100)
```

---

## 📊 FINAL VERIFICATION SUMMARY

### ✅ WhatsApp Invoice Functionality
- **Regular POS** → orders.invoice_no ✅
- **Credit Bills** → orders (credit_status) ✅
- **Advance Deposits** → advance_orders.deposit_id ✅
- **Advance Final** → advance_orders.invoice_number ✅

### ✅ All Buttons & Icons
- **Create/Update** → All INSERT/UPDATE operations have schema ✅
- **View/Read** → All SELECT operations have indexes ✅
- **Delete** → CASCADE foreign keys defined ✅
- **Print/Export** → All JSONB fields for data export ✅

### ✅ Data Integrity
- **Unique Constraints** → invoice_no, invoice_number, deposit_id ✅
- **Foreign Keys** → All relationships defined with CASCADE ✅
- **Check Constraints** → All enum-like fields validated ✅
- **Indexes** → All query paths optimized ✅

### ✅ Critical Features
- **Advance Order Complete** → Creates orders + updates advance_orders ✅
- **Credit Payment** → Updates credit_status + credit_paid_at ✅
- **Inventory Tracking** → inventory_movements with full audit trail ✅
- **Customer Events** → birthday/anniversary fields in customers ✅

---

## 🚀 STATUS: PRODUCTION READY

✅ **All features properly mapped to database schema**
✅ **All WhatsApp operations have required fields**
✅ **All buttons/icons have database support**
✅ **All constraints enforce data integrity**
✅ **All indexes optimize query performance**

---

**Last Verified:** 2026-09-27  
**Verified By:** Comprehensive schema audit  
**Confidence:** 100% ✅
