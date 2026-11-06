-- ============================================================================
-- Customer portal: OTP sessions, customer data, notifications, UPI payment
-- links / claims with admin verification, scheme reminders.
--
-- Safe to run more than once and safe to run before the security lock-down:
-- it only adds tables, columns and functions. Run AFTER jewellery_pos.sql.
--
-- Customers never get a Supabase login: after the OTP is checked they get a
-- random session token, and every customer function takes that token and only
-- ever returns that customer's own records (bills are matched by phone number).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Settings: shop UPI, QR rotation, reminder schedule, OTP / link lifetimes
-- ---------------------------------------------------------------------------
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS upi_id TEXT NOT NULL DEFAULT '';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS upi_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS upi_rotate_minutes INTEGER NOT NULL DEFAULT 5;
-- Days before the due date to remind (0 = on the day, -1 = once when overdue)
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS reminder_days INTEGER[] NOT NULL DEFAULT '{7,3,1,0,-1}';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS otp_minutes INTEGER NOT NULL DEFAULT 5;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS payment_link_hours INTEGER NOT NULL DEFAULT 6;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_settings_upi_rotate_check') THEN
    ALTER TABLE public.store_settings ADD CONSTRAINT store_settings_upi_rotate_check CHECK (upi_rotate_minutes BETWEEN 1 AND 60);
  END IF;
END $$;

