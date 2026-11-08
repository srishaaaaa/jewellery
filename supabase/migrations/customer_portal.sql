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
-- Other UPI IDs the shop has used, so it can switch back with one tap: [{"id": "...", "name": "..."}].
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS upi_saved JSONB NOT NULL DEFAULT '[]'::JSONB;
-- Days before the due date to remind (0 = on the day, -1 = once when overdue)
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS reminder_days INTEGER[] NOT NULL DEFAULT '{7,3,1,0,-1}';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS otp_minutes INTEGER NOT NULL DEFAULT 5;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS payment_link_hours INTEGER NOT NULL DEFAULT 6;
-- Automatic reminders to customers (nothing is sent until the provider secrets are added).
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS whatsapp_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS sms_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS email TEXT;
-- The address the customer has proved they own (compared with customers.email, so a later edit by the shop shows as not verified).
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS verified_email TEXT NOT NULL DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS reminders_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
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
ALTER TABLE public.order_payments ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS advance_order_id UUID REFERENCES public.advance_orders(id) ON DELETE CASCADE;
-- A customer can clear an advance order's whole balance by UPI, so the deposit may reach the total.
ALTER TABLE public.advance_orders DROP CONSTRAINT IF EXISTS advance_deposit_less_than_total;
ALTER TABLE public.advance_orders DROP CONSTRAINT IF EXISTS advance_deposit_within_total;
ALTER TABLE public.advance_orders ADD CONSTRAINT advance_deposit_within_total CHECK (deposit_amount <= total_amount);
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
-- channel: sms / email (login), email_change / phone_change (proving a new address while logged in).
-- phone_key holds the mobile key, or the lower-case email address for the email channels.
ALTER TABLE public.customer_otps ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'sms';
ALTER TABLE public.customer_otps ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.customer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);

