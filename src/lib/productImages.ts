import { resolveProductImage } from './productImageResolver'
export { resolveProductImage }

/**
 * productImages.ts — Single source of truth for product image resolution
 *
 * Priority order:
 *   1. PRODUCT_OVERRIDES  — exact / substring name match (highest fidelity)
 *   2. KEYWORD_MAP        — keyword substring match covering Tamil & English names
 *   3. CATEGORY_MAP       — category-level fallback
 *   4. PLACEHOLDER        — premium neutral herbal image (never blank)
 *
 * How to add a real product image later:
 *   Add an entry to PRODUCT_OVERRIDES with the exact product name (lowercase).
 *   Example:  'manjal podi': 'https://your-storage.com/manjal-podi.jpg'
 *
 * How to add new keywords:
 *   Add a { kw: [...], base: 'photo-id' } entry to KEYWORD_MAP.
 */

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Builds a sized Unsplash URL. Used in KEYWORD_MAP / CATEGORY_MAP fallbacks.
const U = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=400&q=80`

/** Returns true only for admin-uploaded images stored in Supabase Storage.
 *  These deserve the highest trust — the admin explicitly chose this image. */
const isStorageImage = (url: string | null | undefined): url is string =>
  !!url && url.includes('/storage/v1/object/') && url.startsWith('https://')

/** Returns true for local static assets served from the public folder. */
const isLocalAsset = (url: string | null | undefined): url is string =>
  !!url && url.startsWith('/assets/')

const preferWebpAsset = (url: string) => (url.match(/\.png$/i) ? url.replace(/\.png$/i, '.webp') : url)

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT_OVERRIDES — Exact product name → known image URL
// Add entries here when you have real product photos.
// Keys are lowercase; substring matching is used (partial name works).
// ─────────────────────────────────────────────────────────────────────────────
export const PRODUCT_OVERRIDES: Record<string, string> = {
  // ── Pooja Items ───────────────────────────────────────────────────────────
  'kungumam':          '/assets/images/Kungumam.png',
  'vibhoothi':         '/assets/images/Thiru Neer.png',
  'vibhuti':           '/assets/images/Thiru Neer.png',
  'vibuthi':           '/assets/images/Thiru Neer.png',
  'vibhoodi':          '/assets/images/Thiru Neer.png',
  'thiru neeru':       '/assets/images/Thiru Neer.png',
  'karpooram':         '/assets/images/Karpooram.png',
  'agarbatti':         '/assets/images/Agarbatti.png',
  'sandhanam':         '/assets/images/Sandhanam.png',
  'poo varisai':       '/assets/images/Poo varisai.png',
  'panchagavyam':      '/assets/images/Panchagavyam.png',
  'navagraha bit':     '/assets/images/Navagraha Bit.png',
  'kuthu vilakku':     '/assets/images/kutthu vilakku.png',
  'swami padam':       '/assets/images/swami padam.png',
  'thamarai':          '/assets/images/thamarai.png',
  'deepam thiri':      '/assets/images/Deepam Thiri.png',
  'kolamavu':          '/assets/images/kolamaavu.png',
  // ── Herbal Powders ────────────────────────────────────────────────────────
  'manjal podi':       '/assets/images/Manjal Podi.png',
  'thulasi podi':      '/assets/images/Thulasi podi.png',
  'veppalai podi':     '/assets/images/Veppalai Podi.png',
  'vendhayam podi':    '/assets/images/Vendhayam Podi.png',
  'omam podi':         '/assets/images/Omam Podi.png',
  'seeragam podi':     '/assets/images/Seeragam Podi.png',
  'milagu podi':       '/assets/images/Milagu Podi.png',
  'ashwagandha podi':  '/assets/images/Ashwagandha Podi.png',
  'amla podi':         '/assets/images/Amala Podi.png',
  'triphala podi':     '/assets/images/Triphala Podi.png',
  'brahmi podi':       '/assets/images/Brahmi Podi.png',
  'murungai podi':     '/assets/images/Murungai Podi.png',
  'sathavari podi':    '/assets/images/Sathavari Podi.png',
  'kandankathiri podi':'/assets/images/Kandankathari Podi.png',
  'nithyakalyani podi':'/assets/images/Nithyakalyani Podi.png',
  // ── Herbal Oils ───────────────────────────────────────────────────────────
  'veppa ennai':       '/assets/images/Veppa Ennai.png',
  'nalla ennai':       '/assets/images/Nalla Ennai.png',
  'vilakkennai':       '/assets/images/Vilakkennai.png',
  'thengai ennai':     '/assets/images/Thengai Ennai.png',
  'omam ennai':        '/assets/images/Omam ennai.png',
  'brahmi ennai':      '/assets/images/Brahmi Ennai.png',
  'milagu ennai':      '/assets/images/Milagu Ennai.png',
  'pungam ennai':      '/assets/images/Pungam Ennai.png',
  // ── Spices & Condiments ───────────────────────────────────────────────────
  'kalkandu':          '/assets/images/Kalkandu.png',
  'elakkai':           '/assets/images/Elakkai.png',
  'pattai':            '/assets/images/Pattai.png',
  'kothamalli':        '/assets/images/Kothamalli.png',
  'ellu':              '/assets/images/Ellu.png',
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD_MAP — 70+ Tamil & English product keyword groups
// Each group covers all common transliterations and aliases.
// ─────────────────────────────────────────────────────────────────────────────
type KwEntry = { kw: string[]; img: string }

export const KEYWORD_MAP: KwEntry[] = [

  // ── Pooja / Ritual items ────────────────────────────────────────────────
  {
    kw: ['kungumam', 'kumkumam', 'kumkum', 'kunkuma', 'kunkumam', 'vermilion'],
    img: U('1568214379698-8aeb8c6c6ac8'),   // saffron / red powder
  },
  {
    kw: ['vibhoothi', 'vibhuti', 'vibuthi', 'vibhoodi', 'thiruneer', 'thiru neeru',
         'holy ash', 'sacred ash', 'bhasma'],
    img: U('1591189863430-ab87e120f312'),   // white powder
  },
  {
    kw: ['karpooram', 'camphor', 'kapoor'],
    img: U('1584308666744-24d5c474f2ae'),   // camphor cubes
  },
  {
    kw: ['sandhanam', 'sandalwood', 'sandal paste', 'chandan'],
    img: U('1611080626919-7cf5a9dbab12'),   // sandalwood sticks
  },
  {
    kw: ['agarbatti', 'agarbathy', 'incense', 'sambrani', 'dhoop', 'oodhupathi',
         'odupathi', 'sambraani'],
    img: U('1603204077167-2fa0397f5264'),   // incense sticks
  },
  {
    kw: ['kuthu vilakku', 'deepam', 'vilakku', 'diya', 'oil lamp', 'thiri',
         'nandavillakku', 'aakasavilakku'],
    img: U('1567335743949-70f2b6b6e36d'),   // traditional diya lamp
  },
  {
    kw: ['thamarai', 'lotus'],
    img: U('1559181567-c3190ca9d713'),
  },
  {
    kw: ['arugu', 'arugampul', 'arugam pul', 'bermuda grass', 'dharba', 'kusha'],
    img: U('1490750967868-88df5691cc6b'),   // green grass / flowers
  },
  {
    kw: ['poo varisai', 'flower tray', 'pooja flowers'],
    img: U('1490750967868-88df5691cc6b'),
  },
  {
    kw: ['navagraha', 'swami padam', 'pooja set', 'pooja kit', 'pooja saaman',
         'saamagri', 'samangal', 'samangalai'],
    img: U('1567335743949-70f2b6b6e36d'),
  },

  // ── Herbal Powders ──────────────────────────────────────────────────────
  {
    kw: ['turmeric', 'manjal', 'haldi'],
    img: U('1615485291234-9d694218aeb5'),
  },
  {
    kw: ['neem', 'veppalai', 'veppu', 'vembu', 'nimba'],
    img: U('1564890369478-c89ca6d9cde9'),
  },
  {
    kw: ['moringa', 'murungai', 'drumstick leaf'],
    img: U('1620706857370-e1b9770e8bb1'),
  },
  {
    kw: ['brahmi', 'bacopa', 'brahmi podi'],
    img: U('1587411768638-ec71f8e33b78'),   // basil-like herb
  },
  {
    kw: ['ashwagandha', 'amukkira', 'withania', 'aswagandha'],
    img: U('1615485290382-441e4d049cb5'),   // herbal powder
  },
  {
    kw: ['sathavari', 'shatavari', 'asparagus racemosus'],
    img: U('1615485290382-441e4d049cb5'),
  },
  {
    kw: ['amla', 'nellikkai', 'nellikai', 'gooseberry', 'phyllanthus', 'amalaki'],
    img: U('1612871689552-be7ef6f50d0e'),
  },
  {
    kw: ['triphala', 'thirikadugam', 'trikatu', 'tridosha'],
    img: U('1615485290382-441e4d049cb5'),
  },
  {
    kw: ['nilavembu', 'nila vembu', 'andrographis', 'creat'],
    img: U('1587411768638-ec71f8e33b78'),
  },
  {
    kw: ['koraikizhangu', 'musta', 'cyperus'],
    img: U('1615485290382-441e4d049cb5'),
  },
  {
    kw: ['seenthil', 'giloy', 'tinospora', 'guduchi'],
    img: U('1587411768638-ec71f8e33b78'),
  },
  {
    kw: ['sukku', 'dry ginger', 'chukku', 'sonth'],
    img: U('1588543385566-60f2039da2e2'),
  },
  {
    kw: ['keezhanelli', 'kirganelli', 'bhumyamalaki'],
    img: U('1587411768638-ec71f8e33b78'),
  },
  {
    kw: ['manathakkali', 'black nightshade', 'makoi'],
    img: U('1587411768638-ec71f8e33b78'),
  },

  // ── Herbal Oils ─────────────────────────────────────────────────────────
  {
    kw: ['neem oil', 'veppennai', 'vep ennai', 'veppu ennai'],
    img: U('1608571423902-eed4a5ad8108'),   // oil bottle
  },
  {
    kw: ['castor oil', 'amanakku', 'vilakku ennai', 'castor'],
    img: U('1608571423902-eed4a5ad8108'),
  },
  {
    kw: ['coconut oil', 'thengai ennai', 'nalikera taila', 'copra oil'],
    img: U('1526947425960-945c6e72858f'),   // coconut
  },
  {
    kw: ['sesame oil', 'gingelly', 'ellu ennai', 'til oil', 'nallennai'],
    img: U('1595591996854-3b82ac8b6f65'),   // sesame seeds
  },
  {
    kw: ['amla oil', 'nellikkai ennai', 'amalaki oil'],
    img: U('1612871689552-be7ef6f50d0e'),
  },
  {
    kw: ['oil', 'ennai', 'taila', 'tailam'],
    img: U('1608571423902-eed4a5ad8108'),
  },

  // ── Spices & Condiments ─────────────────────────────────────────────────
  {
    kw: ['pepper', 'milagu', 'kali mirch', 'peppercorn'],
    img: U('1599909533731-f5f6c1fbd5ff'),
  },
  {
    kw: ['cardamom', 'elakkai', 'elaichi', 'green cardamom'],
    img: U('1514191893769-d44de1f4ac22'),
  },
  {
    kw: ['cinnamon', 'pattai', 'dalchini', 'lavang pattai'],
    img: U('1502741338009-cac2772e18bc'),
  },
  {
    kw: ['clove', 'kirambu', 'lavangam', 'laung'],
    img: U('1600628421060-9a851ea69c5c'),
  },
  {
    kw: ['cumin', 'jeeragam', 'seeragam', 'jeera', 'zeera'],
    img: U('1596040033229-a9821ebd058d'),
  },
  {
    kw: ['fennel', 'sombu', 'saunf', 'anise'],
    img: U('1596040033229-a9821ebd058d'),
  },
  {
    kw: ['fenugreek', 'vendhayam', 'methi', 'methu'],
    img: U('1532944138793-3a7bab2b5c1c'),
  },
  {
    kw: ['omam', 'ajwain', 'carom', 'thymol seeds', 'ajwan'],
    img: U('1532944138793-3a7bab2b5c1c'),
  },
  {
    kw: ['vasambu', 'acorus', 'sweet flag', 'calamus'],
    img: U('1615485290382-441e4d049cb5'),
  },
  {
    kw: ['kalonji', 'nigella', 'karunjeeragam', 'black cumin'],
    img: U('1595591996854-3b82ac8b6f65'),
  },
  {
    kw: ['marathi mokku', 'stone flower', 'kalpasi', 'dagad phool'],
    img: U('1532944138793-3a7bab2b5c1c'),
  },
  {
    kw: ['mace', 'jathipathri', 'javitri'],
    img: U('1532944138793-3a7bab2b5c1c'),
  },
  {
    kw: ['nutmeg', 'jathikkai', 'jaiphal'],
    img: U('1532944138793-3a7bab2b5c1c'),
  },
  {
    kw: ['star anise', 'brihathelam', 'anashphal'],
    img: U('1596040033229-a9821ebd058d'),
  },
  {
    kw: ['bay leaf', 'brinji elai', 'tejpatta'],
    img: U('1587411768638-ec71f8e33b78'),
  },

  // ── Grains & Pulses ─────────────────────────────────────────────────────
  {
    kw: ['rice', 'pacharisi', 'puzhungal arisi', 'boiled rice', 'samba', 'basmati'],
    img: U('1536304929831-ee1ca9d44906'),
  },
  {
    kw: ['ulundhu', 'urad', 'black gram', 'black lentil', 'washed urad'],
    img: U('1512621776951-a57141f2eefd'),
  },
  {
    kw: ['toor', 'thuvaram', 'arhar', 'pigeon pea'],
    img: U('1512621776951-a57141f2eefd'),
  },
  {
    kw: ['moong', 'pasi paruppu', 'mung', 'green gram'],
    img: U('1512621776951-a57141f2eefd'),
  },
  {
    kw: ['kadalai', 'chana', 'chickpea', 'bengal gram', 'chick pea'],
    img: U('1512621776951-a57141f2eefd'),
  },
  {
    kw: ['paruppu', 'dal', 'lentil'],
    img: U('1512621776951-a57141f2eefd'),
  },
  {
    kw: ['kollu', 'horse gram', 'kulthi'],
    img: U('1512621776951-a57141f2eefd'),
  },
  {
    kw: ['kaaramani', 'cowpea', 'lobiya', 'yard long bean'],
    img: U('1512621776951-a57141f2eefd'),
  },
  {
    kw: ['sesame', 'ellu', 'til'],
    img: U('1595591996854-3b82ac8b6f65'),
  },

  // ── Honey & Liquids ─────────────────────────────────────────────────────
  {
    kw: ['honey', 'then', 'madhu', 'thene'],
    img: U('1558642452-9d2a7deb7f62'),
  },
  {
    kw: ['ghee', 'nei', 'clarified butter', 'desi ghee'],
    img: U('1474979266404-7eaacbcd87c5'),
  },
  {
    kw: ['coconut', 'thengai', 'nalikera'],
    img: U('1526947425960-945c6e72858f'),
  },
  {
    kw: ['rose water', 'panneer', 'panneer thooval', 'rosewater', 'gulab jal'],
    img: U('1585386959984-a4155224a1ad'),
  },

  // ── Sweeteners / Minerals ───────────────────────────────────────────────
  {
    kw: ['kalkandu', 'rock candy', 'candy sugar', 'mishri'],
    img: U('1587049352846-4a222e784d38'),
  },
  {
    kw: ['jaggery', 'panai vellam', 'karupatti', 'vellam', 'palm sugar', 'country sugar'],
    img: U('1587049352846-4a222e784d38'),
  },
  {
    kw: ['sugar', 'sakkarai', 'cane sugar', 'nattu sakkarai'],
    img: U('1587049352846-4a222e784d38'),
  },

  // ── Herb roots / Bark ───────────────────────────────────────────────────
  {
    kw: ['tulsi', 'thulasi', 'basil', 'holy basil'],
    img: U('1587411768638-ec71f8e33b78'),
  },
  {
    kw: ['ginger', 'inji', 'adrak'],
    img: U('1588543385566-60f2039da2e2'),
  },

  // ── Bundle / combo catch-all ─────────────────────────────────────────────
  {
    kw: ['bundle', 'kit', 'combo', 'pack', 'saamagri', 'set', 'package', 'poornahuthi',
         'panchagavyam', 'abishekam'],
    img: U('1607082348824-0a96f2a4b9da'),   // product bundle / assortment
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY_MAP — covers all known categories in the app including legacy ones
// ─────────────────────────────────────────────────────────────────────────────
export const CATEGORY_MAP: Record<string, string> = {
  'Pooja Items':         U('1567335743949-70f2b6b6e36d'),  // diya lamp
  'Herbal Powder':       U('1615485290382-441e4d049cb5'),  // herbal powder
  'Herbal Oil':          U('1608571423902-eed4a5ad8108'),  // oil bottle
  'Spices & Condiments': U('1532944138793-3a7bab2b5c1c'),  // spices bowl
  'Grains & Pulses':     U('1512621776951-a57141f2eefd'),  // lentils
  'Honey & Liquids':     U('1558642452-9d2a7deb7f62'),     // honey
  'Bundle Packages':     U('1607082348824-0a96f2a4b9da'),  // bundle box
  // Legacy / variant category names
  'Herbal Root':         U('1615485290382-441e4d049cb5'),
  'Herbal Leaf':         U('1587411768638-ec71f8e33b78'),  // green herb leaves
  'Herbal Spice':        U('1532944138793-3a7bab2b5c1c'),
  'Herbal Tablet':       U('1584308666744-24d5c474f2ae'),  // small white items
  'Herbal Gel':          U('1608571423902-eed4a5ad8108'),
  'Mineral Herb':        U('1615485290382-441e4d049cb5'),
  'Herbal Product':      U('1615485290382-441e4d049cb5'),
  'Pooja Essentials':    U('1567335743949-70f2b6b6e36d'),
  'Ritual Ingredients':  U('1567335743949-70f2b6b6e36d'),
  'Dairy & Fluids':      U('1474979266404-7eaacbcd87c5'),
  'Household Utility':   U('1607082348824-0a96f2a4b9da'),
}

// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER — shown when nothing else matches; premium neutral herbal feel
// ─────────────────────────────────────────────────────────────────────────────
export const PLACEHOLDER = U('1471193945509-9ad0617afabf')  // herbs & spices overhead

// ─────────────────────────────────────────────────────────────────────────────
// getProductImage — main resolver used everywhere
//
// size: 'card' (400px) | 'tile' (200px) | 'detail' (800px)
// ─────────────────────────────────────────────────────────────────────────────
export function getProductImage(
  name: string,
  category: string,
  dbUrl?: string | null,
  size: 'card' | 'tile' | 'detail' = 'card',
): string {
  const w = size === 'tile' ? 200 : size === 'detail' ? 800 : 400
  const q = size === 'tile' ? 70  : 80

  // 1. Local Images_V2 resolver — single source of truth for all product photos
  const localV2 = resolveProductImage(name)
  if (localV2) return localV2

  // 2. Admin-uploaded to Supabase Storage — actual uploaded files, not seeded URLs
  if (isStorageImage(dbUrl)) {
    return dbUrl.includes('?') ? dbUrl : `${dbUrl}?w=${w}&q=${q}`
  }

  // 3. Local static asset stored in public/assets
  if (isLocalAsset(dbUrl)) return preferWebpAsset(dbUrl)

  // No match — return empty string; CSS background handles the visual
  return ''
}

/** Stable onError handler — hides broken image, marks element so it never
 *  fires again (prevents infinite-error-loop). CSS background shows the slot. */
export function onImgError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget
  if (img.dataset.errored) return
  img.dataset.errored = '1'
  img.style.display = 'none'
}
