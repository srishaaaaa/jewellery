# Mahalashmi Stores - Deployment Guide

## Overview

This guide covers deploying the Mahalashmi Stores POS billing system to a fresh Supabase instance.

## Single Production File

**Use:** `/supabase/mahalashmi_production.sql`

This is the ONLY file you need for deployment. It contains:
- ✓ All 23 database tables with proper relationships
- ✓ All 10 functions (invoice generation, barcode creation, order processing, etc.)
- ✓ All row-level security (RLS) policies
- ✓ All 60+ indexes for performance
- ✓ All sequences for auto-incrementing IDs
- ✓ All seed data (categories, products, unit types, store settings)
- ✓ All storage bucket configuration (invoices, branding)
- ✓ All migrations (0001-0041) integrated

**File Size:** 1,022 lines (deduplicated, optimized)

## Deployment Steps

### 1. Create Fresh Supabase Project

```bash
# Create new Supabase project at https://supabase.com
# Copy the connection string and database password
```

### 2. Execute Production SQL

**Option A: Supabase Dashboard (Recommended)**
1. Go to **SQL Editor** in Supabase dashboard
2. Click **New query**
3. Copy entire contents of `/supabase/mahalashmi_production.sql`
4. Paste into editor
5. Click **Run**
6. Wait for completion (watch for green checkmarks)

**Option B: Command Line**
```bash
# Install psql if not already installed
# Set environment variables
export PGPASSWORD="your_database_password"

# Execute the SQL file
psql -h your_supabase_host.supabase.co \
     -U postgres \
     -d postgres \
     -f supabase/mahalashmi_production.sql
```

### 3. Verify Database Setup

After execution completes, verify in Supabase dashboard:

**Tables Tab:**
- [ ] 23 tables present (unit_types, profiles, categories, products, orders, etc.)
- [ ] No errors or warnings

**Policies Tab:**
- [ ] 100+ RLS policies configured
- [ ] All policies show green checkmarks

**Functions Tab:**
- [ ] 10 functions present (get_next_invoice_no, complete_pos_sale_with_inventory, etc.)
- [ ] All functions show as "public"

**Storage Tab:**
- [ ] Two buckets present: "invoices" and "branding"
- [ ] Both show as "Public"

### 4. Update Frontend Configuration

Edit `src/lib/supabaseClient.ts` with your new Supabase credentials:

```typescript
const SUPABASE_URL = 'your_new_project_url'
const SUPABASE_ANON_KEY = 'your_anon_key'
```

### 5. Create Admin User

1. Go to Supabase **Authentication** tab
2. Click **Create new user** (or invite via email)
3. Use credentials: 
   - Email: `admin@mahalashmi.local`
   - Password: (your choice - change on first login)
4. After user is created, set their role to `admin` in the `profiles` table

**SQL Command (Alternative):**
```sql
-- After creating user via Auth dashboard, set role in database
UPDATE public.profiles 
SET role = 'admin'
WHERE email = 'your_admin_email@example.com';
```

### 6. Start Application

```bash
# Install dependencies (if not already done)
npm install

# Start development server
npm start

# Application runs on http://localhost:3000
```

### 7. First Login

1. Navigate to http://localhost:3000
2. Click **Login**
3. Enter admin credentials created in step 5
4. You're in! Dashboard loads with all data

## Post-Deployment Configuration

### Store Details

Update store information in **Settings → Store Settings → Shop Profile**:

- [x] Store name: "New Mahalashmi Stores"
- [x] Owner name: "M. Senthamil"
- [x] Phone: +91 98659 75714
- [x] Email: senthamil75714@gmail.com
- [x] Address: 5/85, Teacher's Colony, Masinaickanpatty, Ayyothiyapattanam, Salem - 636103
- [x] Instagram: @mahalashmi_stores
- [x] Accent color: #2E7D32 (Green)

### Add Products

