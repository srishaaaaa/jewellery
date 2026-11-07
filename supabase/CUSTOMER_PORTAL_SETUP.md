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

## 3. Deploy the server functions
With the Supabase CLI, from this project folder:
```
npx supabase login
npx supabase link --project-ref rpotmwupbxhgnekbzcns
npx supabase functions deploy shop-session
npx supabase functions deploy customer-otp
npx supabase functions deploy send-reminders --no-verify-jwt
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```
`--no-verify-jwt` is needed on those two because the scheduler and Meta cannot send a Supabase key. Each checks its own secret instead.

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

After this step, invoice links with a bill number in them stop opening for customers; they see a message asking the shop for a new link. New WhatsApp messages carry a link that cannot be guessed. The shop can still open any bill by number while logged in.

If the POS stops working, run this to go back to open access, then tell your developer:
```sql
SELECT public.undo_security_lockdown();
```

After this, re-running `jewellery_pos.sql` or `customer_portal.sql` keeps the lock-down on. If `production_schema.sql` is ever re-run, run `security_lockdown.sql` again afterwards.

## 7. Reminders in the portal
Database → Extensions → enable **pg_cron**, then run `customer_portal.sql` again. Scheme and credit bill reminders are then created in the portal every day at 9:00 AM IST.

## 8. Shop UPI
Settings → **Guests Paying by UPI** → enter the UPI ID and press **Save Shop Details**. Until this is saved, no QR is shown anywhere.

## 9. Customer login
**Password:** works as soon as the lock-down is on, with no SMS or email account. In the POS, open **Customers** and press the key icon beside a customer to give them a starting password. They must replace it the first time they log in. Use the Generate button, so each customer gets a different one; anyone who knows a shared password and a customer's mobile number can log in as that customer. The same button resets a forgotten password.

**Forgot password** sends an SMS or email code, then lets the customer choose a new password. It needs one of the accounts below; without them, the shop resets it with the key icon.

**Email login link:** the Email tab sends a one-time link that works for 15 minutes, with a 6-digit code as a fallback. It needs the Resend account below. If the site moves to another address, add a secret `SITE_URL` with the new address.

**Codes:** customers can also log in with a code by SMS or by email. Each option stays off, with a clear message, until its secrets are added under Edge Functions → Secrets. You can add either one or both.

**SMS: MSG91**
- `SMS_PROVIDER` = `msg91`
- `MSG91_AUTH_KEY`
- `MSG91_TEMPLATE_ID`: a DLT-approved OTP template

**SMS: Twilio**
- `SMS_PROVIDER` = `twilio`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID`

**Email: Resend** (resend.com)
- `RESEND_API_KEY`
- `EMAIL_FROM`, for example `Nandi Jewellers <no-reply@yourdomain.in>`. The domain must be verified in Resend.

**Both**
- `OTP_SHOP_NAME`: the shop's name in messages (optional)

Then log in at `/customer/login` with a registered customer's number or email to test it.

Email login uses the email saved on the customer. If two customers with different numbers share one email, that email cannot log in and they are told to use their mobile.

## 10. Automatic WhatsApp reminders
They are switched on in Settings → **Automatic Customer Reminders**, but nothing can be sent until you connect a WhatsApp Business account. The ordinary WhatsApp buttons in the POS keep working either way.

1. In Meta Business Manager, set up the WhatsApp Cloud API for the shop's business number.
2. Create a message template, category **Utility**, language English, named for example `payment_reminder`, with this body, and wait for Meta to approve it:
   ```
   Reminder from Nandi Jewellers: {{1}}. {{2}}
   ```
3. Add these secrets:
   - `WHATSAPP_TOKEN`: a permanent System User token
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_TEMPLATE_NAME`: `payment_reminder`
   - `WHATSAPP_TEMPLATE_LANG`: the language code of the template, for example `en`
   - `WHATSAPP_API_VERSION` (optional): the current Graph API version, if Meta has retired the default
4. For delivery reports, add `WHATSAPP_VERIFY_TOKEN` (any long random text) and `WHATSAPP_APP_SECRET`. Then in the Meta app's WhatsApp → Configuration, set the callback URL to `https://rpotmwupbxhgnekbzcns.supabase.co/functions/v1/whatsapp-webhook`, enter the same verify token, and subscribe to **messages**.

Without step 4, messages show as handed to the provider, never as delivered.

Meta requires customers to have agreed to WhatsApp messages from the shop. Get that agreement at the counter. Customers can switch reminders off in their portal profile.

## 11. Automatic SMS reminders (optional)
Off by default; switch on in Settings. Each message is charged by your provider.
- **Twilio:** nothing more to add.
- **MSG91:** add `MSG91_REMINDER_TEMPLATE_ID`: a DLT-approved template with one variable (`var1`, up to 30 characters), for example `Reminder from Nandi Jewellers: {#var#}. Please contact the shop for details.`

## 12. Phone alerts when the portal is closed
1. Make the keys, once:
   ```
   npx web-push generate-vapid-keys
   ```
2. Add these secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` and the shop's email).

Customers then switch on **Alerts on this device** in their portal profile. On iPhone they must first add the site to their Home Screen (iOS 16.4 or later).

## 13. Schedule the sending
Needed for steps 10 to 12.
1. Add a secret `REMINDER_CRON_SECRET`: long random text.
2. Database → Extensions → enable **pg_net**.
3. In the SQL Editor, with your secret in place of `YOUR_SECRET`:
   ```sql
   SELECT cron.schedule('send-reminders', '*/5 * * * *', $$
     SELECT net.http_post(
       url := 'https://rpotmwupbxhgnekbzcns.supabase.co/functions/v1/send-reminders',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR_SECRET'),
       body := '{}'::jsonb)
   $$);
   ```

It runs every 5 minutes. Alerts go out any time; WhatsApp and SMS wait for 9 AM to 8 PM India time. Settings shows each channel as Connected or Not connected, with counts and the last failures.

## Instant updates in the portal
Nothing to set up. An open portal reloads as soon as the shop does something for that customer, as long as Realtime's public access is on (Project Settings → Realtime, the default). If it is off, the portal still checks every 30 seconds.

## Portal addresses
- Customer login: `/customer/login`
- Payment link: `/customer/pay/<token>`, sent from Outstanding Credits (blue QR icon) or UPI Payments, or opened by the customer with Pay Now / Pay Balance
- Invoice link: `/invoice/<bill id>`, in the shop's WhatsApp messages
