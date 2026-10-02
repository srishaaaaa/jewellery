/**
 * productImageResolver.ts — Local Images_V2 asset resolver
 *
 * Covers every product in the catalog.
 * Returns null when no match; caller falls through to legacy resolver.
 */

const BASE = '/assets/Images_V2/'

// Variant-level: "productkey|variantkey" → filename
const VARIANT_MAP: Record<string, string> = {
  // Agarbatti brands
  'agarbatti|cycle':              'Agarbatti Cycle.jpeg',
  'agarbatti|bindhu':             'Agarbatti Cycle.jpeg',
  'agarbatti|bindhu agarbatti':   'Agarbatti Cycle.jpeg',
  'agarbatti|z black':            'Agarbatti Z Black.jpeg',
  'agarbatti|z-black':            'Agarbatti Z Black.jpeg',
  'agarbatti|miracle':            'Agarbatti Miracle.jpeg',

  // Vibhoothi brands
  'vibhoothi|sithanathan':        'Viboothi-Sithanathan.jpeg',
  'vibhoothi|baskaran':           'Vibhoothi-Baskaran.jpeg',

  // Deepam Thiri
  'deepam thiri|cotton':          'Deepam Thiri Cotton.jpeg',
  'deepam thiri|thread':          'Deepam Thiri Thread.jpeg',

  // Navagraha Bit
  'navagraha bit|polyster':       'Navagraha Bit Polyster.jpeg',
  'navagraha bit|polyester':      'Navagraha Bit Polyster.jpeg',
  'navagraha bit|cotton':         'Navagraha Bit Cotton.jpeg',
  'navagraha bit|cotton 1m':      'Navagraha Bit Cotton.jpeg',
  'navagraha bit|cloth':          'Navagraha Bit Cloth.jpeg',

  // Panchagavyam / Panchakavyam
  'panchagavyam|liquid':          'Panchakavyam Liquid.jpeg',
  'panchagavyam|vilaku':          'Panchakavyam vilakku.jpeg',
  'panchagavyam|vilakku':         'Panchakavyam vilakku.jpeg',
  'panchakavyam|liquid':          'Panchakavyam Liquid.jpeg',
  'panchakavyam|vilaku':          'Panchakavyam vilakku.jpeg',
  'panchakavyam|vilakku':         'Panchakavyam vilakku.jpeg',

  // Sugar Diabetes Podi
  'sugar diabetes podi|packet':   'Sugar Diabetes Podi Packet.jpeg',
  'sugar diabetes podi|box':      'Sugar diabetes Podi Box.jpeg',

  // Tripala/Thripala
  'tripala|packet':               'Thripala Podi.jpeg',
  'tripala|box':                  'Thripala Box.jpeg',
  'thripala|packet':              'Thripala Podi.jpeg',
  'thripala|box':                 'Thripala Box.jpeg',
  'thiripala|packet':             'Thripala Podi.jpeg',
  'thiripala|box':                'Thripala Box.jpeg',
}

