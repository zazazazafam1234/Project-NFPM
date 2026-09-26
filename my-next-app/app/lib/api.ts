export type User = {
  id: string;
  name: string;
  email: string;
  image?: string;
  points: number;
};

export type SessionResponse = { user: User | null };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? "ไม่สามารถเชื่อมต่อกับระบบได้");
  }

  return response.json() as Promise<T>;
}

export function googleLoginUrl() {
  const redirectTo = `${window.location.origin}/profile`;
  return `${apiUrl}/auth/google?redirectTo=${encodeURIComponent(redirectTo)}`;
}

export type Room = {
  id: string;
  name: string;
  label: string;
  capacity: number;
  members: number;
  available: boolean;
};

export type Plan = {
  id: string;
  name: string;
  price: number;
  duration: string;
  durationDays: number;
  tag: string;
};

export function fetchRooms() {
  return apiFetch<Room[]>("/catalog/rooms");
}

export function fetchPlans() {
  return apiFetch<Plan[]>("/catalog/plans");
}

export type Transaction = {
  id: string;
  type: "topup" | "debit" | string;
  amount: number;
  description: string;
  createdAt: string;
};

export type Order = {
  id: string;
  roomName: string;
  roomLabel: string;
  planName: string;
  planDuration: string;
  price: number;
  status: "paid" | "pending" | string;
  paymentMethod: string;
  expiresAt: string | null;
  createdAt: string;
};

export function fetchTransactions() {
  return apiFetch<{ transactions: Transaction[] }>("/profile/transactions");
}

export function fetchOrders() {
  return apiFetch<{ orders: Order[] }>("/profile/orders");
}

export type Category = {
  id: string;
  name: string;
  slug: string;
  icon: string;
  productCount: number;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  badge: string | null;
  price: number;
  stock: number;
  category: { name: string; slug: string; icon: string };
};

export function fetchCategories() {
  return apiFetch<Category[]>("/catalog/categories");
}

export function fetchProducts(categorySlug?: string) {
  const qs = categorySlug ? `?category=${categorySlug}` : "";
  return apiFetch<Product[]>(`/catalog/products${qs}`);
}
