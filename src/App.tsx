import './index.css'
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuthStore, useProductStore, useVariantStore, useAdminAuthStore, useSettingsStore } from './store/store'
import { useMetalRateStore } from './store/metalRateStore'
import { BRAND_ACCENT, BRAND_EN } from './lib/brand'
import { clearLocalOrders } from './lib/ordersFallback'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { darkenHex, hexToRgba, ACCENT_ALPHA_STEPS } from './lib/color'
import { DropdownEnhancer } from './components/DropdownEnhancer'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Pos = lazy(() => import('./pages/Pos'))
const DigitalInvoice = lazy(() => import('./pages/DigitalInvoice'))
const CouponPage = lazy(() => import('./pages/CouponPage'))
const AdvanceReceiptPage = lazy(() => import('./pages/AdvanceReceiptPage'))
const PurchaseBillPage = lazy(() => import('./pages/PurchaseBillPage'))
const SchemeReceiptPage = lazy(() => import('./pages/SchemeReceiptPage'))
const DeskDocPage = lazy(() => import('./pages/DeskDocPage'))
const Login = lazy(() => import('./pages/Login'))
const AdminLogin = lazy(() => import('./pages/AdminLogin'))
// Customer portal (separate from the POS: OTP login, own records only)
const PortalLogin = lazy(() => import('./pages/customer/PortalLogin'))
const PortalLayout = lazy(() => import('./pages/customer/PortalLayout'))
const PayPage = lazy(() => import('./pages/customer/PayPage'))
const PortalHome = lazy(() => import('./pages/customer/PortalPages').then((m) => ({ default: m.PortalHome })))
const PortalSchemes = lazy(() => import('./pages/customer/PortalPages').then((m) => ({ default: m.PortalSchemes })))
const PortalSchemeDetail = lazy(() => import('./pages/customer/PortalPages').then((m) => ({ default: m.PortalSchemeDetail })))
const PortalPurchases = lazy(() => import('./pages/customer/PortalPages').then((m) => ({ default: m.PortalPurchases })))
const PortalBills = lazy(() => import('./pages/customer/PortalPages').then((m) => ({ default: m.PortalBills })))
const PortalBillDetail = lazy(() => import('./pages/customer/PortalPages').then((m) => ({ default: m.PortalBillDetail })))
const PortalPayments = lazy(() => import('./pages/customer/PortalPages').then((m) => ({ default: m.PortalPayments })))
const PortalNotifications = lazy(() => import('./pages/customer/PortalPages').then((m) => ({ default: m.PortalNotifications })))
const PortalProfile = lazy(() => import('./pages/customer/PortalPages').then((m) => ({ default: m.PortalProfile })))

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bgMain">
      <span className="h-10 w-10 animate-spin rounded-full border-4 border-black/10 border-t-[var(--accent)]" />
    </div>
  )
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user)
  const loading = useAuthStore((state) => state.loading)

  if (loading) return <LoadingSpinner />
  return user ? <Navigate to="/dashboard" replace /> : <>{children}</>
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, role } = useAdminAuthStore()
  const location = useLocation()
  if (!isLoggedIn || (role !== 'admin' && role !== 'staff')) {
    return <Navigate to="/admin-login" state={{ from: location }} replace />
  }
  return <>{children}</>
}