// Product-level: "productkey" → filename
const PRODUCT_MAP: Record<string, string> = {
  // ── Pooja Items ────────────────────────────────────────────────
  'kungumam':                     'Kungumam.jpeg',
  'karpooram':                    'Karpooram.jpeg',
  'karpuram':                     'Karpuram.jpeg',
  'camphor':                      'Karpooram.jpeg',
  'sandhanam':                    'Sandhanam.jpeg',
  'special sandhanam':            'Special Sandhanam.jpeg',
  'sandal water':                 'Sandhanam.jpeg',
  'kolamavu':                     'Kolamavu.jpeg',
  'kolamaavu':                    'Kolamavu.jpeg',
  'agarbatti':                    'Agarbatti Cycle.jpeg',
  'agarbathy':                    'Agarbatti Cycle.jpeg',
  'vibhoothi':                    'Viboothi-Sithanathan.jpeg',
  'vibhuti':                      'Viboothi-Sithanathan.jpeg',
  'vibuthi':                      'Viboothi-Sithanathan.jpeg',
  'thiru neeru':                  'Viboothi-Sithanathan.jpeg',
  'thiru neer':                   'Viboothi-Sithanathan.jpeg',
  'deepam thiri':                 'Deepam Thiri Cotton.jpeg',
  'deepam':                       'Deepam Thiri Cotton.jpeg',
  'navagraha bit':                'Navagraha Bit Polyster.jpeg',
  'navagraha':                    'Navagraha Bit Polyster.jpeg',
  'panchagavyam':                 'Panchakavyam Liquid.jpeg',
  'panchakavyam':                 'Panchakavyam Liquid.jpeg',
  'panchakavya vilaku':           'Thripala Box.jpeg',
  'panchakavya vilakku':          'Thripala Box.jpeg',
  'panchagavya vilaku':           'Thripala Box.jpeg',
  'panchagavya vilakku':          'Thripala Box.jpeg',
  'poornahuthi saaman':           'Poornahuthi Saaman.jpeg',
  'poornahuthi':                  'Poornahuthi Saaman.jpeg',
  'daily pooja combo':            'Poornahuthi Saaman.jpeg',
  'wedding ritual pack':          'Poornahuthi Saaman.jpeg',
  'pazha vagaigal set':           'Panchakavyam Liquid.jpeg',

  // ── Herbal Powders ─────────────────────────────────────────────
  'manjal podi':                  'Manjal Podi.jpeg',
  'manja podi':                   'Manjal Podi.jpeg',
  'thulasi podi':                 'Thulasi Podi.jpeg',
  'tulasi podi':                  'Thulasi Podi.jpeg',
  'tulsi extract':                'Thulasi Podi.jpeg',
  'veppalai podi':                'Veppalai Podi.jpeg',
  'vendhayam podi':               'Vendhayam Podi.jpeg',
  'omam podi':                    'Omam Podi.jpeg',
  'ashwagandha podi':             'Ashwagandha Podi.jpeg',
  'aswagandha podi':              'Ashwagandha Podi.jpeg',
  'herbal wellness pack':         'Ashwagandha Podi.jpeg',
  'sukku podi':                   'Sukku Podi.jpeg',
  'chukku podi':                  'Sukku Podi.jpeg',
  'athimathuram':                 'Athimathuram Podi.jpeg',
  'thripala podi':                'Thripala Podi.jpeg',
  'tripala podi':                 'Thripala Podi.jpeg',
  'thiripala podi':               'Thripala Podi.jpeg',
  'triphala podi':                'Thripala Podi.jpeg',
  'thripala box':                 'Thripala Box.jpeg',
  'tripala box':                  'Thripala Box.jpeg',
  'thiripala box':                'Thripala Box.jpeg',
  'chitharathai podi':            'Chitharathai Podi.jpeg',
  'kadukkai podi':                'Kadukkai Podi.jpeg',
  'kadukai podi':                 'Kadukkai Podi.jpeg',
  'kashayam podi':                'Kashayam Podi.jpeg',
  'kasayam podi':                 'Kashayam Podi.jpeg',
  'thipli kashayam podi':         'Thipli Kashayam Podi.jpeg',
  'thipli kasayam podi':          'Thipli Kashayam Podi.jpeg',
  'sugar diabetes podi':          'Sugar Diabetes Podi.jpeg',
  'amala podi':                   'Amala Podi.jpeg',
  'amla podi':                    'Amala Podi.jpeg',
  'nellikkai podi':               'Amala Podi.jpeg',
  'murungai elai podi':           'Murungai Elai Podi.jpeg',
  'murungai podi':                'Murungai Elai Podi.jpeg',
  'murungai poo podi':            'Murungai Poo Podi.jpeg',
  'murungai poo':                 'Murungai Poo Podi.jpeg',
  'murungai seed':                'Murungai Seed.jpeg',
  'murungai vidhai':              'Murungai Seed.jpeg',
  'kandankathiri podi':           'Kandankathiri Podi.jpeg',
  'kutralam kuliyal podi':        'Bathing Powder.jpeg',
  'kutralam':                     'Bathing Powder.jpeg',
  // arugu pul has no dedicated image — let it fall through to placeholder

  // ── Herbal Oils ────────────────────────────────────────────────
  'veppa ennai':                  'Veppa ennai.jpeg',
  'veppennai':                    'Veppa ennai.jpeg',
  'vilakkennai':                  'Vilakennai Oil.jpeg',
  'vilakennai':                   'Vilakennai Oil.jpeg',
  'thengai ennai':                'Thenga Ennai.jpeg',
  'thenga ennai':                 'Thenga Ennai.jpeg',
  'santhanathi oil':              'Santhanathi Oil.jpeg',
  'santhanathi':                  'Santhanathi Oil.jpeg',
  'sandal oil':                   'Santhanathi Oil.jpeg',
  // keelanelli ennai has no dedicated image — falls through to placeholder

  // ── Spices ──────────────────────────────────────────────────────
  'kalkandu':                     'Kalkandu.jpeg',
  'elakkai':                      'Elakkai.jpeg',
  'lavangam':                     'Lavangam.jpeg',
  'pattai':                       'Pattai.jpeg',
  'ellu':                         'Ellu.jpeg',
  'jathikkai':                    'Jathikkai.jpeg',
  'jathikai':                     'Jathikkai.jpeg',
  'vasambu':                      'Vasambu.jpeg',
  'karuseerakam':                 'Karuseerakam.jpeg',
  // kalonji, sombu: no matching Images_V2 file — use placeholder, NOT Karuseerakam/Omam

  // ── Grains & Pulses ─────────────────────────────────────────────
  'pacha arisi':                  'Pacha Arisi.jpeg',
  'pachaarusi':                   'Pacha Arisi.jpeg',
  'pacharisi':                    'Pacha Arisi.jpeg',
  'ulundhu white':                'Ulundhu White.jpeg',
  'ulundhu black':                'Ulundhu Black.jpeg',
  'karuppu ulundhu':              'Ulundhu Black.jpeg',
  'ulundhu':                      'Ulundhu White.jpeg',
  'kadalai paruppu':              'Kadalai Paruppu.jpeg',
  'pasi payiru':                  'Pasi Payiru.jpeg',
  'pasi paruppu':                 'Pasi Payiru.jpeg',
  // thovar paruppu has no dedicated image — NOT Kadalai

  // ── Honey & Liquids ─────────────────────────────────────────────
  'nei dodla':                    'Nei Dodla.jpeg',
  'nei':                          'Nei Dodla.jpeg',
  'ghee':                         'Nei Dodla.jpeg',
  'honey':                        'Honey(thaen).jpeg',
  'thaen':                        'Honey(thaen).jpeg',
  'then':                         'Honey(thaen).jpeg',
  'panneer':                      'Panneer 200ml.jpeg',
  'panner':                       'Panneer 200ml.jpeg',
  'special panner':               'Panneer 200ml.jpeg',
  'special panneer':              'Panneer 200ml.jpeg',

  // ── Esha Herbals ───────────────────────────────────────────────
  'herbal sheekai':               'Herbal Sheekai.jpeg',
  'seeka powder':                 'Herbal Sheekai.jpeg',
  'shikakai':                     'Herbal Sheekai.jpeg',
  'sheekai':                      'Herbal Sheekai.jpeg',
  'bathing powder':               'Bathing Powder.jpeg',
  'esha bathing powder':          'Bathing Powder.jpeg',
  'face pack':                    'FacePack.jpeg',
  'facepack':                     'FacePack.jpeg',
  'esha face pack':               'FacePack.jpeg',
  'muthani mitti':                'Muthani Mitti Powder.jpeg',
  'fuller earth':                 'Muthani Mitti Powder.jpeg',
}

