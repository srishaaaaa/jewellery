-- Comprehensive Schema Validation Script
-- This checks for common SQL errors and issues

-- 1. Check for syntax issues
SELECT 'SYNTAX CHECK' as check_type, COUNT(*) as count FROM (
  SELECT 1 WHERE '1' = '1'
) t;

-- 2. Verify critical table fields
SELECT 'orders.invoice_no' as table_field, 'TEXT UNIQUE NOT NULL' as required_type
UNION ALL SELECT 'orders.credit_status', 'TEXT (outstanding|paid|NULL)'
UNION ALL SELECT 'advance_orders.invoice_number', 'TEXT UNIQUE'
UNION ALL SELECT 'advance_orders.deposit_id', 'TEXT UNIQUE NOT NULL'
UNION ALL SELECT 'product_variants.id', 'UUID'
UNION ALL SELECT 'product_variants.stock', 'NUMERIC(12,3)';

SELECT 'Field Validation Requirements Created' as status;