function AdminOnlyGuard({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, role } = useAdminAuthStore()
  const location = useLocation()
  if (!isLoggedIn) {
    return <Navigate to="/admin-login" state={{ from: location }} replace />
  }
  if (role !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}

function PosGuard({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAdminAuthStore()
  const location = useLocation()
  if (!isLoggedIn) {
    return <Navigate to="/admin-login" state={{ from: location }} replace />
  }
  return <>{children}</>
}

function AppShell() {
  const initialize = useAuthStore((state) => state.initialize)
  const fetchProducts = useProductStore((state) => state.fetchProducts)
  const fetchVariants = useVariantStore((state) => state.fetchVariants)
  const fetchSettings = useSettingsStore((state) => state.fetchSettings)
  const fetchRates = useMetalRateStore((state) => state.fetchRates)
  const shopName = useSettingsStore((state) => state.settings?.name)
  const shopLogoUrl = useSettingsStore((state) => state.settings?.logoUrl)
  const accentColor = useSettingsStore((state) => state.settings?.accentColor)

  // Site-wide accent colour, customizable in Store Settings > Appearance.
  useEffect(() => {
    const hex = accentColor || BRAND_ACCENT
    document.documentElement.style.setProperty('--accent', hex)
    document.documentElement.style.setProperty('--accent-dark', darkenHex(hex))
    for (const step of ACCENT_ALPHA_STEPS) {
      document.documentElement.style.setProperty(`--accent-a${step}`, hexToRgba(hex, step / 100))
    }
  }, [accentColor])

  useEffect(() => {
    document.title = shopName
      ? `${shopName} - Point of Sale & Inventory System`
      : `${BRAND_EN} - Point of Sale & Inventory System`
  }, [shopName])

  // The favicon/apple-touch-icon in index.html are static build assets — keep
  // them in sync with the store's uploaded logo once settings load, so the
  // browser tab icon reflects it instead of staying frozen on the bundled default.
  useEffect(() => {
    if (!shopLogoUrl) return
    const iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    const appleIconLink = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
    if (iconLink) iconLink.href = shopLogoUrl
    if (appleIconLink) appleIconLink.href = shopLogoUrl
  }, [shopLogoUrl])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      void initialize()
      return
    }

    clearLocalOrders()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        void initialize()
      }
    })

    void initialize()

    return () => subscription.unsubscribe()
  }, [initialize])

  useEffect(() => {
    void fetchProducts()
    void fetchVariants()
    void fetchSettings()
    void fetchRates()

    if (!isSupabaseConfigured) {
      return
    }

    const productChannel = supabase
      .channel('admin-products-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        void fetchProducts()
      })
      .subscribe()

    // A new daily rate is used by every open billing screen straight away.
    const rateChannel = supabase
      .channel('metal-rates-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'metal_rates' }, () => {
        void fetchRates()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(productChannel)
      void supabase.removeChannel(rateChannel)
    }
  }, [fetchProducts, fetchVariants, fetchSettings, fetchRates])

  return (
    <div className="h-dvh w-full max-w-full overflow-hidden bg-bgMain print:block print:h-auto print:overflow-visible">
      <main className="h-full print:block print:overflow-visible">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <Suspense fallback={<LoadingSpinner />}>
                  <Login />
                </Suspense>
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/admin-login"
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <AdminLogin />
              </Suspense>
            }
          />
          {/* Common Admin & Staff Portal Routes */}
          <Route
            element={
              <AdminGuard>
                <Suspense fallback={<LoadingSpinner />}>
                  <Dashboard />
                </Suspense>
              </AdminGuard>
            }
          >
            <Route path="/admin" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/advance-orders" element={<Dashboard />} />
          </Route>

          {/* Admin-Only Dedicated Routes */}
          <Route
            element={
              <AdminOnlyGuard>
                <Suspense fallback={<LoadingSpinner />}>
                  <Dashboard />
                </Suspense>
              </AdminOnlyGuard>
            }
          >
            <Route path="/whatsapp-center" element={<Dashboard />} />
            <Route path="/pos-analytics" element={<Dashboard />} />
            <Route path="/expenses" element={<Dashboard />} />
            <Route path="/dashboard/expenses" element={<Dashboard />} />
          </Route>
          <Route
            path="/pos"
            element={
              <PosGuard>
                <Suspense fallback={<LoadingSpinner />}>
                  <Pos />
                </Suspense>
              </PosGuard>
            }
          />
          <Route
            path="/invoice/:id"
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <DigitalInvoice />
              </Suspense>
            }
          />
          {/* ── Customer portal ── */}
          <Route path="/customer" element={<Navigate to="/customer/dashboard" replace />} />
          <Route path="/customer/login" element={<Suspense fallback={<LoadingSpinner />}><PortalLogin /></Suspense>} />
          <Route path="/customer/verify-otp" element={<Navigate to="/customer/login" replace />} />
          <Route path="/customer/pay/:token" element={<Suspense fallback={<LoadingSpinner />}><PayPage /></Suspense>} />
          <Route path="/pay/:token" element={<Suspense fallback={<LoadingSpinner />}><PayPage /></Suspense>} />
          <Route element={<Suspense fallback={<LoadingSpinner />}><PortalLayout /></Suspense>}>
            <Route path="/customer/dashboard" element={<Suspense fallback={<LoadingSpinner />}><PortalHome /></Suspense>} />
            <Route path="/customer/schemes" element={<Suspense fallback={<LoadingSpinner />}><PortalSchemes /></Suspense>} />
            <Route path="/customer/schemes/:id" element={<Suspense fallback={<LoadingSpinner />}><PortalSchemeDetail /></Suspense>} />
            <Route path="/customer/purchases" element={<Suspense fallback={<LoadingSpinner />}><PortalPurchases /></Suspense>} />
            <Route path="/customer/bills" element={<Suspense fallback={<LoadingSpinner />}><PortalBills /></Suspense>} />
            <Route path="/customer/bills/:id" element={<Suspense fallback={<LoadingSpinner />}><PortalBillDetail /></Suspense>} />
            <Route path="/customer/payments" element={<Suspense fallback={<LoadingSpinner />}><PortalPayments /></Suspense>} />
            <Route path="/customer/notifications" element={<Suspense fallback={<LoadingSpinner />}><PortalNotifications /></Suspense>} />
            <Route path="/customer/profile" element={<Suspense fallback={<LoadingSpinner />}><PortalProfile /></Suspense>} />
          </Route>
          <Route
            path="/coupon/:code"
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <CouponPage />
              </Suspense>
            }
          />
          <Route
            path="/document"
            element={
              <AdminGuard>
                <Suspense fallback={<LoadingSpinner />}>
                  <DeskDocPage />
                </Suspense>
              </AdminGuard>
            }
          />
          <Route
            path="/scheme-receipt/:schemeId/:installmentId?"
            element={
              <AdminGuard>
                <Suspense fallback={<LoadingSpinner />}>
                  <SchemeReceiptPage />
                </Suspense>
              </AdminGuard>
            }
          />
          <Route
            path="/purchase/:id"
            element={
              <AdminGuard>
                <Suspense fallback={<LoadingSpinner />}>
                  <PurchaseBillPage />
                </Suspense>
              </AdminGuard>
            }
          />
          <Route
            path="/advance/:id"
            element={
              <AdminGuard>
                <Suspense fallback={<LoadingSpinner />}>
                  <AdvanceReceiptPage />
                </Suspense>
              </AdminGuard>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
      <DropdownEnhancer />
    </BrowserRouter>
  )
}