-- Customer passwords: only ever a salted, repeated hash, in a table the app cannot read.
CREATE TABLE IF NOT EXISTS public.customer_passwords (
  customer_id UUID PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  must_change BOOLEAN NOT NULL DEFAULT FALSE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.customer_passwords ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_passwords FROM anon, authenticated;
-- A session opened with the shop's starting password can do nothing except choose a new password.
ALTER TABLE public.customer_sessions ADD COLUMN IF NOT EXISTS password_change_required BOOLEAN NOT NULL DEFAULT FALSE;

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
ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Each notification goes out at most once per channel.
CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_once_idx ON public.notification_deliveries(notification_id, channel);
CREATE INDEX IF NOT EXISTS notification_deliveries_ref_idx ON public.notification_deliveries(provider_ref) WHERE provider_ref <> '';

-- Phones / computers where the customer switched on alerts (never readable by the app).
CREATE TABLE IF NOT EXISTS public.customer_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.customer_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_push_subscriptions FROM anon, authenticated;

-- Random topic for "something changed, reload" signals to this customer's open portal (it carries no data).
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS live_topic TEXT;

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
ALTER TABLE public.upi_payment_links ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.upi_payment_links ADD COLUMN IF NOT EXISTS advance_order_id UUID REFERENCES public.advance_orders(id) ON DELETE CASCADE;

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
ALTER TABLE public.upi_payment_claims ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.upi_payment_claims ADD COLUMN IF NOT EXISTS advance_order_id UUID REFERENCES public.advance_orders(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS upi_payment_claims_open_utr_adv_idx ON public.upi_payment_claims(advance_order_id, UPPER(BTRIM(utr)))
  WHERE status = 'pending' AND BTRIM(utr) <> '' AND advance_order_id IS NOT NULL;
-- Scheme installments paid by UPI from the customer portal.
ALTER TABLE public.upi_payment_links ADD COLUMN IF NOT EXISTS scheme_id UUID REFERENCES public.jewellery_schemes(id) ON DELETE CASCADE;
ALTER TABLE public.upi_payment_claims ADD COLUMN IF NOT EXISTS scheme_id UUID REFERENCES public.jewellery_schemes(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS upi_payment_claims_open_utr_scheme_idx ON public.upi_payment_claims(scheme_id, UPPER(BTRIM(utr)))
  WHERE status = 'pending' AND BTRIM(utr) <> '' AND scheme_id IS NOT NULL;

-- Amount still owed on a bill: only credit bills have a balance.
CREATE OR REPLACE FUNCTION public.order_outstanding(o public.orders)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN o.credit_status = 'outstanding' AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
              THEN GREATEST(ROUND(COALESCE(o.total, 0) - COALESCE(o.credit_paid_amount, 0), 2), 0) ELSE 0 END;
$$;

-- Balance on an advance order that is still open.
CREATE OR REPLACE FUNCTION public.advance_outstanding(a public.advance_orders)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN a.status IN ('completed', 'cancelled') THEN 0
              ELSE GREATEST(ROUND(COALESCE(a.total_amount, 0) - COALESCE(a.deposit_amount, 0), 2), 0) END;
$$;

-- The next installment of an active scheme (a scheme is paid one whole installment at a time).
CREATE OR REPLACE FUNCTION public.scheme_next_due(s public.jewellery_schemes)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN s.status <> 'active' THEN 0 ELSE COALESCE((
    SELECT i.amount_due FROM public.scheme_installments i WHERE i.scheme_id = s.id AND i.status = 'pending' ORDER BY i.installment_number LIMIT 1), 0) END;
$$;

CREATE OR REPLACE FUNCTION public.new_portal_token()
RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');
$$;

-- ---------------------------------------------------------------------------
-- OTP: create (only the server-side OTP function may call this) and verify
-- ---------------------------------------------------------------------------
-- Session token -> customer id (raises when missing, expired or logged out).
CREATE OR REPLACE FUNCTION public.portal_customer(p_token TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.customer_sessions;
BEGIN
  SELECT * INTO s FROM public.customer_sessions WHERE token_hash = encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex');
  IF NOT FOUND OR s.revoked OR s.expires_at < NOW() THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
  IF s.password_change_required THEN RAISE EXCEPTION 'PASSWORD_CHANGE_REQUIRED'; END IF;
  UPDATE public.customer_sessions SET last_seen_at = NOW() WHERE id = s.id AND last_seen_at < NOW() - INTERVAL '5 minutes';
  RETURN s.customer_id;
END;
$$;

-- Shared by every kind of code: cooldown, hourly limit, one live code per address.
CREATE OR REPLACE FUNCTION public.otp_issue(p_channel TEXT, p_key TEXT, p_customer UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_last TIMESTAMPTZ;
  v_recent INTEGER;
  v_code TEXT;
  v_salt TEXT := public.new_portal_token();
  v_minutes INTEGER;
BEGIN
  SELECT MAX(created_at), COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') INTO v_last, v_recent
  FROM public.customer_otps WHERE phone_key = p_key AND channel = p_channel;
  IF v_last IS NOT NULL AND v_last > NOW() - INTERVAL '60 seconds' THEN
    RAISE EXCEPTION 'Please wait % seconds before asking for a new OTP.', CEIL(EXTRACT(EPOCH FROM (v_last + INTERVAL '60 seconds' - NOW())));
  END IF;
  IF v_recent >= 5 THEN RAISE EXCEPTION 'Too many OTP requests. Try again in an hour.'; END IF;
  SELECT COALESCE(otp_minutes, 5) INTO v_minutes FROM public.store_settings WHERE id = 1;
  -- gen_random_uuid is cryptographically random; random() is not.
  v_code := LPAD((('x' || LEFT(replace(gen_random_uuid()::TEXT, '-', ''), 8))::BIT(32)::BIGINT % 1000000)::TEXT, 6, '0');
  UPDATE public.customer_otps SET used = TRUE WHERE phone_key = p_key AND channel = p_channel AND NOT used;
  INSERT INTO public.customer_otps (phone_key, channel, customer_id, salt, code_hash, expires_at)
  VALUES (p_key, p_channel, p_customer, v_salt, encode(sha256(convert_to(v_salt || ':' || v_code, 'UTF8')), 'hex'), NOW() + make_interval(mins => COALESCE(v_minutes, 5)));
  RETURN jsonb_build_object('code', v_code, 'expires_in_seconds', COALESCE(v_minutes, 5) * 60, 'resend_in_seconds', 60);
END;
$$;

-- Checks a code and uses it up. Raises when it is wrong, expired or used. p_customer: the code must belong to this customer.
-- A wrong try has to be saved, so failures come back as text for the caller to raise (a RAISE here would undo the count).
CREATE OR REPLACE FUNCTION public.otp_check(p_channel TEXT, p_key TEXT, p_code TEXT, p_customer UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.customer_otps;
BEGIN
  SELECT * INTO o FROM public.customer_otps
  WHERE phone_key = p_key AND channel = p_channel AND NOT used AND (p_customer IS NULL OR customer_id = p_customer)
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN 'Ask for a new OTP.'; END IF;
  IF o.expires_at < NOW() THEN UPDATE public.customer_otps SET used = TRUE WHERE id = o.id; RETURN 'The OTP has expired. Ask for a new one.'; END IF;
  IF o.attempts >= 5 THEN UPDATE public.customer_otps SET used = TRUE WHERE id = o.id; RETURN 'Too many wrong attempts. Ask for a new OTP.'; END IF;
  IF encode(sha256(convert_to(o.salt || ':' || BTRIM(COALESCE(p_code, '')), 'UTF8')), 'hex') <> o.code_hash THEN
    UPDATE public.customer_otps SET attempts = attempts + 1 WHERE id = o.id;
    RETURN 'Wrong OTP. ' || GREATEST(0, 4 - o.attempts) || ' attempt(s) left.';
  END IF;
  UPDATE public.customer_otps SET used = TRUE WHERE id = o.id;
  RETURN '';
END;
$$;

CREATE OR REPLACE FUNCTION public.otp_discard(p_channel TEXT, p_key TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.customer_otps WHERE phone_key = p_key AND channel = p_channel AND NOT used AND created_at > NOW() - INTERVAL '2 minutes';
$$;

CREATE OR REPLACE FUNCTION public.portal_new_session(p_customer UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.customers;
  v_token TEXT := public.new_portal_token();
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = p_customer;
  INSERT INTO public.customer_sessions (customer_id, token_hash, expires_at)
  VALUES (c.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), NOW() + INTERVAL '30 days');
  RETURN jsonb_build_object('token', v_token, 'customer', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone));
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_create_otp(p_phone TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key TEXT := public.phone_key(p_phone);
  v_customer UUID;
BEGIN
  IF LENGTH(v_key) <> 10 THEN RAISE EXCEPTION 'Enter a valid 10-digit mobile number.'; END IF;
  v_customer := public.customer_id_for_phone(v_key);
  IF v_customer IS NULL THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;
  RETURN public.otp_issue('sms', v_key, v_customer);
END;
$$;

-- Removes an OTP that could not be sent (so the cooldown does not block a retry).
CREATE OR REPLACE FUNCTION public.customer_discard_otp(p_phone TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.otp_discard('sms', public.phone_key(p_phone));
$$;

CREATE OR REPLACE FUNCTION public.customer_verify_otp(p_phone TEXT, p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key TEXT := public.phone_key(p_phone);
  v_problem TEXT;
  v_customer UUID;
BEGIN
  -- Problems are returned, not raised, so a wrong try stays counted (a RAISE would undo it).
  v_problem := public.otp_check('sms', v_key, p_code, NULL);
  IF v_problem <> '' THEN RETURN jsonb_build_object('problem', v_problem); END IF;
  v_customer := public.customer_id_for_phone(v_key);
  IF v_customer IS NULL THEN RETURN jsonb_build_object('problem', 'NOT_REGISTERED'); END IF;
  RETURN public.portal_new_session(v_customer);
END;
$$;

-- Lower-case email; the customer it belongs to, or nothing when no one (or more than one person) uses it.
CREATE OR REPLACE FUNCTION public.email_key(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT LOWER(BTRIM(COALESCE(p, ''))) $$;

CREATE OR REPLACE FUNCTION public.customer_id_for_email(p_email TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN COUNT(DISTINCT public.phone_key(phone)) = 1 THEN (ARRAY_AGG(id ORDER BY created_at))[1] END
  FROM public.customers WHERE public.email_key(p_email) <> '' AND public.email_key(email) = public.email_key(p_email);
$$;

-- Email login, step 1 (server only). The web function always answers the same way, so nobody can test which addresses are customers.
CREATE OR REPLACE FUNCTION public.customer_create_email_otp(p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key TEXT := public.email_key(p_email);
  v_customer UUID;
  v_shared BOOLEAN;
  v_otp JSONB;
  v_link TEXT;
BEGIN
  IF v_key !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  SELECT COUNT(*) > 0 INTO v_shared FROM public.customers WHERE public.email_key(email) = v_key;
  IF NOT v_shared THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  v_customer := public.customer_id_for_email(v_key);
  -- Issued even for a shared address, so its limit also caps the "use your mobile instead" email.
  v_otp := public.otp_issue('email', v_key, v_customer) || jsonb_build_object('status', CASE WHEN v_customer IS NULL THEN 'shared' ELSE 'ok' END);
  IF v_customer IS NOT NULL THEN
    -- One-time login link for the same email. Long and random, so only its hash is kept, with no salt, and it can be looked up.
    v_link := public.new_portal_token();
    UPDATE public.customer_otps SET used = TRUE WHERE phone_key = v_key AND channel = 'magic' AND NOT used;
    INSERT INTO public.customer_otps (phone_key, channel, customer_id, salt, code_hash, expires_at)
    VALUES (v_key, 'magic', v_customer, '', encode(sha256(convert_to(v_link, 'UTF8')), 'hex'), NOW() + INTERVAL '15 minutes');
    v_otp := v_otp || jsonb_build_object('magic_token', v_link, 'magic_minutes', 15);
  END IF;
  RETURN v_otp;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_verify_email_otp(p_email TEXT, p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key TEXT := public.email_key(p_email);
  v_problem TEXT;
  v_customer UUID;
BEGIN
  v_problem := public.otp_check('email', v_key, p_code, NULL);
  IF v_problem <> '' THEN RETURN jsonb_build_object('problem', v_problem); END IF;
  v_customer := public.customer_id_for_email(v_key);
  IF v_customer IS NULL THEN RETURN jsonb_build_object('problem', 'Please log in with your mobile number.'); END IF;
  UPDATE public.customers SET verified_email = v_key, updated_at = NOW() WHERE id = v_customer;
  -- The link from the same email goes with the code.
  UPDATE public.customer_otps SET used = TRUE WHERE phone_key = v_key AND channel = 'magic' AND NOT used;
  RETURN public.portal_new_session(v_customer);
END;
$$;

-- The emailed login link. Works once, for 15 minutes, and never if that email has since moved to someone else.
CREATE OR REPLACE FUNCTION public.customer_magic_login(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expired TEXT := 'This login link has expired or was already used. Please ask for a new one.';
  o public.customer_otps;
BEGIN
  SELECT * INTO o FROM public.customer_otps
  WHERE channel = 'magic' AND code_hash = encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND OR o.used OR o.expires_at < NOW() THEN RETURN jsonb_build_object('problem', v_expired); END IF;
  UPDATE public.customer_otps SET used = TRUE WHERE id = o.id;
  -- The code from the same email goes with the link.
  UPDATE public.customer_otps SET used = TRUE WHERE phone_key = o.phone_key AND channel = 'email' AND NOT used;
  IF public.customer_id_for_email(o.phone_key) IS DISTINCT FROM o.customer_id THEN RETURN jsonb_build_object('problem', v_expired); END IF;
  UPDATE public.customers SET verified_email = o.phone_key, updated_at = NOW() WHERE id = o.customer_id;
  RETURN public.portal_new_session(o.customer_id);
END;
$$;

-- Logged-in customer asks to prove a new email or mobile number (server only: the code is handed to the sender).
CREATE OR REPLACE FUNCTION public.customer_create_change_otp(p_token TEXT, p_channel TEXT, p_target TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cid UUID := public.portal_customer(p_token);
  c public.customers;
  v_key TEXT;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = v_cid;
  IF p_channel = 'email_change' THEN
    v_key := public.email_key(p_target);
    IF v_key !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid email address.'; END IF;
    IF EXISTS (SELECT 1 FROM public.customers x WHERE public.email_key(x.email) = v_key AND public.phone_key(x.phone) <> public.phone_key(c.phone)) THEN
      RAISE EXCEPTION 'This email is already used on another account. Please contact the shop.';
    END IF;
  ELSIF p_channel = 'phone_change' THEN
    v_key := public.phone_key(p_target);
    IF v_key !~ '^[6-9][0-9]{9}$' THEN RAISE EXCEPTION 'Enter a valid 10-digit mobile number.'; END IF;
    IF v_key = public.phone_key(c.phone) THEN RAISE EXCEPTION 'This is already your mobile number.'; END IF;
    IF public.customer_id_for_phone(v_key) IS NOT NULL THEN RAISE EXCEPTION 'This number is already registered. Please contact the shop.'; END IF;
  ELSE
    RAISE EXCEPTION 'Unknown request.';
  END IF;
  RETURN public.otp_issue(p_channel, v_key, v_cid) || jsonb_build_object('key', v_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_confirm_email_change(p_token TEXT, p_email TEXT, p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cid UUID := public.portal_customer(p_token);
  v_key TEXT := public.email_key(p_email);
  v_problem TEXT;
BEGIN
  v_problem := public.otp_check('email_change', v_key, p_code, v_cid);
  IF v_problem <> '' THEN RETURN jsonb_build_object('problem', v_problem); END IF;
  UPDATE public.customers SET email = v_key, verified_email = v_key, updated_at = NOW() WHERE id = v_cid;
  PERFORM public.notify_customer(v_cid, 'profile', 'Email verified', v_key || ' is now your email for this account.', '', '', NULL);
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- New number proved by OTP: the customer's records move with them, so whoever gets the old number later sees nothing of theirs.
CREATE OR REPLACE FUNCTION public.customer_confirm_phone_change(p_token TEXT, p_phone TEXT, p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cid UUID := public.portal_customer(p_token);
  v_new TEXT := public.phone_key(p_phone);
  v_problem TEXT;
  c public.customers;
  v_old TEXT;
  t TEXT;
BEGIN
  v_problem := public.otp_check('phone_change', v_new, p_code, v_cid);
  IF v_problem <> '' THEN RETURN jsonb_build_object('problem', v_problem); END IF;
  IF public.customer_id_for_phone(v_new) IS NOT NULL THEN RETURN jsonb_build_object('problem', 'This number is already registered. Please contact the shop.'); END IF;
  SELECT * INTO c FROM public.customers WHERE id = v_cid FOR UPDATE;
  v_old := public.phone_key(c.phone);
  IF LENGTH(v_old) = 10 THEN
    -- Keeps each record's own format (with or without the 91), only swapping the 10-digit number.
    FOREACH t IN ARRAY ARRAY['orders', 'advance_orders', 'jewellery_schemes', 'customer_advances', 'old_gold_exchanges', 'sales_returns', 'quotations', 'repairs'] LOOP
      IF to_regclass('public.' || t) IS NOT NULL THEN
        EXECUTE format('UPDATE public.%I SET phone = regexp_replace(phone, ''[^0-9]'', '''', ''g'') WHERE public.phone_key(phone) = $1', t) USING v_old;
        EXECUTE format('UPDATE public.%I SET phone = LEFT(phone, LENGTH(phone) - 10) || $2 WHERE public.phone_key(phone) = $1', t) USING v_old, v_new;
      END IF;
    END LOOP;
  END IF;
  UPDATE public.customers SET phone = LEFT(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), GREATEST(LENGTH(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')) - 10, 0)) || v_new, updated_at = NOW()
  WHERE id = v_cid;
  -- Every other device has to log in again with the new number.
  UPDATE public.customer_sessions SET revoked = TRUE WHERE customer_id = v_cid AND token_hash <> encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  INSERT INTO public.audit_logs (action, entity_type, entity_id, new_value, user_name)
  VALUES ('customer_phone_changed', 'customer', v_cid::TEXT, jsonb_build_object('old_phone', v_old, 'new_phone', v_new), 'Customer portal');
  PERFORM public.notify_customer(v_cid, 'profile', 'Mobile number changed', 'Your login number is now +91 ' || v_new || '. If this was not you, contact the shop straight away.', '', '', NULL);
  RETURN jsonb_build_object('ok', TRUE, 'phone', v_new);
END;
$$;

-- ---------------------------------------------------------------------------
-- Customer passwords
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_password_hash(p_salt TEXT, p_pass TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v BYTEA := sha256(convert_to(p_salt || ':' || p_pass, 'UTF8'));
  v_salt BYTEA := convert_to(p_salt, 'UTF8');
BEGIN
  -- Repeated so that guessing against a stolen copy is slow.
  FOR i IN 1..10000 LOOP v := sha256(v || v_salt); END LOOP;
  RETURN encode(v, 'hex');
END;
$$;

-- Why a password the customer chose cannot be used ('' when it is fine).
CREATE OR REPLACE FUNCTION public.customer_password_problem(p_customer UUID, p_pass TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v TEXT := COALESCE(p_pass, '');
  v_phone TEXT;
BEGIN
  IF LENGTH(v) < 8 THEN RETURN 'The password must have at least 8 characters.'; END IF;
  IF LENGTH(v) > 72 THEN RETURN 'The password can have at most 72 characters.'; END IF;
  SELECT public.phone_key(phone) INTO v_phone FROM public.customers WHERE id = p_customer;
  IF LOWER(v) IN ('customer123', 'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'admin123', 'nandi123')
     OR v ~ '^(.)\1+$' OR (COALESCE(v_phone, '') <> '' AND POSITION(v_phone IN v) > 0) THEN
    RETURN 'This password is too easy to guess. Please choose another.';
  END IF;
  RETURN '';
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_password_store(p_customer UUID, p_pass TEXT, p_must_change BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_salt TEXT := public.new_portal_token();
BEGIN
  INSERT INTO public.customer_passwords (customer_id, salt, pass_hash, must_change)
  VALUES (p_customer, v_salt, public.customer_password_hash(v_salt, p_pass), p_must_change)
  ON CONFLICT (customer_id) DO UPDATE SET salt = EXCLUDED.salt, pass_hash = EXCLUDED.pass_hash, must_change = EXCLUDED.must_change,
    failed_attempts = 0, locked_until = NULL, updated_at = NOW();
END;
$$;

-- The customer behind a mobile number or email typed at login.
CREATE OR REPLACE FUNCTION public.customer_id_for_login(p_login TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN POSITION('@' IN COALESCE(p_login, '')) > 0 THEN public.customer_id_for_email(p_login)
              WHEN LENGTH(public.phone_key(p_login)) = 10 THEN public.customer_id_for_phone(p_login) END;
$$;

-- Password login. Failures come back as text, because a RAISE would undo the count of wrong tries.
CREATE OR REPLACE FUNCTION public.customer_password_login(p_login TEXT, p_password TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cid UUID := public.customer_id_for_login(p_login);
  v_wrong TEXT := 'Wrong mobile number or password. First time here? Use Forgot password or ask the shop.';
  p public.customer_passwords;
  v_session JSONB;
BEGIN
  SELECT * INTO p FROM public.customer_passwords WHERE customer_id = v_cid FOR UPDATE;
  IF NOT FOUND THEN
    -- Same work and same answer, so nobody can test who has an account.
    PERFORM public.customer_password_hash('no-account', COALESCE(p_password, ''));
    RETURN jsonb_build_object('problem', v_wrong);
  END IF;
  IF p.locked_until IS NOT NULL AND p.locked_until > NOW() THEN
    RETURN jsonb_build_object('problem', 'Too many wrong tries. Try again in ' || CEIL(EXTRACT(EPOCH FROM (p.locked_until - NOW())) / 60) || ' minute(s), or use Forgot password.');
  END IF;
  IF public.customer_password_hash(p.salt, COALESCE(p_password, '')) <> p.pass_hash THEN
    UPDATE public.customer_passwords
    SET failed_attempts = CASE WHEN failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END,
        locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE NULL END
    WHERE customer_id = p.customer_id;
    RETURN jsonb_build_object('problem', v_wrong);
  END IF;
  UPDATE public.customer_passwords SET failed_attempts = 0, locked_until = NULL WHERE customer_id = p.customer_id;
  v_session := public.portal_new_session(p.customer_id);
  IF p.must_change THEN
    UPDATE public.customer_sessions SET password_change_required = TRUE
    WHERE token_hash = encode(sha256(convert_to(v_session ->> 'token', 'UTF8')), 'hex');
  END IF;
  RETURN v_session || jsonb_build_object('must_change', p.must_change);
END;
$$;

-- Logged in: set a first password, change it, or replace the shop's starting password.
CREATE OR REPLACE FUNCTION public.customer_change_password(p_token TEXT, p_current TEXT, p_new TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hash TEXT := encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex');
  s public.customer_sessions;
  p public.customer_passwords;
  v_problem TEXT;
BEGIN
  SELECT * INTO s FROM public.customer_sessions WHERE token_hash = v_hash;
  IF NOT FOUND OR s.revoked OR s.expires_at < NOW() THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
  SELECT * INTO p FROM public.customer_passwords WHERE customer_id = s.customer_id FOR UPDATE;
  IF FOUND THEN
    IF public.customer_password_hash(p.salt, COALESCE(p_current, '')) <> p.pass_hash THEN
      -- Five wrong tries end this session, so an unattended phone cannot be used to guess.
      IF p.failed_attempts + 1 >= 5 THEN
        UPDATE public.customer_passwords SET failed_attempts = 0 WHERE customer_id = p.customer_id;
        UPDATE public.customer_sessions SET revoked = TRUE WHERE id = s.id;
        RETURN jsonb_build_object('problem', 'Too many wrong tries. Please log in again.');
      END IF;
      UPDATE public.customer_passwords SET failed_attempts = failed_attempts + 1 WHERE customer_id = p.customer_id;
      RETURN jsonb_build_object('problem', 'The current password is wrong.');
    END IF;
    IF COALESCE(p_new, '') = COALESCE(p_current, '') THEN RETURN jsonb_build_object('problem', 'Choose a password different from the current one.'); END IF;
  END IF;
  v_problem := public.customer_password_problem(s.customer_id, p_new);
  IF v_problem <> '' THEN RETURN jsonb_build_object('problem', v_problem); END IF;
  PERFORM public.customer_password_store(s.customer_id, p_new, FALSE);
  UPDATE public.customer_sessions SET password_change_required = FALSE WHERE id = s.id;
  -- Every other device has to log in again.
  UPDATE public.customer_sessions SET revoked = TRUE WHERE customer_id = s.customer_id AND id <> s.id;
  PERFORM public.notify_customer(s.customer_id, 'profile', 'Password changed', 'Your password was changed. If this was not you, contact the shop straight away.', '', '', NULL);
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- Forgot password: the login code from SMS or email (see customer-otp) proves who it is, then the new password is saved.
CREATE OR REPLACE FUNCTION public.customer_reset_password(p_login TEXT, p_code TEXT, p_new TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_email BOOLEAN := POSITION('@' IN COALESCE(p_login, '')) > 0;
  v_key TEXT := CASE WHEN POSITION('@' IN COALESCE(p_login, '')) > 0 THEN public.email_key(p_login) ELSE public.phone_key(p_login) END;
  v_cid UUID := public.customer_id_for_login(p_login);
  v_problem TEXT;
BEGIN
  -- Checked first, so a weak password does not use up the code.
  v_problem := public.customer_password_problem(v_cid, p_new);
  IF v_problem <> '' THEN RETURN jsonb_build_object('problem', v_problem); END IF;
  v_problem := public.otp_check(CASE WHEN v_is_email THEN 'email' ELSE 'sms' END, v_key, p_code, NULL);
  IF v_problem <> '' THEN RETURN jsonb_build_object('problem', v_problem); END IF;
  IF v_cid IS NULL THEN RETURN jsonb_build_object('problem', 'Please contact the shop.'); END IF;
  PERFORM public.customer_password_store(v_cid, p_new, FALSE);
  IF v_is_email THEN
    UPDATE public.customers SET verified_email = v_key, updated_at = NOW() WHERE id = v_cid;
    UPDATE public.customer_otps SET used = TRUE WHERE phone_key = v_key AND channel = 'magic' AND NOT used;
  END IF;
  UPDATE public.customer_sessions SET revoked = TRUE WHERE customer_id = v_cid;
  PERFORM public.notify_customer(v_cid, 'profile', 'Password changed', 'Your password was reset. If this was not you, contact the shop straight away.', '', '', NULL);
  RETURN public.portal_new_session(v_cid);
END;
$$;

-- Shop: a starting password (or a reset) for one customer. The customer must replace it at first login.
CREATE OR REPLACE FUNCTION public.shop_set_customer_password(p_customer_id UUID, p_password TEXT, p_by TEXT DEFAULT 'Admin')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN RAISE EXCEPTION 'Customer not found.'; END IF;
  IF LENGTH(COALESCE(p_password, '')) NOT BETWEEN 8 AND 72 THEN RAISE EXCEPTION 'The password must have 8 to 72 characters.'; END IF;
  PERFORM public.customer_password_store(p_customer_id, p_password, TRUE);
  UPDATE public.customer_sessions SET revoked = TRUE WHERE customer_id = p_customer_id;
  INSERT INTO public.audit_logs (action, entity_type, entity_id, new_value, user_name)
  VALUES ('customer_password_set_by_shop', 'customer', p_customer_id::TEXT, '{}'::JSONB, COALESCE(NULLIF(p_by, ''), 'Admin'));
END;
$$;

-- Customer's reminder and alert choices.
CREATE OR REPLACE FUNCTION public.customer_set_reminders(p_token TEXT, p_on BOOLEAN)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.customers SET reminders_opt_out = NOT COALESCE(p_on, TRUE), updated_at = NOW() WHERE id = public.portal_customer(p_token);
$$;

CREATE OR REPLACE FUNCTION public.customer_push_subscribe(p_token TEXT, p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid UUID := public.portal_customer(p_token);
BEGIN
  IF COALESCE(p_endpoint, '') !~ '^https://' OR COALESCE(p_p256dh, '') = '' OR COALESCE(p_auth, '') = '' THEN RAISE EXCEPTION 'Bad subscription.'; END IF;
  IF (SELECT COUNT(*) FROM public.customer_push_subscriptions WHERE customer_id = v_cid AND endpoint <> p_endpoint) >= 10 THEN
    DELETE FROM public.customer_push_subscriptions WHERE id = (SELECT id FROM public.customer_push_subscriptions WHERE customer_id = v_cid ORDER BY created_at LIMIT 1);
  END IF;
  -- A shared device moves to whoever logged in last.
  INSERT INTO public.customer_push_subscriptions (customer_id, endpoint, p256dh, auth) VALUES (v_cid, LEFT(p_endpoint, 1000), LEFT(p_p256dh, 200), LEFT(p_auth, 100))
  ON CONFLICT (endpoint) DO UPDATE SET customer_id = v_cid, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, created_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_push_unsubscribe(p_token TEXT, p_endpoint TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.customer_push_subscriptions WHERE customer_id = public.portal_customer(p_token) AND endpoint = p_endpoint;
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
  v_advances JSONB;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = v_cid;
  IF c.live_topic IS NULL THEN
    UPDATE public.customers SET live_topic = public.new_portal_token() WHERE id = v_cid RETURNING * INTO c;
  END IF;
  v_key := public.phone_key(c.phone);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'deposit_id', a.deposit_id, 'product_name', a.product_name, 'total_amount', a.total_amount,
      'paid', a.deposit_amount, 'balance', public.advance_outstanding(a), 'status', a.status, 'expected_delivery_date', a.expected_delivery_date,
      'created_at', a.created_at, 'invoice_number', a.invoice_number,
      'pending_claim', EXISTS (SELECT 1 FROM public.upi_payment_claims k WHERE k.advance_order_id = a.id AND k.status = 'pending')
    ) ORDER BY a.created_at DESC), '[]'::JSONB) INTO v_advances
  FROM public.advance_orders a WHERE public.phone_key(a.phone) = v_key AND v_key <> '';
  SELECT COALESCE(jsonb_agg(public.portal_bill_json(o) ORDER BY o.created_at DESC), '[]'::JSONB) INTO v_bills
  FROM public.orders o WHERE public.phone_key(o.phone) = v_key AND v_key <> '' AND COALESCE(o.order_type, '') <> 'online_request';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'scheme_number', s.scheme_number, 'scheme_name', s.scheme_name, 'frequency', s.frequency,
      'monthly_amount', s.monthly_amount, 'total_installments', s.total_installments, 'installments_paid', s.installments_paid,
      'total_paid', s.total_paid, 'amount_redeemed', s.amount_redeemed, 'start_date', s.start_date, 'maturity_date', s.maturity_date,
      'next_due_date', s.next_due_date, 'status', s.status, 'total_grams', s.total_grams, 'gold_purity', s.gold_purity,
      'benefit_type', s.benefit_type, 'making_benefit_value', s.making_benefit_value, 'making_benefit_unit', s.making_benefit_unit,
      'wastage_benefit_value', s.wastage_benefit_value, 'wastage_benefit_unit', s.wastage_benefit_unit,
      'benefit_used', s.benefit_used, 'benefit_forfeited', s.benefit_forfeited, 'duration_months', s.duration_months,
      'next_amount', public.scheme_next_due(s),
      'pending_claim', EXISTS (SELECT 1 FROM public.upi_payment_claims k WHERE k.scheme_id = s.id AND k.status = 'pending')
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
    UNION ALL
    SELECT jsonb_build_object('kind', 'advance', 'date', ap.received_at, 'invoice_no', a.deposit_id, 'amount', ap.amount, 'method', ap.payment_method,
                              'reference', NULL, 'status', 'verified', 'verified_at', ap.received_at)
    FROM public.advance_order_payments ap JOIN public.advance_orders a ON a.id = ap.advance_order_id
    WHERE ap.amount > 0 AND public.phone_key(a.phone) = v_key AND v_key <> ''
    UNION ALL
    SELECT jsonb_build_object('kind', 'advance', 'date', p.created_at, 'invoice_no', a.deposit_id, 'amount', p.amount, 'method', p.payment_method,
                              'reference', NULLIF(p.utr, ''), 'status', 'verified', 'verified_at', p.created_at)
    FROM public.order_payments p JOIN public.advance_orders a ON a.id = p.advance_order_id WHERE public.phone_key(a.phone) = v_key AND v_key <> ''
    UNION ALL
    SELECT jsonb_build_object('kind', 'claim', 'date', k.created_at, 'invoice_no', a.deposit_id, 'amount', k.amount, 'method', 'upi',
                              'reference', NULLIF(k.utr, ''), 'status', CASE k.status WHEN 'pending' THEN 'awaiting_verification' ELSE k.status END,
                              'verified_at', k.reviewed_at, 'reason', NULLIF(k.review_reason, ''))
    FROM public.upi_payment_claims k JOIN public.advance_orders a ON a.id = k.advance_order_id
    WHERE public.phone_key(a.phone) = v_key AND v_key <> '' AND k.status <> 'verified'
    UNION ALL
    SELECT jsonb_build_object('kind', 'claim', 'date', k.created_at, 'invoice_no', s.scheme_number, 'amount', k.amount, 'method', 'upi',
                              'reference', NULLIF(k.utr, ''), 'status', CASE k.status WHEN 'pending' THEN 'awaiting_verification' ELSE k.status END,
                              'verified_at', k.reviewed_at, 'reason', NULLIF(k.review_reason, ''))
    FROM public.upi_payment_claims k JOIN public.jewellery_schemes s ON s.id = k.scheme_id
    WHERE (s.customer_id = v_cid OR (public.phone_key(s.phone) = v_key AND v_key <> '')) AND k.status <> 'verified'
  ) q;
  SELECT COUNT(*) INTO v_unread FROM public.customer_notifications WHERE customer_id = v_cid AND read_at IS NULL;
  RETURN jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'code', LEFT(c.id::TEXT, 8), 'name', c.name, 'phone', c.phone, 'email', COALESCE(c.email, ''), 'address', c.address, 'created_at', c.created_at,
      'email_verified', public.email_key(c.email) <> '' AND public.email_key(c.email) = c.verified_email, 'reminders_on', NOT c.reminders_opt_out,
      'has_password', EXISTS (SELECT 1 FROM public.customer_passwords p WHERE p.customer_id = c.id)),
    'bills', v_bills, 'schemes', v_schemes, 'payments', v_payments, 'advances', v_advances, 'unread', v_unread, 'live_topic', c.live_topic);
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

-- Customers may clear their email and edit their address here. A new email or mobile needs a code (functions above).
CREATE OR REPLACE FUNCTION public.customer_update_profile(p_token TEXT, p_email TEXT, p_address TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cid UUID := public.portal_customer(p_token);
  v_current TEXT;
BEGIN
  SELECT public.email_key(email) INTO v_current FROM public.customers WHERE id = v_cid;
  -- A different email can log in to this account, so it only changes through customer_confirm_email_change.
  IF public.email_key(p_email) NOT IN ('', v_current) THEN RAISE EXCEPTION 'Verify the new email with its code first.'; END IF;
  UPDATE public.customers SET email = public.email_key(p_email), address = LEFT(BTRIM(COALESCE(p_address, '')), 300), updated_at = NOW() WHERE id = v_cid;
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

-- Shop: money taken for a credit bill at the counter, all of the balance or part of it. Each payment is kept;
-- the bill is marked paid only when the payments reach its total.
CREATE OR REPLACE FUNCTION public.record_credit_payment(p_order_id UUID, p_amount NUMERIC, p_method TEXT, p_note TEXT DEFAULT '', p_by TEXT DEFAULT 'Admin')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders;
  v_due NUMERIC;
  v_amount NUMERIC := ROUND(COALESCE(p_amount, 0), 2);
  v_method TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_method), ''), 'cash'));
  v_paid NUMERIC;
  v_full BOOLEAN;
  v_methods INTEGER;
  v_by TEXT := COALESCE(NULLIF(BTRIM(p_by), ''), 'Admin');
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found.'; END IF;
  IF o.credit_status IS DISTINCT FROM 'outstanding' THEN RAISE EXCEPTION 'Bill % is not an outstanding credit bill.', o.invoice_no; END IF;
  v_due := public.order_outstanding(o);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Enter the amount received.'; END IF;
  IF v_amount > v_due THEN RAISE EXCEPTION 'The amount (₹%) is more than the balance (₹%).', v_amount, v_due; END IF;
  IF v_method NOT IN ('cash', 'upi', 'card', 'bank', 'cheque', 'mixed') THEN v_method := 'cash'; END IF;
  INSERT INTO public.order_payments (order_id, amount, payment_method, reference, verified_by)
  VALUES (o.id, v_amount, v_method, LEFT(BTRIM(COALESCE(p_note, '')), 300), v_by);
  v_paid := ROUND(COALESCE(o.credit_paid_amount, 0) + v_amount, 2);
  v_full := v_paid >= COALESCE(o.total, 0);
  SELECT COUNT(DISTINCT payment_method) INTO v_methods FROM public.order_payments WHERE order_id = o.id;
  UPDATE public.orders SET credit_paid_amount = v_paid, updated_at = NOW(),
         credit_status = CASE WHEN v_full THEN 'paid' ELSE credit_status END,
         credit_paid_at = CASE WHEN v_full THEN NOW() ELSE credit_paid_at END,
         credit_paid_method = CASE WHEN v_full THEN CASE WHEN v_methods > 1 THEN 'mixed' ELSE v_method END ELSE credit_paid_method END,
         credit_paid_note = CASE WHEN v_full THEN LEFT(BTRIM(COALESCE(p_note, '')), 300) ELSE credit_paid_note END
  WHERE id = o.id;
  INSERT INTO public.audit_logs (action, entity_type, entity_id, new_value, user_name)
  VALUES ('credit_payment_recorded', 'order', o.invoice_no, jsonb_build_object('amount', v_amount, 'method', v_method, 'balance', GREATEST(COALESCE(o.total, 0) - v_paid, 0)), v_by);
  PERFORM public.notify_customer(public.customer_id_for_phone(o.phone), 'payment_verified', CASE WHEN v_full THEN 'Bill fully paid' ELSE 'Payment received' END,
    'We received ₹' || v_amount || ' for bill ' || o.invoice_no || CASE WHEN v_full THEN '. The bill is fully paid. Thank you!' ELSE '. Balance ₹' || GREATEST(COALESCE(o.total, 0) - v_paid, 0) || '.' END,
    'bill', o.id::TEXT, NULL);
  RETURN jsonb_build_object('paid', v_paid, 'balance', GREATEST(COALESCE(o.total, 0) - v_paid, 0), 'fully_paid', v_full);
END;
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

-- Customer: "Pay Now" on the balance of one of their own advance orders.
CREATE OR REPLACE FUNCTION public.customer_advance_payment_link(p_token TEXT, p_advance_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cid UUID := public.portal_customer(p_token);
  a public.advance_orders;
  v_due NUMERIC;
  v_hours INTEGER;
  l public.upi_payment_links;
BEGIN
  SELECT * INTO a FROM public.advance_orders WHERE id = p_advance_id;
  IF NOT FOUND OR public.phone_key(a.phone) <> (SELECT public.phone_key(phone) FROM public.customers WHERE id = v_cid) THEN RAISE EXCEPTION 'Order not found.'; END IF;
  v_due := public.advance_outstanding(a);
  IF v_due <= 0 THEN RAISE EXCEPTION 'Order % has no balance to pay.', a.deposit_id; END IF;
  IF COALESCE((SELECT upi_id FROM public.store_settings WHERE id = 1), '') = '' THEN RAISE EXCEPTION 'The shop has not set up UPI payments yet.'; END IF;
  SELECT * INTO l FROM public.upi_payment_links WHERE advance_order_id = p_advance_id AND revoked_at IS NULL AND expires_at > NOW() + INTERVAL '30 minutes' AND amount = v_due
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT COALESCE(payment_link_hours, 6) INTO v_hours FROM public.store_settings WHERE id = 1;
    INSERT INTO public.upi_payment_links (token, advance_order_id, amount, created_by, expires_at)
    VALUES (public.new_portal_token(), p_advance_id, v_due, 'Customer portal', NOW() + make_interval(hours => COALESCE(v_hours, 6)))
    RETURNING * INTO l;
  END IF;
  RETURN jsonb_build_object('token', l.token, 'amount', l.amount, 'expires_at', l.expires_at, 'invoice_no', a.deposit_id);
END;
$$;

-- Customer: pay the next installment of one of their own schemes by UPI.
CREATE OR REPLACE FUNCTION public.customer_scheme_payment_link(p_token TEXT, p_scheme_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cid UUID := public.portal_customer(p_token);
  s public.jewellery_schemes;
  v_due NUMERIC;
  v_hours INTEGER;
  l public.upi_payment_links;
BEGIN
  SELECT * INTO s FROM public.jewellery_schemes WHERE id = p_scheme_id;
  IF NOT FOUND OR NOT (s.customer_id IS NOT DISTINCT FROM v_cid OR public.phone_key(s.phone) = (SELECT public.phone_key(phone) FROM public.customers WHERE id = v_cid)) THEN
    RAISE EXCEPTION 'Scheme not found.';
  END IF;
  v_due := public.scheme_next_due(s);
  IF v_due <= 0 THEN RAISE EXCEPTION 'Scheme % has no installment to pay.', s.scheme_number; END IF;
  IF COALESCE((SELECT upi_id FROM public.store_settings WHERE id = 1), '') = '' THEN RAISE EXCEPTION 'The shop has not set up UPI payments yet.'; END IF;
  SELECT * INTO l FROM public.upi_payment_links WHERE scheme_id = p_scheme_id AND revoked_at IS NULL AND expires_at > NOW() + INTERVAL '30 minutes' AND amount = v_due
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT COALESCE(payment_link_hours, 6) INTO v_hours FROM public.store_settings WHERE id = 1;
    INSERT INTO public.upi_payment_links (token, scheme_id, amount, created_by, expires_at)
    VALUES (public.new_portal_token(), p_scheme_id, v_due, 'Customer portal', NOW() + make_interval(hours => COALESCE(v_hours, 6)))
    RETURNING * INTO l;
  END IF;
  RETURN jsonb_build_object('token', l.token, 'amount', l.amount, 'expires_at', l.expires_at, 'invoice_no', s.scheme_number);
END;
$$;

-- Public payment page: shop UPI details and the approved amount (never more than the bill still owes).
CREATE OR REPLACE FUNCTION public.get_payment_link(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.upi_payment_links;
  o public.orders;
  a public.advance_orders;
  sc public.jewellery_schemes;
  s public.store_settings;
  v_due NUMERIC;
  v_state TEXT;
  v_doc TEXT;
  v_name TEXT;
  v_kind TEXT := 'bill';
BEGIN
  SELECT * INTO l FROM public.upi_payment_links WHERE token = BTRIM(COALESCE(p_token, ''));
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  IF l.scheme_id IS NOT NULL THEN
    SELECT * INTO sc FROM public.jewellery_schemes WHERE id = l.scheme_id;
    v_due := public.scheme_next_due(sc);
    v_due := CASE WHEN v_due = l.amount THEN v_due ELSE 0 END;
    v_doc := sc.scheme_number; v_name := sc.customer_name; v_kind := 'scheme';
  ELSIF l.advance_order_id IS NOT NULL THEN
    SELECT * INTO a FROM public.advance_orders WHERE id = l.advance_order_id;
    v_due := LEAST(l.amount, public.advance_outstanding(a)); v_doc := a.deposit_id; v_name := a.customer_name; v_kind := 'advance';
  ELSE
    SELECT * INTO o FROM public.orders WHERE id = l.order_id;
    v_due := LEAST(l.amount, public.order_outstanding(o)); v_doc := o.invoice_no; v_name := o.customer_name;
  END IF;
  SELECT * INTO s FROM public.store_settings WHERE id = 1;
  v_state := CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked' WHEN l.expires_at < NOW() THEN 'expired'
                  WHEN v_due <= 0 THEN 'paid' WHEN COALESCE(s.upi_id, '') = '' THEN 'no_upi' ELSE 'open' END;
  RETURN jsonb_build_object(
    'state', v_state, 'kind', v_kind, 'invoice_no', v_doc, 'amount', v_due, 'expires_at', l.expires_at,
    'customer_first_name', split_part(BTRIM(COALESCE(v_name, '')), ' ', 1),
    'shop_name', s.name, 'upi_id', CASE WHEN v_state = 'open' THEN s.upi_id ELSE '' END,
    'upi_name', COALESCE(NULLIF(s.upi_name, ''), s.name), 'rotate_minutes', COALESCE(s.upi_rotate_minutes, 5),
    'logo_url', s.logo_url, 'link_id', l.id,
    'pending_claim', EXISTS (SELECT 1 FROM public.upi_payment_claims k WHERE k.status = 'pending'
                             AND ((l.order_id IS NOT NULL AND k.order_id = l.order_id) OR (l.advance_order_id IS NOT NULL AND k.advance_order_id = l.advance_order_id)
                                  OR (l.scheme_id IS NOT NULL AND k.scheme_id = l.scheme_id))));
END;
$$;

-- "I've Paid": records a claim for the shop to check. Nothing is marked paid here.
CREATE OR REPLACE FUNCTION public.submit_payment_claim(p_link_token TEXT, p_utr TEXT, p_amount NUMERIC, p_paid_at TIMESTAMPTZ, p_screenshot_path TEXT, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.upi_payment_links;
  o public.orders;
  a public.advance_orders;
  sc public.jewellery_schemes;
  v_due NUMERIC;
  v_amount NUMERIC;
  v_phone TEXT;
  v_cust UUID;
  v_utr TEXT := UPPER(BTRIM(COALESCE(p_utr, '')));
  k public.upi_payment_claims;
BEGIN
  SELECT * INTO l FROM public.upi_payment_links WHERE token = BTRIM(COALESCE(p_link_token, '')) FOR UPDATE;
  IF NOT FOUND OR l.revoked_at IS NOT NULL OR l.expires_at < NOW() THEN RAISE EXCEPTION 'This payment link is no longer valid. Ask the shop for a new one.'; END IF;
  IF l.scheme_id IS NOT NULL THEN
    SELECT * INTO sc FROM public.jewellery_schemes WHERE id = l.scheme_id;
    v_due := public.scheme_next_due(sc); v_phone := sc.phone; v_cust := sc.customer_id;
    IF v_due <= 0 THEN RAISE EXCEPTION 'This scheme has no installment to pay.'; END IF;
    IF v_due <> l.amount THEN RAISE EXCEPTION 'The installment amount has changed. Please open the payment again from My Schemes.'; END IF;
    IF COALESCE(NULLIF(p_amount, 0), v_due) <> v_due THEN RAISE EXCEPTION 'Pay the full installment of ₹%.', v_due; END IF;
    IF EXISTS (SELECT 1 FROM public.upi_payment_claims WHERE status = 'pending' AND scheme_id = l.scheme_id) THEN
      RAISE EXCEPTION 'The shop is already checking your last installment payment. Please wait for it to be confirmed.';
    END IF;
  ELSIF l.advance_order_id IS NOT NULL THEN
    SELECT * INTO a FROM public.advance_orders WHERE id = l.advance_order_id;
    v_due := LEAST(l.amount, public.advance_outstanding(a)); v_phone := a.phone;
  ELSE
    SELECT * INTO o FROM public.orders WHERE id = l.order_id;
    v_due := LEAST(l.amount, public.order_outstanding(o)); v_phone := o.phone;
  END IF;
  IF v_due <= 0 THEN RAISE EXCEPTION 'This bill has no balance to pay.'; END IF;
  v_amount := ROUND(COALESCE(NULLIF(p_amount, 0), v_due), 2);
  IF v_amount <= 0 OR v_amount > v_due THEN RAISE EXCEPTION 'The amount must be between ₹1 and ₹% (the balance).', v_due; END IF;
  IF v_utr <> '' AND v_utr !~ '^[A-Z0-9]{6,35}$' THEN RAISE EXCEPTION 'Enter the UPI transaction ID / UTR as shown in your UPI app.'; END IF;
  IF v_utr <> '' AND (EXISTS (SELECT 1 FROM public.order_payments WHERE UPPER(BTRIM(utr)) = v_utr)
                      OR EXISTS (SELECT 1 FROM public.upi_payment_claims WHERE status = 'verified' AND UPPER(BTRIM(utr)) = v_utr)) THEN
    RAISE EXCEPTION 'This transaction ID has already been recorded.';
  END IF;
  IF (SELECT COUNT(*) FROM public.upi_payment_claims WHERE status = 'pending'
      AND ((l.order_id IS NOT NULL AND order_id = l.order_id) OR (l.advance_order_id IS NOT NULL AND advance_order_id = l.advance_order_id)
           OR (l.scheme_id IS NOT NULL AND scheme_id = l.scheme_id))) >= 3 THEN
    RAISE EXCEPTION 'The shop is already checking your payment. Please wait for it to be confirmed.';
  END IF;
  INSERT INTO public.upi_payment_claims (order_id, advance_order_id, scheme_id, link_id, customer_id, amount, utr, paid_at, screenshot_path, note)
  VALUES (l.order_id, l.advance_order_id, l.scheme_id, l.id, COALESCE(v_cust, public.customer_id_for_phone(v_phone)), v_amount, v_utr, COALESCE(p_paid_at, NOW()),
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
  a public.advance_orders;
  v_due NUMERIC;
  v_utr TEXT;
  p public.order_payments;
  v_paid NUMERIC;
  v_by TEXT := COALESCE(NULLIF(p_by, ''), 'Admin');
  sc public.jewellery_schemes;
  v_rec JSON;
BEGIN
  SELECT * INTO k FROM public.upi_payment_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment claim not found.'; END IF;
  IF k.status <> 'pending' THEN RAISE EXCEPTION 'This claim is already %.', k.status; END IF;
  IF k.scheme_id IS NOT NULL THEN
    SELECT * INTO sc FROM public.jewellery_schemes WHERE id = k.scheme_id FOR UPDATE;
    v_due := public.scheme_next_due(sc);
    IF v_due <= 0 THEN RAISE EXCEPTION 'Scheme % has no installment left to pay.', sc.scheme_number; END IF;
    IF k.amount <> v_due THEN RAISE EXCEPTION 'The claim (₹%) does not match the next installment (₹%).', k.amount, v_due; END IF;
    v_utr := UPPER(BTRIM(COALESCE(NULLIF(p_utr, ''), k.utr)));
    IF v_utr <> '' AND (EXISTS (SELECT 1 FROM public.order_payments WHERE UPPER(BTRIM(utr)) = v_utr)
                        OR EXISTS (SELECT 1 FROM public.upi_payment_claims WHERE status = 'verified' AND UPPER(BTRIM(utr)) = v_utr)) THEN
      RAISE EXCEPTION 'Transaction % has already been credited.', v_utr;
    END IF;
    -- Records the installment with its receipt and gold weight; the installment trigger notifies the customer.
    v_rec := public.record_scheme_installment(sc.id, 'upi', v_by, CASE WHEN v_utr <> '' THEN 'UPI UTR ' || v_utr ELSE 'UPI (customer portal)' END);
    UPDATE public.upi_payment_claims SET status = 'verified', utr = v_utr, reviewed_by = v_by, reviewed_at = NOW() WHERE id = k.id;
    INSERT INTO public.audit_logs (action, entity_type, entity_id, new_value, user_name)
    VALUES ('upi_payment_verified', 'scheme', sc.scheme_number, jsonb_build_object('amount', k.amount, 'utr', v_utr, 'claim', k.id), v_by);
    RETURN jsonb_build_object('receipt', v_rec->'installment'->>'receipt_number', 'balance', 0);
  END IF;
  IF k.advance_order_id IS NOT NULL THEN
    SELECT * INTO a FROM public.advance_orders WHERE id = k.advance_order_id FOR UPDATE;
    v_due := public.advance_outstanding(a);
  ELSE
    SELECT * INTO o FROM public.orders WHERE id = k.order_id FOR UPDATE;
    v_due := public.order_outstanding(o);
  END IF;
  IF k.amount > v_due THEN RAISE EXCEPTION 'The claim (₹%) is more than the balance still owed (₹%).', k.amount, v_due; END IF;
  v_utr := UPPER(BTRIM(COALESCE(NULLIF(p_utr, ''), k.utr)));
  IF v_utr <> '' AND (EXISTS (SELECT 1 FROM public.order_payments WHERE UPPER(BTRIM(utr)) = v_utr)
                      OR EXISTS (SELECT 1 FROM public.upi_payment_claims WHERE status = 'verified' AND UPPER(BTRIM(utr)) = v_utr)) THEN
    RAISE EXCEPTION 'Transaction % has already been credited.', v_utr;
  END IF;
  INSERT INTO public.order_payments (order_id, advance_order_id, amount, payment_method, utr, claim_id, verified_by)
  VALUES (k.order_id, k.advance_order_id, k.amount, 'upi', v_utr, k.id, v_by) RETURNING * INTO p;
  UPDATE public.upi_payment_claims SET status = 'verified', utr = v_utr, reviewed_by = v_by, reviewed_at = NOW(), payment_id = p.id WHERE id = k.id;

  IF k.advance_order_id IS NOT NULL THEN
    UPDATE public.advance_orders SET deposit_amount = deposit_amount + k.amount, updated_at = NOW() WHERE id = a.id;
    INSERT INTO public.advance_order_timeline (advance_order_id, event_type, label, remarks)
    VALUES (a.id, 'upi_payment_received', 'UPI Payment Confirmed (INR ' || k.amount || ')', v_utr);
    INSERT INTO public.audit_logs (action, entity_type, entity_id, new_value, user_name)
    VALUES ('upi_payment_verified', 'advance_order', a.deposit_id, jsonb_build_object('amount', k.amount, 'utr', v_utr, 'claim', k.id), v_by);
    PERFORM public.notify_customer(public.customer_id_for_phone(a.phone), 'payment_verified', 'Payment received',
      'Your UPI payment of ₹' || k.amount || ' for order ' || a.deposit_id || ' has been confirmed. Thank you!', 'advance', a.id::TEXT, 'claim_ok:' || k.id);
    RETURN jsonb_build_object('payment_id', p.id, 'balance', GREATEST(v_due - k.amount, 0));
  END IF;

  v_paid := ROUND(COALESCE(o.credit_paid_amount, 0) + k.amount, 2);
  UPDATE public.orders SET credit_paid_amount = v_paid,
         credit_status = CASE WHEN v_paid >= COALESCE(total, 0) THEN 'paid' ELSE credit_status END,
         credit_paid_at = CASE WHEN v_paid >= COALESCE(total, 0) THEN NOW() ELSE credit_paid_at END,
         credit_paid_method = CASE WHEN v_paid >= COALESCE(total, 0) THEN 'upi' ELSE credit_paid_method END,
         updated_at = NOW()
  WHERE id = o.id;
  INSERT INTO public.audit_logs (action, entity_type, entity_id, new_value, user_name)
  VALUES ('upi_payment_verified', 'order', o.invoice_no, jsonb_build_object('amount', k.amount, 'utr', v_utr, 'claim', k.id), v_by);
  PERFORM public.notify_customer(public.customer_id_for_phone(o.phone), 'payment_verified', 'Payment received',
    'Your UPI payment of ₹' || k.amount || ' for bill ' || o.invoice_no || ' has been confirmed. Thank you!', 'bill', o.id::TEXT, 'claim_ok:' || k.id);
  RETURN jsonb_build_object('payment_id', p.id, 'balance', GREATEST(COALESCE(o.total, 0) - v_paid, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_payment_claim(p_claim_id UUID, p_reason TEXT, p_by TEXT DEFAULT 'Admin')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k public.upi_payment_claims;
  v_doc TEXT;
  v_phone TEXT;
  v_ref_type TEXT;
  v_ref TEXT;
  v_word TEXT;
  v_cust UUID;
BEGIN
  IF BTRIM(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'Enter why the payment was not found.'; END IF;
  SELECT * INTO k FROM public.upi_payment_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR k.status <> 'pending' THEN RAISE EXCEPTION 'Only a claim awaiting verification can be rejected.'; END IF;
  IF k.scheme_id IS NOT NULL THEN
    SELECT scheme_number, phone, customer_id INTO v_doc, v_phone, v_cust FROM public.jewellery_schemes WHERE id = k.scheme_id;
    v_ref_type := 'scheme'; v_ref := k.scheme_id::TEXT; v_word := 'scheme';
  ELSIF k.advance_order_id IS NOT NULL THEN
    SELECT deposit_id, phone INTO v_doc, v_phone FROM public.advance_orders WHERE id = k.advance_order_id;
    v_ref_type := 'advance'; v_ref := k.advance_order_id::TEXT; v_word := 'order';
  ELSE
    SELECT invoice_no, phone INTO v_doc, v_phone FROM public.orders WHERE id = k.order_id;
    v_ref_type := 'bill'; v_ref := k.order_id::TEXT; v_word := 'bill';
  END IF;
  UPDATE public.upi_payment_claims SET status = 'rejected', review_reason = BTRIM(p_reason), reviewed_by = COALESCE(NULLIF(p_by, ''), 'Admin'), reviewed_at = NOW()
  WHERE id = k.id;
  INSERT INTO public.audit_logs (action, entity_type, entity_id, new_value, user_name, note)
  VALUES ('upi_payment_rejected', CASE WHEN k.scheme_id IS NOT NULL THEN 'scheme' WHEN k.advance_order_id IS NOT NULL THEN 'advance_order' ELSE 'order' END, v_doc, jsonb_build_object('amount', k.amount, 'utr', k.utr, 'claim', k.id), COALESCE(NULLIF(p_by, ''), 'Admin'), BTRIM(p_reason));
  PERFORM public.notify_customer(COALESCE(v_cust, public.customer_id_for_phone(v_phone)), 'payment_rejected', 'Payment could not be verified',
    'Your UPI payment of ₹' || k.amount || ' for ' || v_word || ' ' || v_doc || ' could not be found: ' || BTRIM(p_reason) || '. Please contact the shop.', v_ref_type, v_ref, 'claim_no:' || k.id);
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

-- Credit bills: the same stages against the bill's due date.
CREATE OR REPLACE FUNCTION public.generate_credit_reminders()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders;
  v_days INTEGER[];
  v_cid UUID;
  v_due NUMERIC;
  v_left INTEGER;
  v_stage INTEGER;
  v_count INTEGER := 0;
  v_before INTEGER;
BEGIN
  SELECT COALESCE(reminder_days, '{7,3,1,0,-1}') INTO v_days FROM public.store_settings WHERE id = 1;
  FOR o IN SELECT * FROM public.orders WHERE credit_status = 'outstanding' AND credit_due_date IS NOT NULL AND LOWER(COALESCE(status, '')) <> 'cancelled' LOOP
    v_due := public.order_outstanding(o);
    CONTINUE WHEN v_due <= 0;
    v_cid := public.customer_id_for_phone(o.phone);
    CONTINUE WHEN v_cid IS NULL;
    v_left := o.credit_due_date::DATE - CURRENT_DATE;
    v_stage := CASE WHEN v_left < 0 AND -1 = ANY(v_days) THEN -1 WHEN v_left = ANY(v_days) THEN v_left ELSE NULL END;
    CONTINUE WHEN v_stage IS NULL;
    SELECT COUNT(*) INTO v_before FROM public.customer_notifications WHERE dedupe_key = 'credit_rem:' || o.id || ':' || v_stage;
    PERFORM public.notify_customer(v_cid, CASE WHEN v_stage < 0 THEN 'credit_overdue' WHEN v_stage = 0 THEN 'credit_due_today' ELSE 'credit_due' END,
      CASE WHEN v_stage < 0 THEN 'Bill payment overdue' WHEN v_stage = 0 THEN 'Bill payment due today' ELSE 'Bill payment due in ' || v_stage || ' day' || CASE WHEN v_stage = 1 THEN '' ELSE 's' END END,
      'Dear ' || COALESCE(NULLIF(o.customer_name, ''), 'Customer') || ', ₹' || v_due || ' on your bill ' || COALESCE(o.invoice_no, '')
        || CASE WHEN v_stage < 0 THEN ' was due on ' ELSE ' is due on ' END || to_char(o.credit_due_date::DATE, 'DD Mon YYYY') || '. Thank you!',
      'bill', o.id::TEXT, 'credit_rem:' || o.id || ':' || v_stage);
    IF v_before = 0 THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Server only: picks the notifications to send on a channel and marks them queued, so two runs can never send one twice.
-- WhatsApp / SMS carry only due-date reminders, recent ones, to customers who have not switched them off.
-- Push carries everything, for devices that were switched on before the notification was made.
CREATE OR REPLACE FUNCTION public.claim_outbound_notifications(p_channel TEXT, p_limit INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kinds TEXT[] := ARRAY['scheme_due', 'scheme_due_today', 'scheme_overdue', 'credit_due', 'credit_due_today', 'credit_overdue'];
  v_on BOOLEAN;
  v_out JSONB;
BEGIN
  IF p_channel NOT IN ('whatsapp', 'sms', 'push') THEN RAISE EXCEPTION 'Unknown channel.'; END IF;
  SELECT CASE p_channel WHEN 'whatsapp' THEN whatsapp_reminders_enabled WHEN 'sms' THEN sms_reminders_enabled ELSE TRUE END INTO v_on FROM public.store_settings WHERE id = 1;
  IF NOT COALESCE(v_on, FALSE) THEN RETURN '[]'::JSONB; END IF;
  WITH picked AS (
    SELECT n.id FROM public.customer_notifications n JOIN public.customers c ON c.id = n.customer_id
    WHERE n.created_at > NOW() - INTERVAL '3 days'
      AND NOT EXISTS (SELECT 1 FROM public.notification_deliveries d WHERE d.notification_id = n.id AND d.channel = p_channel)
      AND CASE WHEN p_channel = 'push'
               THEN EXISTS (SELECT 1 FROM public.customer_push_subscriptions u WHERE u.customer_id = n.customer_id AND u.created_at <= n.created_at)
               ELSE n.kind = ANY(v_kinds) AND NOT c.reminders_opt_out AND LENGTH(public.phone_key(c.phone)) = 10 END
    ORDER BY n.created_at LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
    FOR UPDATE OF n SKIP LOCKED
  ), queued AS (
    INSERT INTO public.notification_deliveries (notification_id, channel, status)
    SELECT id, p_channel, 'queued' FROM picked ON CONFLICT (notification_id, channel) DO NOTHING
    RETURNING id, notification_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('delivery_id', q.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'customer_name', c.name,
           'phone', public.phone_key(c.phone),
           'targets', CASE WHEN p_channel = 'push' THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('endpoint', u.endpoint, 'p256dh', u.p256dh, 'auth', u.auth)), '[]'::JSONB)
                                                         FROM public.customer_push_subscriptions u WHERE u.customer_id = n.customer_id AND u.created_at <= n.created_at) END)), '[]'::JSONB)
  INTO v_out
  FROM queued q JOIN public.customer_notifications n ON n.id = q.notification_id JOIN public.customers c ON c.id = n.customer_id;
  RETURN v_out;
END;
$$;

-- Server only: result of a send, and later delivery reports from the provider. A report never moves a message backwards.
CREATE OR REPLACE FUNCTION public.record_delivery(p_id UUID, p_status TEXT, p_ref TEXT, p_error TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notification_deliveries SET status = p_status, provider_ref = COALESCE(p_ref, ''), error = LEFT(COALESCE(p_error, ''), 500), updated_at = NOW() WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.record_delivery_report(p_ref TEXT, p_status TEXT, p_error TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notification_deliveries SET status = p_status, error = LEFT(COALESCE(p_error, ''), 500), updated_at = NOW()
  WHERE provider_ref = p_ref AND p_ref <> '' AND status <> 'delivered' AND p_status IN ('sent', 'delivered', 'failed');
$$;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.customer_push_subscriptions WHERE endpoint = p_endpoint;
$$;

-- Tells the customer's open portal to reload straight away. Holds no customer data; failing here must never stop a bill being saved.
CREATE OR REPLACE FUNCTION public.customer_notifications_live()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_topic TEXT;
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RETURN NEW; END IF;
  SELECT live_topic INTO v_topic FROM public.customers WHERE id = NEW.customer_id;
  IF v_topic IS NOT NULL THEN
    EXECUTE 'SELECT realtime.send($1, $2, $3, FALSE)' USING '{}'::JSONB, 'refresh', 'portal:' || v_topic;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS customer_notifications_live ON public.customer_notifications;
CREATE TRIGGER customer_notifications_live AFTER INSERT ON public.customer_notifications
  FOR EACH ROW EXECUTE FUNCTION public.customer_notifications_live();

-- Daily at 09:00 IST (03:30 UTC), when pg_cron is enabled (Database -> Extensions -> pg_cron).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'scheme-reminders';
    PERFORM cron.schedule('scheme-reminders', '30 3 * * *', 'SELECT public.generate_scheme_reminders(); SELECT public.generate_credit_reminders()');
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
         - 'otp_minutes' - 'reminder_days' - 'payment_link_hours' - 'whatsapp_reminders_enabled' - 'sms_reminders_enabled'
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

-- Invoice links sent to customers carry the bill's random id, so nobody can walk through other people's bills by number.
CREATE OR REPLACE FUNCTION public.get_public_invoice_by_id(p_id UUID)
RETURNS SETOF public.orders LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.orders WHERE id = p_id LIMIT 1;
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
GRANT EXECUTE ON FUNCTION public.record_credit_payment(UUID, NUMERIC, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_payment_link(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_payment_claim(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_payment_claim(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_scheme_reminders() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_credit_reminders() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_verify_email_otp(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_password_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_magic_login(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_change_password(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_reset_password(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_confirm_email_change(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_confirm_phone_change(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_set_reminders(TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_push_subscribe(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_push_unsubscribe(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_advance_payment_link(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_scheme_payment_link(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_invoice_by_id(UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_create_otp(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_discard_otp(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_customer(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_customer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.otp_issue(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_password_hash(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_password_problem(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_password_store(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_id_for_login(TEXT) FROM PUBLIC, anon, authenticated;
-- Only a signed-in shop can set a customer's password, even before the lock-down.
REVOKE ALL ON FUNCTION public.shop_set_customer_password(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_set_customer_password(UUID, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.otp_check(TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.otp_discard(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_new_session(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_create_email_otp(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_create_change_otp(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_outbound_notifications(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_delivery(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_delivery_report(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_push_subscription(TEXT) FROM PUBLIC, anon, authenticated;

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
    GRANT EXECUTE ON FUNCTION public.otp_discard(TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.customer_create_email_otp(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.customer_create_change_otp(TEXT, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_outbound_notifications(TEXT, INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.record_delivery(UUID, TEXT, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.record_delivery_report(TEXT, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) TO service_role;
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
