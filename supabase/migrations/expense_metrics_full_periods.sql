-- ============================================================================
-- Expense Tracker cards use whole periods, like every date filter in the app:
--   This Week  = Monday to Sunday
--   This Month = 1st to the last day of the month
--   This Year  = 1 January to 31 December
-- (Before, each card stopped at today, so expenses dated later in the period
-- were left out.) The app passes today's local (IST) date as p_current_date.
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

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
  v_week_start DATE := date_trunc('week', p_current_date)::DATE;          -- Monday
  v_week_end DATE := (date_trunc('week', p_current_date) + INTERVAL '6 days')::DATE;  -- Sunday
  v_month_start DATE := date_trunc('month', p_current_date)::DATE;
  v_month_end DATE := (date_trunc('month', p_current_date) + INTERVAL '1 month - 1 day')::DATE;
  v_year_start DATE := date_trunc('year', p_current_date)::DATE;
  v_year_end DATE := (date_trunc('year', p_current_date) + INTERVAL '1 year - 1 day')::DATE;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN expense_date = p_current_date THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN expense_date BETWEEN v_week_start AND v_week_end THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN expense_date BETWEEN v_month_start AND v_month_end THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN expense_date BETWEEN v_year_start AND v_year_end THEN amount ELSE 0 END), 0),
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

NOTIFY pgrst, 'reload schema';

-- Result: this week's Monday..Sunday, this month and this year as used by the cards
SELECT date_trunc('week', CURRENT_DATE)::DATE AS week_monday,
       (date_trunc('week', CURRENT_DATE) + INTERVAL '6 days')::DATE AS week_sunday,
       (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE AS month_last_day;
