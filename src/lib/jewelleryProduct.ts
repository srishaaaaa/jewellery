import type { Product } from '../store/store'
import {
  calculateNetWeight,
  priceJewelleryItem,
  type CurrentRates,
  type JewelleryAttributes,
  type JewelleryPricingResult,
} from './jewellery'

/** Jewellery attributes of a catalogue product, or null for a regular (non-jewellery) item. */
export const getJewelleryAttributes = (product: Pick<Product,
  'metalType' | 'purity' | 'grossWeight' | 'stoneWeight' | 'netWeight' | 'makingCharge' | 'makingChargeType'
  | 'wastage' | 'wastageType' | 'stoneCharge' | 'otherCharge' | 'huid' | 'designNumber' | 'subcategory'>,
): JewelleryAttributes | null => {
  if (!product.metalType) return null
  const gross = Number(product.grossWeight) || 0
  const stone = Number(product.stoneWeight) || 0
  const net = Number(product.netWeight) || calculateNetWeight(gross, stone)
  return {
    metalType: product.metalType,
    purity: product.purity || '',
    grossWeight: gross,
    stoneWeight: stone,
    netWeight: net,
    makingCharge: Number(product.makingCharge) || 0,
    makingChargeType: product.makingChargeType || 'fixed',
    wastage: Number(product.wastage) || 0,
    wastageType: product.wastageType || 'percentage',
    stoneCharge: Number(product.stoneCharge) || 0,
    otherCharge: Number(product.otherCharge) || 0,
    huid: product.huid || '',
    designNumber: product.designNumber || '',
    subcategory: product.subcategory || '',
  }
}

export const isJewelleryProduct = (product: Pick<Product, 'metalType'>) => Boolean(product.metalType)

/** Prices a jewellery product with today's rates (null for regular items). */
export const priceProduct = (product: Product, rates: CurrentRates): JewelleryPricingResult | null => {
  const attrs = getJewelleryAttributes(product)
  if (!attrs) return null
  return priceJewelleryItem(attrs, rates, {
    sku: product.sku || null,
    barcode: product.barcode || null,
    fallbackPrice: product.offerPrice || product.price,
  })
}

/**
 * Price to display for a product: the live calculated price for jewellery
 * (null when today's rate is missing), the stored price for everything else.
 */
export const currentProductPrice = (product: Product, rates: CurrentRates): number | null => {
  const priced = priceProduct(product, rates)
  if (!priced) return product.offerPrice || product.price
  return priced.ok ? priced.snapshot.unit_price : null
}
