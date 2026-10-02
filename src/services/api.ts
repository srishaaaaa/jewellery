export interface ApiProduct {
  id: number
  name: string
  name_ta?: string
  category: string
  remedy?: string[]
  price: number
  offer_price?: number
  offerPrice?: number
  unit?: string
  rating?: number
  description: string
  description_ta?: string
  benefits: string
  benefits_ta?: string
  image?: string
  image_url?: string
  imageUrl?: string
  stock: number
}

export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  name: string
  email: string
  password: string
}

export interface AuthResponse {
  token: string
  user: {
    id: number
    name: string
    email: string
    role: 'admin' | 'customer'
  }
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

function getHeaders(auth = false): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (auth) {
    const token = localStorage.getItem('mahalashmi-stores-token')
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  return headers
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${API_URL}${path}`, options)
  } catch {
    throw new Error('Unable to reach the server. Please check your connection and try again.')
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(payload.message || 'Service is temporarily unavailable. Please try again.')
  }

  return response.json()
}

export const api = {
  health: () => request<{ status: string; service: string }>('/health'),

  register: (payload: RegisterPayload) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    }),

  login: (payload: LoginPayload) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    }),

  me: () =>
    request<AuthResponse['user']>('/auth/me', {
      method: 'GET',
      headers: getHeaders(true),
    }),

  getProducts: (query?: string) => request<ApiProduct[]>(`/products${query ? `?${query}` : ''}`),

  getProductById: (id: number) => request<ApiProduct>(`/products/${id}`),

  createProduct: (payload: Record<string, unknown>) =>
    request<ApiProduct>('/products', {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(payload),
    }),

  updateProduct: (id: number, payload: Record<string, unknown>) =>
    request<ApiProduct>(`/products/${id}`, {
      method: 'PUT',
      headers: getHeaders(true),
      body: JSON.stringify(payload),
    }),

  deleteProduct: (id: number) =>
    request<{ message: string }>(`/products/${id}`, {
      method: 'DELETE',
      headers: getHeaders(true),
    }),

  getFavorites: () =>
    request<ApiProduct[]>('/products/user/favorites/list', {
      method: 'GET',
      headers: getHeaders(true),
    }),

  addFavorite: (productId: number) =>
    request<{ message: string }>('/products/user/favorites', {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify({ productId }),
    }),

  removeFavorite: (productId: number) =>
    request<{ message: string }>(`/products/user/favorites/${productId}`, {
      method: 'DELETE',
      headers: getHeaders(true),
    }),

  createOrder: (items: Array<{ productId: number; quantity: number }>) =>
    request('/orders', {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify({ items }),
    }),

  getMyOrders: () =>
    request('/orders/mine', {
      method: 'GET',
      headers: getHeaders(true),
    }),

  getAllOrders: () =>
    request('/orders/admin/all', {
      method: 'GET',
      headers: getHeaders(true),
    }),

  getSummary: () =>
    request<{ totalProducts: number; totalOrders: number; totalRevenue: number }>('/orders/admin/summary', {
      method: 'GET',
      headers: getHeaders(true),
    }),
}
