export type User = {
  id: string;
  name: string;
  email: string;
  image?: string;
  points: number;
  role: "user" | "admin";
  status?: "active" | "suspended";
};

export type SessionResponse = { user: User | null };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "https://apifastmovie.sysbright.dev/api";

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

export type StreamingRoomSlot = {
  id: string;
  name: string;
  status: string;
  profileExpiresAt: string | null;
  isAvailable: boolean;
  availablePackages: StreamingPackage[];
};

export type StreamingRoom = {
  id: string;
  name: string;
  label: string;
  service: string;
  status: string;
  masterExpiredAt: string;
  capacity: number;
  availableSlots: number;
  slots: StreamingRoomSlot[];
};

export function fetchStreamingRooms(service?: string) {
  const query = service ? `?service=${encodeURIComponent(service)}` : "";
  return apiFetch<StreamingRoom[]>(`/catalog/streaming-rooms${query}`);
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

export function purchaseProfileSubscription(profileId: string, packageId: string) {
  return apiFetch<PurchaseSubscriptionResponse>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({ profileId, packageId, paymentMethod: "points" }),
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
    activeUsers: number;
    totalUsers: number;
  };
  packages: Array<{
    id: string;
    slug: string;
    name: string;
    service: string;
    description: string | null;
    duration_days: number;
    price_amount: number;
    currency: string;
    status: string;
    availableStock: number;
  }>;
  masterEmails: Array<{
    id: string;
    packageId: string | null;
    packageName: string | null;
    packageSlug: string | null;
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
    packageName: string | null;
    packageSlug: string | null;
  }>;
  users: Array<{
    id: string;
    email: string;
    name: string;
    image: string | null;
    points: number;
    role: "user" | "admin";
    status: "active" | "suspended";
    createdAt: string;
    updatedAt: string;
    subscriptionCount: number;
    activeSubscriptionCount: number;
    transactionCount: number;
  }>;
};

export function fetchAdminInventory() {
  return apiFetch<AdminInventory>("/admin/inventory");
}

export function saveAdminPackage(body: {
  slug: string;
  name: string;
  service: string;
  description?: string | null;
  durationDays: number;
  priceAmount: number;
  currency?: string;
  status?: string;
}) {
  return apiFetch("/admin/packages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateAdminPackage(packageId: string, body: {
  slug?: string;
  name?: string;
  service?: string;
  description?: string | null;
  durationDays?: number;
  priceAmount?: number;
  currency?: string;
  status?: string;
}) {
  return apiFetch(`/admin/packages/${packageId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteAdminPackage(packageId: string) {
  return apiFetch(`/admin/packages/${packageId}`, { method: "DELETE" });
}

export function saveMasterEmail(body: {
  packageId: string;
  email: string;
  password: string;
  purchasedAt?: string;
  masterExpiredAt: string;
  status?: string;
  note?: string;
}) {
  return apiFetch("/admin/master-emails", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateMasterEmail(masterEmailId: string, body: {
  packageId?: string;
  email?: string;
  password?: string;
  purchasedAt?: string;
  masterExpiredAt?: string;
  status?: string;
  note?: string | null;
}) {
  return apiFetch(`/admin/master-emails/${masterEmailId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteMasterEmail(masterEmailId: string) {
  return apiFetch(`/admin/master-emails/${masterEmailId}`, { method: "DELETE" });
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

export function updateProfile(profileId: string, body: {
  masterEmailId?: string;
  profileName?: string;
  pin?: string;
  status?: string;
  profileExpiresAt?: string | null;
  note?: string | null;
}) {
  return apiFetch(`/admin/profiles/${profileId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function updateProfileStatus(profileId: string, status: string) {
  return apiFetch(`/admin/profiles/${profileId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function deleteProfile(profileId: string) {
  return apiFetch(`/admin/profiles/${profileId}`, { method: "DELETE" });
}

export function updateAdminUser(userId: string, body: {
  name?: string;
  role?: "user" | "admin";
  status?: "active" | "suspended";
  points?: number;
}) {
  return apiFetch(`/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function suspendAdminUser(userId: string) {
  return apiFetch(`/admin/users/${userId}`, { method: "DELETE" });
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
