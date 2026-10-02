// Fallback shop details, used only until the real ones are saved in Store Settings
// (store_settings in the database). Set the shop name, phone, address, logo etc. there.
export const BRAND_EN = 'Jewellery Store'
export const BRAND_TA = 'Jewellery Store'
export const BRAND_SHORT = 'Jewellery Store'
export const BRAND_SUBTITLE = 'Your Family Jewellery Store'
/** Prefix for generated barcodes and export file names. */
export const BRAND_MONOGRAM = 'JWL'
export const BRAND_LOGO = '/store-logo.svg'
/** Public site address for invoice links when VITE_SITE_URL is not set ('' = use the current site). */
export const BRAND_PRODUCTION_DOMAIN = ''

// Owner / Personal contact
export const BRAND_OWNER_NAME = ''
export const BRAND_OWNER_PHONE_DISPLAY = ''
export const BRAND_OWNER_PHONE_E164 = ''

// Official Shop contact (used for receipts, billing, and customer WhatsApp)
export const BRAND_PRIMARY_PHONE_DISPLAY = ''
export const BRAND_PRIMARY_PHONE_E164 = ''
export const BRAND_SECONDARY_PHONE_DISPLAY = ''
export const BRAND_SECONDARY_PHONE_E164 = ''
export const BRAND_THIRD_PHONE_DISPLAY = BRAND_PRIMARY_PHONE_DISPLAY
export const BRAND_THIRD_PHONE_E164 = BRAND_PRIMARY_PHONE_E164

export const BRAND_PHONE_DISPLAY = BRAND_PRIMARY_PHONE_DISPLAY
export const BRAND_PHONE_E164 = BRAND_PRIMARY_PHONE_E164

export const BRAND_WHATSAPP = BRAND_PRIMARY_PHONE_DISPLAY
export const WHATSAPP_NUM = BRAND_PRIMARY_PHONE_E164
export const BRAND_WHATSAPP_LINK = `https://wa.me/${BRAND_PRIMARY_PHONE_E164}`

export const BRAND_EMAIL = ''
export const BRAND_ADDRESS = ''
export const BRAND_INSTAGRAM = ''
export const BRAND_INSTAGRAM_URL = ''
export const BRAND_LOCATION_LINK = '#'
