export type User = {
  id: string;
  name: string;
  email: string;
  image?: string;
  points: number;
  role: "user" | "admin";
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

export type StreamingPackage = {
  id: string;
  slug: string;
  name: string;
  service: string;
  description: string | null;
  durationDays: number;
  priceAmount: number;
  currency: string;
  status: string;
  availableStock: number;
};

export function fetchPackages() {
  return apiFetch<StreamingPackage[]>("/catalog/packages");
}

export type PurchaseSubscriptionResponse = {
  subscriptionId: string;
  status: string;
  startedAt: string;
  expiresAt: string;
  points: number;
  credentials: {
    email: string;
    password: string | null;
    profileName: string;
    pin: string | null;
  };
};

export function purchaseSubscription(packageSlug: string) {
  return apiFetch<PurchaseSubscriptionResponse>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({ packageSlug, paymentMethod: "points" }),
  });
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

export type Subscription = {
  id: string;
  status: string;
  paymentMethod: string;
  pricePaid: number;
  startedAt: string;
  expiresAt: string;
  createdAt: string;
  packageName: string;
  service: string;
  durationDays: number;
  profileName: string;
  masterEmail: string;
};

export function fetchSubscriptions() {
  return apiFetch<{ subscriptions: Subscription[] }>("/subscriptions");
}

export type AdminInventory = {
  metrics: {
    activePackages: number;
    activeMasterEmails: number;
    availableProfiles: number;
    activeSubscriptions: number;
  };
  packages: Array<{
    id: string;
    slug: string;
    name: string;
    service: string;
    duration_days: number;
    price_amount: number;
    status: string;
    availableStock: number;
  }>;
  masterEmails: Array<{
    id: string;
    service: string;
    email: string;
    status: string;
    purchased_at: string;
    master_expired_at: string;
    note: string | null;
    profileCount: number;
    availableProfiles: number;
  }>;
  profiles: Array<{
    id: string;
    master_email_id: string;
    profile_name: string;
    status: string;
    profile_expires_at: string | null;
    note: string | null;
    masterEmail: string;
    service: string;
  }>;
};

export function fetchAdminInventory() {
  return apiFetch<AdminInventory>("/admin/inventory");
}

export function saveAdminPackage(body: {
  slug: string;
  name: string;
  service: string;
  durationDays: number;
  priceAmount: number;
  status?: string;
}) {
  return apiFetch("/admin/packages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function saveMasterEmail(body: {
  service: string;
  email: string;
  password: string;
  masterExpiredAt: string;
  note?: string;
}) {
  return apiFetch("/admin/master-emails", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function saveProfile(body: {
  masterEmailId: string;
  profileName: string;
  pin?: string;
  profileExpiresAt?: string;
  note?: string;
}) {
  return apiFetch("/admin/profiles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateProfileStatus(profileId: string, status: string) {
  return apiFetch(`/admin/profiles/${profileId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
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