1. Go to **Dashboard → Inventory → Add Product**
2. Add products with:
   - Name and Tamil name
   - Category
   - Multiple unit options (g, kg, ml, L, pcs, box, etc.)
   - Different prices per unit
   - Stock levels
   - Expiry dates (optional)

### Add Customers (Optional)

1. Go to **Dashboard → Customers**
2. Or customers are auto-created at POS checkout when phone number entered

## Database Schema Overview

### Core Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User accounts (admin/customer) |
| `categories` | Product categories |
| `products` | Base product information |
| `product_variants` | Different pack sizes/prices per product |
| `orders` | Billing transactions (cash, card, credit) |
| `customers` | Customer phone, name, birthday, anniversary |
| `advance_orders` | Deposits and pre-orders |
| `barcode_registry` | Barcode → product mapping |
| `expenses` | Business expense tracking |
| `store_settings` | Shop configuration and branding |

### Key Features in Database

- **Multi-unit pricing:** Same product in gm, kg, pcs with different prices
- **Credit sales:** Outstanding credits tracking with due dates
- **Expiry management:** FEFO (First Expiry First Out) support
- **Barcode scanning:** High-performance barcode lookup
- **Inventory tracking:** Movement history and damage stock
- **Price history:** Audit trail of price changes
- **RLS policies:** Data access controlled by user roles

## Troubleshooting

### "Function does not exist" errors

**Issue:** get_next_invoice_no or other functions not found

**Solution:**
1. Check that SQL file executed completely (no errors in logs)
2. Verify functions exist in Supabase **Functions** tab
3. Try refreshing the page in Supabase dashboard
4. If still failing, re-run the production SQL file

### "Duplicate key value" errors

**Issue:** When adding products or creating orders

**Solution:**
1. Check that sequences created correctly:
   ```sql
   SELECT * FROM information_schema.sequences;
   ```
2. If missing, re-run production SQL file
3. Never manually reset sequence values without understanding impact

### RLS policy errors on queries

**Issue:** "rows affected" is 0 despite correct data

**Solution:**
1. Verify user role is set to `admin` in `profiles` table
2. Check RLS policies are enabled (should be green in Supabase)
3. Temporarily disable policies for debugging:
   ```sql
   ALTER TABLE table_name DISABLE ROW LEVEL SECURITY;
   ```

## Disaster Recovery

### Backup Database

```bash
# Dump current database (via Supabase CLI or psql)
pg_dump database_url > backup_$(date +%Y%m%d).sql
```

### Restore from Backup

1. Create fresh Supabase project
2. Execute backup SQL file
3. Or restore from Supabase built-in backup feature

## Performance Notes

- Indexes created on high-query tables (products, orders, barcode_registry)
- RLS policies use indexed columns for fast filtering
- Storage buckets configured with appropriate file size limits
- Sequence values start at safe ranges (10M+) to avoid collisions

## File Cleanup

This deployment uses a single SQL file. Previous files can be deleted:

```bash
# These are no longer needed (merged into production file)
rm -f supabase/mahalashmi_final_consolidated.sql
rm -f supabase/mahalashmi_fresh_deployment.sql
rm -f supabase/full_schema_combined.sql
rm -rf supabase/migrations/  # Optional - kept for historical reference
```

## Next Steps

1. ✓ Execute `mahalashmi_production.sql` on fresh Supabase project
2. ✓ Create admin user
3. ✓ Start React application
4. ✓ Test POS billing flow on all devices
5. ✓ Verify calendar picker (DD/MM/YYYY) on mobile
6. ✓ Test multi-unit product pricing
7. ✓ Verify credit sales invoice generation
8. ✓ Check WhatsApp integration
9. ✓ Test barcode scanning
10. ✓ Run complete testing checklist (see TESTING_CHECKLIST.md)

## Support

For issues or questions:
1. Check TESTING_CHECKLIST.md for comprehensive test scenarios
2. Review Supabase documentation at https://supabase.com/docs
3. Check React component files in `src/` for implementation details