-- Last 10 digits: bills, schemes and customers store phones in different formats.
CREATE OR REPLACE FUNCTION public.phone_key(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT RIGHT(regexp_replace(COALESCE(p, ''), '\D', '', 'g'), 10) $$;

-- ---------------------------------------------------------------------------
-- Part payments of credit bills (UPI claims confirmed by the shop, or recorded at the counter)
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS credit_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.order_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'upi',
  utr TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  claim_id UUID,
  verified_by TEXT NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS order_payments_order_idx ON public.order_payments(order_id, created_at DESC);
-- The same UPI transaction (UTR) can be credited only once.
CREATE UNIQUE INDEX IF NOT EXISTS order_payments_utr_idx ON public.order_payments(UPPER(BTRIM(utr))) WHERE BTRIM(utr) <> '';

-- ---------------------------------------------------------------------------
-- OTP codes and customer sessions (never readable by the app)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_key TEXT NOT NULL,
  salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_otps_phone_idx ON public.customer_otps(phone_key, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);

-- Numbers that tried to log in but are not customers yet (the shop registers them).
CREATE TABLE IF NOT EXISTS public.customer_registration_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customer_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_otps FROM anon, authenticated;
REVOKE ALL ON public.customer_sessions FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Customer notifications (in-app; deduped per event / reminder stage)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT UNIQUE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_notifications_customer_idx ON public.customer_notifications(customer_id, created_at DESC);

-- Delivery attempts on other channels (SMS / WhatsApp), only written by a configured provider.
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES public.customer_notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
  provider_ref TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.notify_customer(p_customer_id UUID, p_kind TEXT, p_title TEXT, p_body TEXT, p_ref_type TEXT, p_ref_id TEXT, p_dedupe TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_customer_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.customer_notifications (customer_id, kind, title, body, ref_type, ref_id, dedupe_key)
  VALUES (p_customer_id, p_kind, p_title, COALESCE(p_body, ''), COALESCE(p_ref_type, ''), COALESCE(p_ref_id, ''), p_dedupe)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_id_for_phone(p_phone TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.customers WHERE public.phone_key(phone) = public.phone_key(p_phone) AND public.phone_key(p_phone) <> ''
  ORDER BY created_at LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- UPI payment links and payment claims
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.upi_payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_by TEXT NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS upi_payment_links_order_idx ON public.upi_payment_links(order_id);

CREATE TABLE IF NOT EXISTS public.upi_payment_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  link_id UUID REFERENCES public.upi_payment_links(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  utr TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ,
  screenshot_path TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  review_reason TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  payment_id UUID REFERENCES public.order_payments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS upi_payment_claims_status_idx ON public.upi_payment_claims(status, created_at DESC);
-- One open claim per transaction reference per bill.
CREATE UNIQUE INDEX IF NOT EXISTS upi_payment_claims_open_utr_idx ON public.upi_payment_claims(order_id, UPPER(BTRIM(utr)))
  WHERE status = 'pending' AND BTRIM(utr) <> '';

-- Amount still owed on a bill: only credit bills have a balance.
CREATE OR REPLACE FUNCTION public.order_outstanding(o public.orders)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN o.credit_status = 'outstanding' AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
              THEN GREATEST(ROUND(COALESCE(o.total, 0) - COALESCE(o.credit_paid_amount, 0), 2), 0) ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.new_portal_token()
RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');
$$;

-- ---------------------------------------------------------------------------
-- OTP: create (only the server-side OTP function may call this) and verify
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_create_otp(p_phone TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key TEXT := public.phone_key(p_phone);
  v_customer UUID;
  v_last TIMESTAMPTZ;
  v_recent INTEGER;
  v_code TEXT;
  v_salt TEXT := public.new_portal_token();
  v_minutes INTEGER;
BEGIN
  IF LENGTH(v_key) <> 10 THEN RAISE EXCEPTION 'Enter a valid 10-digit mobile number.'; END IF;
  v_customer := public.customer_id_for_phone(v_key);
  IF v_customer IS NULL THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;
  SELECT MAX(created_at), COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') INTO v_last, v_recent
  FROM public.customer_otps WHERE phone_key = v_key;
  IF v_last IS NOT NULL AND v_last > NOW() - INTERVAL '60 seconds' THEN
    RAISE EXCEPTION 'Please wait % seconds before asking for a new OTP.', CEIL(EXTRACT(EPOCH FROM (v_last + INTERVAL '60 seconds' - NOW())));
  END IF;
  IF v_recent >= 5 THEN RAISE EXCEPTION 'Too many OTP requests. Try again in an hour.'; END IF;
  SELECT COALESCE(otp_minutes, 5) INTO v_minutes FROM public.store_settings WHERE id = 1;
  v_code := LPAD((FLOOR(random() * 1000000))::INT::TEXT, 6, '0');
  UPDATE public.customer_otps SET used = TRUE WHERE phone_key = v_key AND NOT used;
  INSERT INTO public.customer_otps (phone_key, salt, code_hash, expires_at)
  VALUES (v_key, v_salt, encode(sha256(convert_to(v_salt || ':' || v_code, 'UTF8')), 'hex'), NOW() + make_interval(mins => COALESCE(v_minutes, 5)));
  RETURN jsonb_build_object('code', v_code, 'expires_in_seconds', COALESCE(v_minutes, 5) * 60, 'resend_in_seconds', 60);
END;
$$;

-- Removes an OTP that could not be sent (so the cooldown does not block a retry).
CREATE OR REPLACE FUNCTION public.customer_discard_otp(p_phone TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.customer_otps WHERE phone_key = public.phone_key(p_phone) AND NOT used AND created_at > NOW() - INTERVAL '2 minutes';
$$;

CREATE OR REPLACE FUNCTION public.customer_verify_otp(p_phone TEXT, p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key TEXT := public.phone_key(p_phone);
  o public.customer_otps;
  c public.customers;
  v_token TEXT;
BEGIN
  SELECT * INTO o FROM public.customer_otps WHERE phone_key = v_key AND NOT used ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ask for a new OTP.'; END IF;
  IF o.expires_at < NOW() THEN UPDATE public.customer_otps SET used = TRUE WHERE id = o.id; RAISE EXCEPTION 'The OTP has expired. Ask for a new one.'; END IF;
  IF o.attempts >= 5 THEN UPDATE public.customer_otps SET used = TRUE WHERE id = o.id; RAISE EXCEPTION 'Too many wrong attempts. Ask for a new OTP.'; END IF;
  IF encode(sha256(convert_to(o.salt || ':' || BTRIM(COALESCE(p_code, '')), 'UTF8')), 'hex') <> o.code_hash THEN
    UPDATE public.customer_otps SET attempts = attempts + 1 WHERE id = o.id;
    RAISE EXCEPTION 'Wrong OTP. % attempt(s) left.', GREATEST(0, 4 - o.attempts);
  END IF;
  UPDATE public.customer_otps SET used = TRUE WHERE id = o.id;
  SELECT * INTO c FROM public.customers WHERE id = public.customer_id_for_phone(v_key);
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;
  v_token := public.new_portal_token();
  INSERT INTO public.customer_sessions (customer_id, token_hash, expires_at)
  VALUES (c.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), NOW() + INTERVAL '30 days');
  RETURN jsonb_build_object('token', v_token, 'customer', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone));
END;
$$;

-- Session token -> customer id (raises when missing, expired or logged out).
CREATE OR REPLACE FUNCTION public.portal_customer(p_token TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.customer_sessions;
BEGIN
  SELECT * INTO s FROM public.customer_sessions WHERE token_hash = encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex');
  IF NOT FOUND OR s.revoked OR s.expires_at < NOW() THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
  UPDATE public.customer_sessions SET last_seen_at = NOW() WHERE id = s.id AND last_seen_at < NOW() - INTERVAL '5 minutes';
  RETURN s.customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_logout(p_token TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.customer_sessions SET revoked = TRUE WHERE token_hash = encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.request_customer_registration(p_phone TEXT, p_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF LENGTH(public.phone_key(p_phone)) <> 10 THEN RAISE EXCEPTION 'Enter a valid 10-digit mobile number.'; END IF;
  IF EXISTS (SELECT 1 FROM public.customer_registration_requests WHERE public.phone_key(phone) = public.phone_key(p_phone) AND status = 'open') THEN RETURN; END IF;
  INSERT INTO public.customer_registration_requests (phone, name) VALUES (public.phone_key(p_phone), LEFT(BTRIM(COALESCE(p_name, '')), 80));
END;
$$;

-- ---------------------------------------------------------------------------
-- Customer data (only the logged-in customer's own records)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_bill_json(o public.orders)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', o.id, 'invoice_no', o.invoice_no, 'created_at', o.created_at, 'total', o.total, 'status', o.status,
    'payment_mode', COALESCE(o.payment_mode, o.payment_method), 'total_gst', o.total_gst,
    'advance_amount_used', COALESCE(o.advance_amount_used, 0), 'exchange_amount', COALESCE(o.exchange_amount, 0),
    'scheme_amount_used', COALESCE(o.scheme_amount_used, 0), 'credit_status', o.credit_status,
    'balance', public.order_outstanding(o),
    'paid', CASE WHEN o.credit_status = 'outstanding' THEN COALESCE(o.credit_paid_amount, 0) ELSE COALESCE(o.total, 0) END,
    'pay_status', CASE
      WHEN LOWER(COALESCE(o.status, '')) = 'cancelled' THEN 'cancelled'
      WHEN EXISTS (SELECT 1 FROM public.sales_returns r WHERE r.order_id = o.id AND r.status = 'approved' AND r.return_type = 'refund') THEN 'refunded'
      WHEN o.credit_status = 'outstanding' AND EXISTS (SELECT 1 FROM public.upi_payment_claims k WHERE k.order_id = o.id AND k.status = 'pending') THEN 'awaiting_verification'
      WHEN o.credit_status = 'outstanding' AND COALESCE(o.credit_paid_amount, 0) > 0 THEN 'partially_paid'
      WHEN o.credit_status = 'outstanding' THEN 'pending'
      ELSE 'paid' END,
    'items', o.items);
$$;

CREATE OR REPLACE FUNCTION public.customer_portal_data(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cid UUID := public.portal_customer(p_token);
  c public.customers;
  v_key TEXT;
  v_bills JSONB;
  v_schemes JSONB;
  v_payments JSONB;
  v_unread INTEGER;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = v_cid;
  v_key := public.phone_key(c.phone);
  SELECT COALESCE(jsonb_agg(public.portal_bill_json(o) ORDER BY o.created_at DESC), '[]'::JSONB) INTO v_bills
  FROM public.orders o WHERE public.phone_key(o.phone) = v_key AND v_key <> '' AND COALESCE(o.order_type, '') <> 'online_request';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'scheme_number', s.scheme_number, 'scheme_name', s.scheme_name, 'frequency', s.frequency,
      'monthly_amount', s.monthly_amount, 'total_installments', s.total_installments, 'installments_paid', s.installments_paid,
      'total_paid', s.total_paid, 'amount_redeemed', s.amount_redeemed, 'start_date', s.start_date, 'maturity_date', s.maturity_date,
      'next_due_date', s.next_due_date, 'status', s.status, 'total_grams', s.total_grams, 'gold_purity', s.gold_purity,
      'benefit_type', s.benefit_type, 'making_benefit_value', s.making_benefit_value, 'making_benefit_unit', s.making_benefit_unit,
      'wastage_benefit_value', s.wastage_benefit_value, 'wastage_benefit_unit', s.wastage_benefit_unit,
      'benefit_used', s.benefit_used, 'benefit_forfeited', s.benefit_forfeited, 'duration_months', s.duration_months
    ) ORDER BY s.created_at DESC), '[]'::JSONB) INTO v_schemes
  FROM public.jewellery_schemes s WHERE s.customer_id = v_cid OR (public.phone_key(s.phone) = v_key AND v_key <> '');
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'date' DESC), '[]'::JSONB) INTO v_payments FROM (
    SELECT jsonb_build_object('kind', 'bill', 'date', p.created_at, 'invoice_no', o.invoice_no, 'amount', p.amount, 'method', p.payment_method,
                              'reference', NULLIF(p.utr, ''), 'status', 'verified', 'verified_at', p.created_at) AS x
    FROM public.order_payments p JOIN public.orders o ON o.id = p.order_id WHERE public.phone_key(o.phone) = v_key AND v_key <> ''
    UNION ALL
    SELECT jsonb_build_object('kind', 'claim', 'date', k.created_at, 'invoice_no', o.invoice_no, 'amount', k.amount, 'method', 'upi',
                              'reference', NULLIF(k.utr, ''), 'status', CASE k.status WHEN 'pending' THEN 'awaiting_verification' ELSE k.status END,
                              'verified_at', k.reviewed_at, 'reason', NULLIF(k.review_reason, ''))
    FROM public.upi_payment_claims k JOIN public.orders o ON o.id = k.order_id
    WHERE public.phone_key(o.phone) = v_key AND v_key <> '' AND k.status <> 'verified'
    UNION ALL
    SELECT jsonb_build_object('kind', 'scheme', 'date', i.payment_date, 'invoice_no', s.scheme_number, 'amount', i.amount_paid, 'method', i.payment_method,
                              'reference', i.receipt_number, 'status', 'verified', 'verified_at', i.payment_date, 'scheme_id', s.id, 'installment_id', i.id)
    FROM public.scheme_installments i JOIN public.jewellery_schemes s ON s.id = i.scheme_id
    WHERE i.status = 'paid' AND (s.customer_id = v_cid OR (public.phone_key(s.phone) = v_key AND v_key <> ''))
  ) q;
  SELECT COUNT(*) INTO v_unread FROM public.customer_notifications WHERE customer_id = v_cid AND read_at IS NULL;
  RETURN jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'code', LEFT(c.id::TEXT, 8), 'name', c.name, 'phone', c.phone, 'email', c.email, 'address', c.address, 'created_at', c.created_at),
    'bills', v_bills, 'schemes', v_schemes, 'payments', v_payments, 'unread', v_unread);
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_scheme_detail(p_token TEXT, p_scheme_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cid UUID := public.portal_customer(p_token);
  s public.jewellery_schemes;
  v_key TEXT;
BEGIN
  SELECT public.phone_key(phone) INTO v_key FROM public.customers WHERE id = v_cid;
  SELECT * INTO s FROM public.jewellery_schemes WHERE id = p_scheme_id;
  IF NOT FOUND OR NOT (s.customer_id = v_cid OR public.phone_key(s.phone) = v_key) THEN RAISE EXCEPTION 'Scheme not found.'; END IF;
  RETURN jsonb_build_object(
    'scheme', to_jsonb(s) - 'transfer_history' - 'status_history' - 'created_by',
    'installments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'installment_number', i.installment_number, 'due_date', i.due_date,
        'amount_due', i.amount_due, 'amount_paid', i.amount_paid, 'payment_date', i.payment_date, 'payment_method', i.payment_method,
        'receipt_number', i.receipt_number, 'status', i.status, 'gold_rate', i.gold_rate, 'gold_grams', i.gold_grams, 'gold_purity', i.gold_purity)
      ORDER BY i.installment_number) FROM public.scheme_installments i WHERE i.scheme_id = s.id), '[]'::JSONB),
    'redemptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('invoice_no', r.invoice_no, 'amount_used', r.amount_used, 'benefit_applied', r.benefit_applied,
        'redeemed_at', r.redeemed_at, 'mode', r.mode, 'grams_used', r.grams_used) ORDER BY r.redeemed_at)
      FROM public.scheme_redemptions r WHERE r.scheme_id = s.id AND r.status = 'applied'), '[]'::JSONB),
    'terms', (SELECT scheme_rules FROM public.store_settings WHERE id = 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_bill(p_token TEXT, p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cid UUID := public.portal_customer(p_token);
  o public.orders;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR public.phone_key(o.phone) <> (SELECT public.phone_key(phone) FROM public.customers WHERE id = v_cid) THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;
  RETURN jsonb_build_object('order', to_jsonb(o) - 'invoice_pdf_url', 'summary', public.portal_bill_json(o),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('amount', p.amount, 'method', p.payment_method, 'utr', p.utr, 'at', p.created_at) ORDER BY p.created_at)
                          FROM public.order_payments p WHERE p.order_id = o.id), '[]'::JSONB));
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_notifications_list(p_token TEXT)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'ref_type', n.ref_type,
           'ref_id', n.ref_id, 'read_at', n.read_at, 'created_at', n.created_at) ORDER BY n.created_at DESC), '[]'::JSONB)
  FROM (SELECT * FROM public.customer_notifications WHERE customer_id = public.portal_customer(p_token) ORDER BY created_at DESC LIMIT 200) n;
