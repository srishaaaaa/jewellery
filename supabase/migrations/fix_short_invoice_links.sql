-- Makes shortened invoice links (e.g. /invoice/INV00000013) open the full
-- sequential invoice (INV0000000000000013). Run in the Supabase SQL Editor.
-- Already included in fix_invoice_links_and_advance_orders.sql for fresh setups.

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

-- Result: should return the invoice for bill 13
SELECT invoice_no, customer_name, total FROM public.get_public_invoice_by_number('INV00000013');
