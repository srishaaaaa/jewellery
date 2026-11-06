# Customer portal: setup

Do these in order. The app keeps working after every step until you choose to switch on step 6.

**Do not give customers the portal link until step 6 is done.** Before the lock-down, anyone with the app's public key can still read and change the database.

## 1. Update the database
In the Supabase SQL Editor (project `rpotmwupbxhgnekbzcns`), run in this order:
1. `supabase/migrations/jewellery_pos.sql`
2. `supabase/migrations/customer_portal.sql`

Do **not** run `security_lockdown.sql` yet.

## 2. Save the passcodes
Open the POS → Settings → **Login Passcodes** and save both the admin and the shared staff passcode. The server sign-in only accepts passcodes saved here, not the built-in `admin123` / `staff123`.

## 3. Deploy the two server functions
With the Supabase CLI, from this project folder:
```
npx supabase login
npx supabase link --project-ref rpotmwupbxhgnekbzcns
npx supabase functions deploy shop-session
npx supabase functions deploy customer-otp
```

## 4. Add the shop sign-in secrets
Supabase dashboard → Edge Functions → Secrets:
- `SHOP_EMAIL`: any address, for example `pos@nandijewellers.in`. It is only the shop's database login; no mail is sent to it.
- `SHOP_PASSWORD`: a long random password. Nobody needs to remember it.

## 5. Turn off public sign-ups and test
1. Supabase dashboard → Authentication → Sign In / Providers → switch **off** "Allow new users to sign up". This must be off: after the lock-down, the shop account is the only login that should exist.
2. Log out of the POS and log in again with your passcode. Confirm the login still works.
3. Check Authentication → Users shows the shop account.

## 6. Switch on the lock-down
Run `supabase/migrations/security_lockdown.sql` in the SQL Editor, then log in again and check Billing, Order History and Settings open normally.

If the POS stops working, run this to go back to open access, then tell your developer:
```sql
SELECT public.undo_security_lockdown();
```

After this, re-running `jewellery_pos.sql` or `customer_portal.sql` keeps the lock-down on. If `production_schema.sql` is ever re-run, run `security_lockdown.sql` again afterwards.

## 7. Scheme reminders
Database → Extensions → enable **pg_cron**, then run `customer_portal.sql` again. Reminders are then created every day at 9:00 AM IST.

## 8. Shop UPI
Settings → **Guests Paying by UPI** → enter the UPI ID and press **Save Shop Details**. Until this is saved, no QR is shown anywhere.

## 9. Customer OTP (when you have an SMS account)
Until this is done, customers see "OTP login is not switched on yet". Add these under Edge Functions → Secrets:

**MSG91**
- `SMS_PROVIDER` = `msg91`
- `MSG91_AUTH_KEY`
- `MSG91_TEMPLATE_ID`: a DLT-approved OTP template

**Twilio**
- `SMS_PROVIDER` = `twilio`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID`
- `OTP_SHOP_NAME` (optional)

Then log in at `/customer/login` with a registered customer's number to test it.

## Portal addresses
- Customer login: `/customer/login`
- Payment link: `/customer/pay/<token>`, sent from Outstanding Credits (blue QR icon) or UPI Payments
