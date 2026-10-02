-- DIAGNOSTIC: Check get_next_invoice_no function
SELECT 'Checking for duplicate functions...' as step;

SELECT 
  pg_get_functiondef(oid) as function_definition,
  proname,
  nargs,
  oid
FROM pg_proc 
WHERE proname = 'get_next_invoice_no';

-- Check sequences
SELECT 'Checking sequences...' as step;
SELECT * FROM information_schema.sequences 
WHERE sequence_name LIKE '%invoice%' OR sequence_name LIKE '%number%';

-- Test the function
SELECT 'Testing function call...' as step;
SELECT public.get_next_invoice_no() as next_invoice;

-- Check if there are multiple schemas with the function
SELECT 'Checking all schemas...' as step;
SELECT n.nspname as schema_name, p.proname, p.oid
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'get_next_invoice_no'
ORDER BY n.nspname, p.proname;
