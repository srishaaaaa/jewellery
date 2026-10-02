-- Add credit-related columns to orders table if they don't exist
-- This migration adds support for credit sale tracking

-- Add is_credit column
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS is_credit BOOLEAN NOT NULL DEFAULT FALSE;

-- Add credit_status column
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS credit_status TEXT DEFAULT NULL
CHECK (credit_status IS NULL OR credit_status IN ('outstanding', 'paid'));

-- Add credit_paid_at timestamp column
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS credit_paid_at TIMESTAMPTZ DEFAULT NULL;

-- Create index for credit_status (outstanding orders)
CREATE INDEX IF NOT EXISTS idx_orders_credit_status
ON public.orders(credit_status)
WHERE credit_status = 'outstanding';

-- Create index for credit_due_date (for quick filtering)
CREATE INDEX IF NOT EXISTS idx_orders_credit_due_date
ON public.orders(credit_due_date)
WHERE credit_status = 'outstanding';

-- Verify columns were created
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'orders' AND column_name IN ('is_credit', 'credit_status', 'credit_paid_at');
