-- ============================================================================
-- SECURITY LOCK-DOWN (run LAST, and only after the setup steps in
-- supabase/CUSTOMER_PORTAL_SETUP.md: the shop-session Edge Function deployed,
-- its secrets set, and "Allow new users to sign up" switched OFF).
--
-- After this:
--   * Nothing in the database can be read or changed with the app's public key
--     (anon), except the public pages: admin sign-in check, public invoice link,
--     shop profile, coupon page, the customer portal (session-token functions)
--     and UPI payment links.
--   * The POS works through the shop's Supabase login (role "shop" in its
--     app_metadata), which the shop-session Edge Function signs in after the
--     admin / staff passcode is checked. Passcode screens stay the same.
--   * Customers only ever see their own records (the portal functions check
--     their session token).
--
-- Safe to run more than once. jewellery_pos.sql and customer_portal.sql re-apply
-- it automatically at the end once it has been switched on.
-- To undo (back to open access): SELECT public.undo_security_lockdown();
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.security_flags (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at TIMESTAMPTZ
);
INSERT INTO public.security_flags (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- The shop's Supabase account carries app_metadata.role = 'shop' (only the server can set app_metadata).
CREATE OR REPLACE FUNCTION public.is_shop_session()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'shop';
$$;

CREATE OR REPLACE FUNCTION public.apply_security_lockdown()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t TEXT;
  p TEXT;
  f TEXT;
  v_private TEXT[] := ARRAY['customer_otps', 'customer_sessions', 'customer_passwords', 'customer_push_subscriptions', 'pos_staff_logins', 'security_flags'];
  v_server_only TEXT[] := ARRAY['customer_create_otp', 'customer_discard_otp', 'portal_customer', 'notify_customer', 'pos_pass_hash',
                                'otp_issue', 'otp_check', 'otp_discard', 'portal_new_session', 'customer_password_hash', 'customer_password_problem', 'customer_password_store', 'customer_id_for_login', 'customer_create_email_otp', 'customer_create_change_otp',
                                'claim_outbound_notifications', 'record_delivery', 'record_delivery_report', 'delete_push_subscription',
                                'apply_security_lockdown', 'undo_security_lockdown'];
  v_public TEXT[] := ARRAY['pos_login', 'get_public_invoice_by_id', 'get_public_shop_profile', 'get_public_coupon',
                           'customer_password_login', 'customer_magic_login', 'customer_change_password', 'customer_reset_password', 'customer_verify_email_otp', 'customer_confirm_email_change', 'customer_confirm_phone_change', 'customer_set_reminders',
                           'customer_push_subscribe', 'customer_push_unsubscribe', 'customer_advance_payment_link', 'customer_scheme_payment_link',
                           'customer_verify_otp', 'customer_logout', 'request_customer_registration', 'customer_portal_data',
                           'customer_scheme_detail', 'customer_bill', 'customer_notifications_list', 'customer_mark_read',
                           'customer_update_profile', 'customer_payment_link', 'get_payment_link', 'submit_payment_claim',
                           'phone_key', 'is_shop_session'];
BEGIN
  -- Tables: only the shop login; the private ones nobody (functions only).
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, t);
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    IF t = ANY(v_private) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
      EXECUTE format('CREATE POLICY shop_session ON public.%I FOR ALL TO authenticated USING (public.is_shop_session()) WITH CHECK (public.is_shop_session())', t);
    END IF;
  END LOOP;

  -- Views and sequences.
  FOR t IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
  FOR t IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO authenticated', t);
  END LOOP;

  -- Functions: shop login gets everything except server-only ones; anon only the public list.
  FOR f IN
    SELECT p2.oid::regprocedure::TEXT FROM pg_proc p2 JOIN pg_namespace n ON n.oid = p2.pronamespace
    WHERE n.nspname = 'public' AND p2.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p2.oid AND d.deptype = 'e')
  LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO service_role';
    END IF;
    IF split_part(f, '(', 1) IN (SELECT 'public.' || x FROM unnest(v_server_only) x) OR split_part(f, '(', 1) = ANY(v_server_only) THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || f || ' FROM authenticated';
    ELSE
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
    END IF;
    IF regexp_replace(split_part(f, '(', 1), '^public\.', '') = ANY(v_public) THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO anon';
    END IF;
  END LOOP;

  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

  -- Storage: files stay publicly readable by link, but only the shop login can upload / change / delete
  -- (payment screenshots: anyone can upload one, only the shop can read them).
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS pos_files_insert ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS pos_files_update ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS pos_files_delete ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS certificate_files_insert ON storage.objects';
    EXECUTE $p$CREATE POLICY pos_files_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id IN ('product-images', 'invoices', 'branding', 'certificates') AND public.is_shop_session())$p$;
    EXECUTE $p$CREATE POLICY pos_files_update ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id IN ('product-images', 'invoices', 'branding', 'certificates') AND public.is_shop_session())$p$;
    EXECUTE $p$CREATE POLICY pos_files_delete ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id IN ('product-images', 'invoices', 'branding', 'certificates') AND public.is_shop_session())$p$;
    EXECUTE 'DROP POLICY IF EXISTS payment_proofs_read ON storage.objects';
    EXECUTE $p$CREATE POLICY payment_proofs_read ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'payment-proofs' AND public.is_shop_session())$p$;
  END IF;

  UPDATE public.security_flags SET locked = TRUE, locked_at = COALESCE(locked_at, NOW()) WHERE id = 1;
END;
$$;

-- Back to the open setup (every table usable with the public key), e.g. if the shop sign-in breaks.
CREATE OR REPLACE FUNCTION public.undo_security_lockdown()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t TEXT;
  f TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
           AND tablename NOT IN ('customer_otps', 'customer_sessions', 'pos_staff_logins', 'security_flags') LOOP
    EXECUTE format('DROP POLICY IF EXISTS shop_session ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_portal_manage', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE)', t || '_portal_manage', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
  END LOOP;
  FOR t IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
  END LOOP;
  FOR t IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO anon, authenticated', t);
  END LOOP;
  FOR f IN
    SELECT p2.oid::regprocedure::TEXT FROM pg_proc p2 JOIN pg_namespace n ON n.oid = p2.pronamespace
    WHERE n.nspname = 'public' AND p2.prokind = 'f'
      AND p2.proname NOT IN ('customer_create_otp', 'customer_discard_otp', 'portal_customer', 'notify_customer', 'pos_pass_hash',
                             'apply_security_lockdown', 'undo_security_lockdown')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p2.oid AND d.deptype = 'e')
  LOOP
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO anon, authenticated';
  END LOOP;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS pos_files_insert ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS pos_files_update ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS pos_files_delete ON storage.objects';
    EXECUTE $p$CREATE POLICY pos_files_insert ON storage.objects FOR INSERT TO anon, authenticated
      WITH CHECK (bucket_id IN ('product-images', 'invoices', 'branding', 'certificates'))$p$;
    EXECUTE $p$CREATE POLICY pos_files_update ON storage.objects FOR UPDATE TO anon, authenticated
      USING (bucket_id IN ('product-images', 'invoices', 'branding', 'certificates'))$p$;
    EXECUTE $p$CREATE POLICY pos_files_delete ON storage.objects FOR DELETE TO anon, authenticated
      USING (bucket_id IN ('product-images', 'invoices', 'branding', 'certificates'))$p$;
  END IF;
  UPDATE public.security_flags SET locked = FALSE, locked_at = NULL WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_security_lockdown() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.undo_security_lockdown() FROM PUBLIC, anon, authenticated;

SELECT public.apply_security_lockdown();
NOTIFY pgrst, 'reload schema';