$$;

CREATE OR REPLACE FUNCTION public.customer_mark_read(p_token TEXT, p_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.customer_notifications SET read_at = NOW()
  WHERE customer_id = public.portal_customer(p_token) AND read_at IS NULL AND (p_id IS NULL OR id = p_id);
$$;

-- Customers may change only their email and address (the phone is their login).
CREATE OR REPLACE FUNCTION public.customer_update_profile(p_token TEXT, p_email TEXT, p_address TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid UUID := public.portal_customer(p_token);
BEGIN
  IF BTRIM(COALESCE(p_email, '')) <> '' AND BTRIM(p_email) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid email address.'; END IF;
  UPDATE public.customers SET email = LEFT(BTRIM(COALESCE(p_email, '')), 120), address = LEFT(BTRIM(COALESCE(p_address, '')), 300), updated_at = NOW() WHERE id = v_cid;
END;
$$;

-- ---------------------------------------------------------------------------
-- Payment links
-- ---------------------------------------------------------------------------
-- Shop: a link for the bill's current balance (valid payment_link_hours, default 6).
CREATE OR REPLACE FUNCTION public.create_payment_link(p_order_id UUID, p_by TEXT DEFAULT 'Admin')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders;
  v_due NUMERIC;
  v_hours INTEGER;
  l public.upi_payment_links;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found.'; END IF;
  v_due := public.order_outstanding(o);
  IF v_due <= 0 THEN RAISE EXCEPTION 'Bill % has no balance to pay.', o.invoice_no; END IF;
  IF COALESCE((SELECT upi_id FROM public.store_settings WHERE id = 1), '') = '' THEN RAISE EXCEPTION 'Set the shop UPI ID in Settings first.'; END IF;
  SELECT * INTO l FROM public.upi_payment_links WHERE order_id = p_order_id AND revoked_at IS NULL AND expires_at > NOW() + INTERVAL '30 minutes' AND amount = v_due
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT COALESCE(payment_link_hours, 6) INTO v_hours FROM public.store_settings WHERE id = 1;
    INSERT INTO public.upi_payment_links (token, order_id, amount, created_by, expires_at)
    VALUES (public.new_portal_token(), p_order_id, v_due, COALESCE(NULLIF(p_by, ''), 'Admin'), NOW() + make_interval(hours => COALESCE(v_hours, 6)))
    RETURNING * INTO l;
  END IF;
  RETURN jsonb_build_object('token', l.token, 'amount', l.amount, 'expires_at', l.expires_at, 'invoice_no', o.invoice_no);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_payment_link(p_link_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.upi_payment_links SET revoked_at = NOW() WHERE id = p_link_id AND revoked_at IS NULL;
$$;

-- Customer: "Pay Now" on one of their own bills.
CREATE OR REPLACE FUNCTION public.customer_payment_link(p_token TEXT, p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid UUID := public.portal_customer(p_token);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND public.phone_key(o.phone) = (SELECT public.phone_key(phone) FROM public.customers WHERE id = v_cid)) THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;
  RETURN public.create_payment_link(p_order_id, 'Customer portal');
END;
$$;

-- Public payment page: shop UPI details and the approved amount (never more than the bill still owes).
CREATE OR REPLACE FUNCTION public.get_payment_link(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.upi_payment_links;
  o public.orders;
  s public.store_settings;
  v_due NUMERIC;
  v_state TEXT;
BEGIN
  SELECT * INTO l FROM public.upi_payment_links WHERE token = BTRIM(COALESCE(p_token, ''));
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  SELECT * INTO o FROM public.orders WHERE id = l.order_id;
  SELECT * INTO s FROM public.store_settings WHERE id = 1;
  v_due := LEAST(l.amount, public.order_outstanding(o));
  v_state := CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked' WHEN l.expires_at < NOW() THEN 'expired'
                  WHEN v_due <= 0 THEN 'paid' WHEN COALESCE(s.upi_id, '') = '' THEN 'no_upi' ELSE 'open' END;
  RETURN jsonb_build_object(
    'state', v_state, 'invoice_no', o.invoice_no, 'amount', v_due, 'expires_at', l.expires_at,
    'customer_first_name', split_part(BTRIM(COALESCE(o.customer_name, '')), ' ', 1),
    'shop_name', s.name, 'upi_id', CASE WHEN v_state = 'open' THEN s.upi_id ELSE '' END,
    'upi_name', COALESCE(NULLIF(s.upi_name, ''), s.name), 'rotate_minutes', COALESCE(s.upi_rotate_minutes, 5),
    'logo_url', s.logo_url, 'link_id', l.id,
    'pending_claim', EXISTS (SELECT 1 FROM public.upi_payment_claims k WHERE k.order_id = o.id AND k.status = 'pending'));
END;
$$;

-- "I've Paid": records a claim for the shop to check. Nothing is marked paid here.
CREATE OR REPLACE FUNCTION public.submit_payment_claim(p_link_token TEXT, p_utr TEXT, p_amount NUMERIC, p_paid_at TIMESTAMPTZ, p_screenshot_path TEXT, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.upi_payment_links;
  o public.orders;
  v_due NUMERIC;
  v_amount NUMERIC;
  v_utr TEXT := UPPER(BTRIM(COALESCE(p_utr, '')));
  k public.upi_payment_claims;
BEGIN
  SELECT * INTO l FROM public.upi_payment_links WHERE token = BTRIM(COALESCE(p_link_token, '')) FOR UPDATE;
  IF NOT FOUND OR l.revoked_at IS NOT NULL OR l.expires_at < NOW() THEN RAISE EXCEPTION 'This payment link is no longer valid. Ask the shop for a new one.'; END IF;
  SELECT * INTO o FROM public.orders WHERE id = l.order_id;
  v_due := LEAST(l.amount, public.order_outstanding(o));
  IF v_due <= 0 THEN RAISE EXCEPTION 'This bill has no balance to pay.'; END IF;
  v_amount := ROUND(COALESCE(NULLIF(p_amount, 0), v_due), 2);
  IF v_amount <= 0 OR v_amount > v_due THEN RAISE EXCEPTION 'The amount must be between ₹1 and ₹% (the balance).', v_due; END IF;
  IF v_utr <> '' AND v_utr !~ '^[A-Z0-9]{6,35}$' THEN RAISE EXCEPTION 'Enter the UPI transaction ID / UTR as shown in your UPI app.'; END IF;
  IF v_utr <> '' AND EXISTS (SELECT 1 FROM public.order_payments WHERE UPPER(BTRIM(utr)) = v_utr) THEN
    RAISE EXCEPTION 'This transaction ID has already been recorded.';
  END IF;
  IF (SELECT COUNT(*) FROM public.upi_payment_claims WHERE order_id = o.id AND status = 'pending') >= 3 THEN
    RAISE EXCEPTION 'The shop is already checking your payment. Please wait for it to be confirmed.';
  END IF;
  INSERT INTO public.upi_payment_claims (order_id, link_id, customer_id, amount, utr, paid_at, screenshot_path, note)
  VALUES (o.id, l.id, public.customer_id_for_phone(o.phone), v_amount, v_utr, COALESCE(p_paid_at, NOW()),
          LEFT(COALESCE(p_screenshot_path, ''), 300), LEFT(BTRIM(COALESCE(p_note, '')), 300))
  RETURNING * INTO k;
  RETURN jsonb_build_object('claim_id', k.id, 'status', 'awaiting_verification');
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'You already sent this transaction ID. The shop is checking it.';
END;
$$;

-- Shop: confirmed in the UPI app / bank statement -> record the payment.
CREATE OR REPLACE FUNCTION public.verify_payment_claim(p_claim_id UUID, p_by TEXT DEFAULT 'Admin', p_utr TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k public.upi_payment_claims;
  o public.orders;
  v_due NUMERIC;
  v_utr TEXT;
  p public.order_payments;
  v_paid NUMERIC;
BEGIN
  SELECT * INTO k FROM public.upi_payment_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment claim not found.'; END IF;
  IF k.status <> 'pending' THEN RAISE EXCEPTION 'This claim is already %.', k.status; END IF;
  SELECT * INTO o FROM public.orders WHERE id = k.order_id FOR UPDATE;
  v_due := public.order_outstanding(o);
  IF k.amount > v_due THEN RAISE EXCEPTION 'The claim (₹%) is more than the balance still owed (₹%).', k.amount, v_due; END IF;
  v_utr := UPPER(BTRIM(COALESCE(NULLIF(p_utr, ''), k.utr)));
  IF v_utr <> '' AND EXISTS (SELECT 1 FROM public.order_payments WHERE UPPER(BTRIM(utr)) = v_utr) THEN
    RAISE EXCEPTION 'Transaction % has already been credited.', v_utr;
  END IF;
  INSERT INTO public.order_payments (order_id, amount, payment_method, utr, claim_id, verified_by)
  VALUES (o.id, k.amount, 'upi', v_utr, k.id, COALESCE(NULLIF(p_by, ''), 'Admin')) RETURNING * INTO p;
  v_paid := ROUND(COALESCE(o.credit_paid_amount, 0) + k.amount, 2);
  UPDATE public.orders SET credit_paid_amount = v_paid,
         credit_status = CASE WHEN v_paid >= COALESCE(total, 0) THEN 'paid' ELSE credit_status END,
         credit_paid_at = CASE WHEN v_paid >= COALESCE(total, 0) THEN NOW() ELSE credit_paid_at END,
         credit_paid_method = CASE WHEN v_paid >= COALESCE(total, 0) THEN 'upi' ELSE credit_paid_method END,
         updated_at = NOW()
  WHERE id = o.id;
  UPDATE public.upi_payment_claims SET status = 'verified', utr = v_utr, reviewed_by = COALESCE(NULLIF(p_by, ''), 'Admin'), reviewed_at = NOW(), payment_id = p.id
  WHERE id = k.id;
  INSERT INTO public.audit_logs (action, entity_type, entity_id, new_value, user_name)
  VALUES ('upi_payment_verified', 'order', o.invoice_no, jsonb_build_object('amount', k.amount, 'utr', v_utr, 'claim', k.id), COALESCE(NULLIF(p_by, ''), 'Admin'));
  PERFORM public.notify_customer(public.customer_id_for_phone(o.phone), 'payment_verified', 'Payment received',
    'Your UPI payment of ₹' || k.amount || ' for bill ' || o.invoice_no || ' has been confirmed. Thank you!', 'bill', o.id::TEXT, 'claim_ok:' || k.id);
  RETURN jsonb_build_object('payment_id', p.id, 'balance', GREATEST(COALESCE(o.total, 0) - v_paid, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_payment_claim(p_claim_id UUID, p_reason TEXT, p_by TEXT DEFAULT 'Admin')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k public.upi_payment_claims;
  o public.orders;
BEGIN
  IF BTRIM(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'Enter why the payment was not found.'; END IF;
  SELECT * INTO k FROM public.upi_payment_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR k.status <> 'pending' THEN RAISE EXCEPTION 'Only a claim awaiting verification can be rejected.'; END IF;
  SELECT * INTO o FROM public.orders WHERE id = k.order_id;
  UPDATE public.upi_payment_claims SET status = 'rejected', review_reason = BTRIM(p_reason), reviewed_by = COALESCE(NULLIF(p_by, ''), 'Admin'), reviewed_at = NOW()
  WHERE id = k.id;
  INSERT INTO public.audit_logs (action, entity_type, entity_id, new_value, user_name, note)
  VALUES ('upi_payment_rejected', 'order', o.invoice_no, jsonb_build_object('amount', k.amount, 'utr', k.utr, 'claim', k.id), COALESCE(NULLIF(p_by, ''), 'Admin'), BTRIM(p_reason));
  PERFORM public.notify_customer(public.customer_id_for_phone(o.phone), 'payment_rejected', 'Payment could not be verified',
    'Your UPI payment of ₹' || k.amount || ' for bill ' || o.invoice_no || ' could not be found: ' || BTRIM(p_reason) || '. Please contact the shop.', 'bill', o.id::TEXT, 'claim_no:' || k.id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Automatic customer notifications
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_notify_customer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid UUID;
BEGIN
  IF COALESCE(NEW.order_type, '') = 'online_request' THEN RETURN NEW; END IF;
  v_cid := public.customer_id_for_phone(NEW.phone);
  IF v_cid IS NULL THEN RETURN NEW; END IF;
  IF LOWER(COALESCE(NEW.status, '')) = 'completed' AND (TG_OP = 'INSERT' OR LOWER(COALESCE(OLD.status, '')) <> 'completed') THEN
    PERFORM public.notify_customer(v_cid, 'bill', 'New bill ' || COALESCE(NEW.invoice_no, ''),
      'Your bill of ₹' || COALESCE(NEW.total, 0) || ' is ready to view' || CASE WHEN NEW.credit_status = 'outstanding' THEN ' (balance to pay)' ELSE '' END || '.',
      'bill', NEW.id::TEXT, 'bill:' || NEW.id);
  ELSIF LOWER(COALESCE(NEW.status, '')) = 'cancelled' AND TG_OP = 'UPDATE' AND LOWER(COALESCE(OLD.status, '')) <> 'cancelled' THEN
    PERFORM public.notify_customer(v_cid, 'bill', 'Bill ' || COALESCE(NEW.invoice_no, '') || ' cancelled', COALESCE(NEW.cancel_reason, ''), 'bill', NEW.id::TEXT, 'bill_cancel:' || NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS orders_notify_customer ON public.orders;
CREATE TRIGGER orders_notify_customer AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_notify_customer();

CREATE OR REPLACE FUNCTION public.scheme_payment_notify_customer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.jewellery_schemes;
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    SELECT * INTO s FROM public.jewellery_schemes WHERE id = NEW.scheme_id;
    PERFORM public.notify_customer(COALESCE(s.customer_id, public.customer_id_for_phone(s.phone)), 'scheme_paid', 'Installment received',
      'Installment ' || NEW.installment_number || ' of ₹' || NEW.amount_paid || ' for ' || s.scheme_name || ' (' || s.scheme_number || ') is received. Receipt ' || COALESCE(NEW.receipt_number, '') || '.',
      'scheme', s.id::TEXT, 'scheme_paid:' || NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scheme_payment_notify_customer ON public.scheme_installments;
CREATE TRIGGER scheme_payment_notify_customer AFTER UPDATE OF status ON public.scheme_installments
  FOR EACH ROW EXECUTE FUNCTION public.scheme_payment_notify_customer();

-- Scheme due-date reminders: one notification per installment per stage (days before due,
-- 0 = due today, -1 = overdue). Run daily by pg_cron (below) — no open browser needed.
CREATE OR REPLACE FUNCTION public.generate_scheme_reminders()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_days INTEGER[];
  v_left INTEGER;
  v_stage INTEGER;
  v_count INTEGER := 0;
  v_before INTEGER;
BEGIN
  SELECT COALESCE(reminder_days, '{7,3,1,0,-1}') INTO v_days FROM public.store_settings WHERE id = 1;
  FOR r IN
    SELECT s.id AS scheme_id, s.scheme_number, s.scheme_name, COALESCE(s.customer_id, public.customer_id_for_phone(s.phone)) AS cid,
           c.name AS customer_name, i.id AS inst_id, i.installment_number, i.due_date, i.amount_due
    FROM public.jewellery_schemes s
    JOIN LATERAL (SELECT * FROM public.scheme_installments WHERE scheme_id = s.id AND status = 'pending' ORDER BY installment_number LIMIT 1) i ON TRUE
    LEFT JOIN public.customers c ON c.id = COALESCE(s.customer_id, public.customer_id_for_phone(s.phone))
    WHERE s.status = 'active'
  LOOP
    CONTINUE WHEN r.cid IS NULL;
    v_left := r.due_date - CURRENT_DATE;
    v_stage := CASE WHEN v_left < 0 AND -1 = ANY(v_days) THEN -1 WHEN v_left = ANY(v_days) THEN v_left ELSE NULL END;
    CONTINUE WHEN v_stage IS NULL;
    SELECT COUNT(*) INTO v_before FROM public.customer_notifications WHERE dedupe_key = 'scheme_rem:' || r.inst_id || ':' || v_stage;
    PERFORM public.notify_customer(r.cid, CASE WHEN v_stage < 0 THEN 'scheme_overdue' WHEN v_stage = 0 THEN 'scheme_due_today' ELSE 'scheme_due' END,
      CASE WHEN v_stage < 0 THEN 'Installment overdue' WHEN v_stage = 0 THEN 'Installment due today' ELSE 'Installment due in ' || v_stage || ' day' || CASE WHEN v_stage = 1 THEN '' ELSE 's' END END,
      'Dear ' || COALESCE(NULLIF(r.customer_name, ''), 'Customer') || ', your jewellery savings scheme ' || r.scheme_name || ' (' || r.scheme_number || ') installment of ₹' || r.amount_due
        || CASE WHEN v_stage < 0 THEN ' was due on ' ELSE ' is due on ' END || to_char(r.due_date, 'DD Mon YYYY') || '. Please make your payment on or before the due date. Thank you!',
      'scheme', r.scheme_id::TEXT, 'scheme_rem:' || r.inst_id || ':' || v_stage);
    IF v_before = 0 THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Daily at 09:00 IST (03:30 UTC), when pg_cron is enabled (Database -> Extensions -> pg_cron).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'scheme-reminders';
    PERFORM cron.schedule('scheme-reminders', '30 3 * * *', 'SELECT public.generate_scheme_reminders()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- Public pages (no login): shop profile and coupon
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_public_shop_profile();
CREATE OR REPLACE FUNCTION public.get_public_shop_profile()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v JSONB;
  v_locked BOOLEAN := FALSE;
BEGIN
  SELECT to_jsonb(s) - 'admin_id' - 'admin_password' - 'staff_id' - 'staff_password' - 'staff_panels' - 'scheme_rules'
         - 'otp_minutes' - 'reminder_days' - 'payment_link_hours'
  INTO v FROM public.store_settings s WHERE id = 1;
  IF to_regclass('public.security_flags') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE((SELECT locked FROM public.security_flags WHERE id = 1), FALSE)' INTO v_locked;
  END IF;
  RETURN COALESCE(v, '{}'::JSONB) || jsonb_build_object('portal_locked', v_locked);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_coupon(p_code TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(c) - 'allowed_phones' FROM public.coupons c WHERE LOWER(c.code) = LOWER(BTRIM(COALESCE(p_code, ''))) LIMIT 1;
$$;

-- Payment screenshots: private bucket; customers can upload, only the shop can read.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN RETURN; END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('payment-proofs', 'payment-proofs', FALSE, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
  ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
  DROP POLICY IF EXISTS payment_proofs_upload ON storage.objects;
  CREATE POLICY payment_proofs_upload ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'payment-proofs');
  DROP POLICY IF EXISTS payment_proofs_read ON storage.objects;
  CREATE POLICY payment_proofs_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'payment-proofs');
END $$;

-- Shop side reads / changes the new tables like the rest of the POS tables.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_payments', 'customer_notifications', 'notification_deliveries', 'upi_payment_links', 'upi_payment_claims', 'customer_registration_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_portal_manage', t);
    -- Before the lock-down the POS still works without a Supabase login (anon); the lock-down narrows this.
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE)', t || '_portal_manage', t);
  END LOOP;
END $$;

-- Grants: customer and public functions to everyone; OTP creation only to the server.
GRANT EXECUTE ON FUNCTION public.customer_verify_otp(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_logout(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_customer_registration(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_portal_data(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_scheme_detail(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_bill(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_notifications_list(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_mark_read(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_update_profile(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_payment_link(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_link(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_payment_claim(TEXT, TEXT, NUMERIC, TIMESTAMPTZ, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_shop_profile() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_coupon(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_link(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_payment_link(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_payment_claim(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_payment_claim(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_scheme_reminders() TO anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_create_otp(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_discard_otp(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_customer(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_customer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- The POS hears about new payment claims straight away.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'upi_payment_claims') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.upi_payment_claims;
  END IF;
END $$;

-- The OTP Edge Function runs as service_role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.customer_create_otp(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.customer_discard_otp(TEXT) TO service_role;
  END IF;
END $$;

-- Once the security lock-down is switched on, keep it on after re-running this file.
DO $$
DECLARE v_locked BOOLEAN := FALSE;
BEGIN
  IF to_regclass('public.security_flags') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE((SELECT locked FROM public.security_flags WHERE id = 1), FALSE)' INTO v_locked;
  END IF;
  IF v_locked THEN
    EXECUTE 'SELECT public.apply_security_lockdown()';
  END IF;
END $$;
