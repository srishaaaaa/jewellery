-- ============================================================================
-- 1. Fix "column variant_id is of type uuid but expression is of type text"
--    when adjusting stock (Restock / Customer Return / Loss / Reconciliation).
--    The variant id arrives as TEXT and was written into UUID columns without
--    a cast, so every adjustment failed. A size/variant change now also keeps
--    the parent product's total in step, the same way sales do.
-- 2. Credit bills saved without a credit_status (older bills) are marked
--    'outstanding', so they show in Outstanding Credits and can be marked paid.
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

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

GRANT EXECUTE ON FUNCTION public.adjust_inventory_stock(INTEGER, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated, anon, public;

UPDATE public.orders
SET credit_status = 'outstanding'
WHERE is_credit = TRUE AND credit_status IS NULL;

NOTIFY pgrst, 'reload schema';

-- Result: should return 0 (no credit bills left without a status)
SELECT COUNT(*) AS credit_bills_without_status FROM public.orders WHERE is_credit = TRUE AND credit_status IS NULL;
