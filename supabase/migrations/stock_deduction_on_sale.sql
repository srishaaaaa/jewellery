-- ============================================================================
-- Take stock off when a bill is completed, put it back if the bill is removed.
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- A trigger on public.orders covers every way a bill is completed: POS sales,
-- advance orders completed by final payment, and online orders marked
-- completed in the dashboard.
--   * Bill becomes completed/paid  -> each catalogue item's quantity is taken
--     off its product (or off its variant and the parent product's total) and
--     logged as a SALE movement.
--   * Completed bill deleted, or moved back to pending/cancelled -> exactly
--     what that bill took off is put back, logged as VOID.
-- Manual / Unregistered items are never stock-tracked. Sales are never
-- blocked: stock can go below zero until the next restock or adjustment.
-- Bills completed before this was installed took nothing off, so deleting
-- them does not add stock.
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

-- Result: should list the trigger
SELECT tgname AS trigger_installed FROM pg_trigger WHERE tgname = 'orders_stock_trigger';