function norm(s: string): string {
  return s.toLowerCase().trim()
}

/** Resolve product + optional variant name to a local Images_V2 URL.
 *  Returns null when no local image found; caller should use legacy resolver. */
export function resolveProductImage(productName: string, variantName?: string | null): string | null {
  const pKey = norm(productName)

  if (variantName) {
    const vKey = norm(variantName)
    const exact = VARIANT_MAP[`${pKey}|${vKey}`]
    if (exact) return BASE + exact

    // Substring: map key is substring of query keys
    for (const [mapKey, filename] of Object.entries(VARIANT_MAP)) {
      const bar = mapKey.indexOf('|')
      if (bar < 0) continue
      const pk = mapKey.slice(0, bar)
      const vk = mapKey.slice(bar + 1)
      if (pKey.includes(pk) && (vKey.includes(vk) || vk.includes(vKey))) return BASE + filename
    }

    // Variant keyword embedded in combined product name (e.g. "Agarbatti Cycle")
    for (const [mapKey, filename] of Object.entries(VARIANT_MAP)) {
      const bar = mapKey.indexOf('|')
      if (bar < 0) continue
      const pk = mapKey.slice(0, bar)
      const vk = mapKey.slice(bar + 1)
      if (pKey.includes(pk) && pKey.includes(vk)) return BASE + filename
    }
  }

  // Exact product match
  if (PRODUCT_MAP[pKey]) return BASE + PRODUCT_MAP[pKey]

  // Substring: key is contained in product name
  for (const [key, filename] of Object.entries(PRODUCT_MAP)) {
    if (pKey.includes(key)) return BASE + filename
  }

  return null
}
