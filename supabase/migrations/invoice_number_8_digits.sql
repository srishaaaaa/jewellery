-- ============================================================================
-- Invoice numbers as INV + 8 digits (INV10000028) instead of INV + 16 digits.
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- * New bills: 'INV' || (10000000 + next sequence value). The sequence is not
--   reset, so numbering simply continues (bill #28 -> INV10000028). Numbers
--   already used by older bills are skipped.
-- * Existing bills keep their stored number (WhatsApp links already sent keep
--   working); the app shows INV0000000000000025 as INV10000025, and the public
--   invoice page accepts either form.
-- ============================================================================

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

GRANT EXECUTE ON FUNCTION public.get_public_invoice_by_number(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Result: the next number that will be used (peek only, does not consume it)
SELECT 'INV' || (10000000 + last_value + 1)::TEXT AS next_invoice_no_preview FROM public.invoice_no_seq;
