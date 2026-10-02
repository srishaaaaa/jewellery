# MAHALASHMI STORES - COMPREHENSIVE TESTING CHECKLIST

## ✅ DEPLOYMENT INFO
- **Master File**: `mahalashmi_final_consolidated.sql`
- **Size**: 4,871 lines
- **Status**: Single file - all-in-one deployment
- **Date Generated**: 2026-09-26

---

## 📱 DEVICE TESTING (Test on ALL devices)

### Desktop (Desktop Browser)
- [ ] Chrome / Chromium
- [ ] Firefox
- [ ] Safari (if Mac)
- [ ] Edge

### Tablet
- [ ] iPad / Android Tablet
- [ ] Landscape orientation
- [ ] Portrait orientation

### Mobile Phones
- [ ] iPhone (all sizes)
- [ ] Android (various sizes)
- [ ] Samsung
- [ ] OnePlus
- [ ] Poco (as mentioned)

---

## 🏪 STORE CONFIGURATION

### Store Details
- [ ] Store name displays as "New Mahalashmi Stores" (with "New" in smaller size)
- [ ] Owner name: M. Senthamil
- [ ] Primary phone: 9865975714
- [ ] Secondary phone: 8668151051
- [ ] Email: senthamil75714@gmail.com
- [ ] Address correct on invoices
- [ ] Instagram: @mahalashmi_stores
- [ ] Brand color is Green (#2E7D32)

---

## 🛍️ PRODUCT MANAGEMENT

### Product Creation
- [ ] Can create products with name
- [ ] Unit dropdown shows all units (gm, kg, ml, L, pcs, box, packet, bottle, bag)
- [ ] Can set quantity + unit combo (e.g., "200 gm")
- [ ] Can add multiple prices for same product
  - [ ] 20 gm - 12/-
  - [ ] 50 gm - 45/-
  - [ ] 100 gm - 85/-
- [ ] Purchase price field works
- [ ] Selling price field works
- [ ] Can set expiry date (DD-MM-YYYY format)
- [ ] Can set manufacturing date (DD-MM-YYYY format)
- [ ] Barcode/SKU field visible and functional
- [ ] Category selection works
- [ ] Stock quantity displays correctly
- [ ] Low stock alert threshold works (default 5)
- [ ] Product icons render properly
- [ ] Product images load correctly

---

## 👥 CUSTOMERS

### Customer Information
- [ ] Birthday field appears (DD-MM-YYYY format)
- [ ] Anniversary field appears (DD-MM-YYYY format)
- [ ] Date pickers work for birthday
- [ ] Date pickers work for anniversary
- [ ] Calendar opens when clicking date icon
- [ ] Can manually enter dates
- [ ] Date format validation works
- [ ] All customer details save correctly

---

## 💰 POS BILLING

### Billing Flow
- [ ] Can search products by name/barcode
- [ ] Products add to cart
- [ ] Quantity adjustable
- [ ] Price shows correctly for different sizes
- [ ] Remove item from cart works
- [ ] Clear cart works
- [ ] Subtotal calculates correctly
- [ ] Discount field works
- [ ] Payment method selection works (Cash/Card/UPI)
- [ ] Invoice number generates correctly
- [ ] Invoice prints properly
- [ ] Invoice PDF saves
- [ ] Customer details save
- [ ] Stock decreases after billing

### Invoice
- [ ] Invoice displays all items
- [ ] Invoice shows customer name
- [ ] Invoice shows date (DD-MM-YYYY)
- [ ] Invoice shows store name & address
- [ ] Invoice shows phone numbers
- [ ] Invoice shows total amount
- [ ] "Powered by Cenexa Systems © 2026" footer present
- [ ] Footer text NEVER changes
- [ ] Invoice format clean and professional
- [ ] QR code/barcode visible if present

---

## 📊 INVENTORY

### Stock Management
- [ ] All 15+ categories display
- [ ] Sample products visible (40 products)
- [ ] Stock levels show correctly
- [ ] Low stock alerts trigger at threshold
- [ ] Can view damage stock history
- [ ] Price history displays
- [ ] Expiry dates visible
- [ ] FEFO sorting visible
- [ ] Unit conversions work (gm ↔ kg, ml ↔ L)

---

## 📈 DASHBOARD

### Analytics
- [ ] Dashboard loads without errors
- [ ] All charts render
- [ ] Sales data displays
- [ ] Inventory metrics show
- [ ] Low stock alerts display
- [ ] Total inventory value calculates
- [ ] Currency shows RM (not ₹)
- [ ] Birthday/Anniversary reminders appear
- [ ] Customer count accurate
- [ ] Revenue graphs display

---

## ⚙️ SETTINGS

### Configuration
- [ ] Store settings page loads
- [ ] All store details editable
- [ ] Changes save correctly
- [ ] Store name updates everywhere
- [ ] Color settings apply
- [ ] Contact details update
- [ ] Instagram handle displays with @

---

## 🎨 UI/UX

### General
- [ ] No console errors (F12 → Console)
- [ ] No ESLint warnings in terminal
- [ ] All icons render properly
- [ ] Colors match brand (Green #2E7D32)
- [ ] Fonts render correctly
- [ ] Spacing/padding consistent
- [ ] Buttons clickable and responsive
- [ ] Forms validate correctly
- [ ] Error messages clear
- [ ] Success messages display

### Responsive Design
- [ ] Works at 320px width (mobile)
- [ ] Works at 768px width (tablet)
- [ ] Works at 1024px width (desktop)
- [ ] Works at 1920px width (wide desktop)
- [ ] No horizontal scroll on mobile
- [ ] Touch targets large enough (44px minimum)
- [ ] Text readable on all screens
- [ ] Images scale properly

---

## 📱 MOBILE-SPECIFIC

### Android/Poco Phones
- [ ] App loads quickly
- [ ] No scrolling lag
- [ ] Date picker works on Android
- [ ] Keyboard doesn't break layout
- [ ] All buttons accessible
- [ ] Billing flow smooth
- [ ] Invoice prints from mobile
- [ ] No memory leaks

### iOS/iPhone
- [ ] App loads quickly
- [ ] Date picker uses iOS date selector
- [ ] Keyboard handling correct
- [ ] Safe area respected (notch)
- [ ] All gestures work

---

## 🔧 DATABASE

### Data Integrity
- [ ] No duplicate products
- [ ] No duplicate functions (especially get_next_invoice_no)
- [ ] All foreign keys intact
- [ ] All indexes present
- [ ] Sequences incrementing correctly
- [ ] Store settings has single record
- [ ] Categories load properly
- [ ] Unit types all present

### Performance
- [ ] Queries respond quickly
- [ ] No N+1 query problems
- [ ] Product search fast
- [ ] Invoices generate quickly
- [ ] Reports load in <2 seconds

---

## ✏️ FORMS & VALIDATION

### Date Inputs
- [ ] DD/MM/YYYY format enforced
- [ ] Invalid dates rejected
- [ ] Calendar picker opens
- [ ] Can type manually
- [ ] Format validation works

### All Forms
- [ ] Required fields marked
- [ ] Validation errors clear
- [ ] Can't submit with errors
- [ ] Success feedback given
- [ ] Form reset works

---

## 🚨 ERROR HANDLING

- [ ] Error messages are helpful
- [ ] No crash on edge cases
- [ ] Network errors handled gracefully
- [ ] Empty states show properly
- [ ] Warnings don't break functionality

---

## 🎯 SMOKE TEST SEQUENCE

1. **Open app** → Dashboard loads
2. **Create product** → Appears in inventory
3. **Billing** → Add product → Calculate total → Pay → Invoice
4. **Customer** → Add birthday → Check displays
5. **Settings** → Verify store name

**Expected result**: Everything works smoothly with NO errors

---

## 📋 FINAL APPROVAL

- [ ] All sections tested
- [ ] No critical errors found
- [ ] All devices pass
- [ ] Database clean
- [ ] UI responsive
- [ ] Store details correct
- [ ] Footer unchanged
- [ ] Ready for production

