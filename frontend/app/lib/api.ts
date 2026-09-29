export type User = {
  id: string;
  name: string;
  email: string;
  image?: string;
  points: number;
  /** Discount wallet in satang, spent as whole baht off package prices. */
  discountCents?: number;
  role: "user" | "admin";
  status?: "active" | "suspended";
};

/** Whole baht of the discount wallet that come off a price (1 baht = 1 Point). */
export function discountPointsFor(discountCents: number | undefined, price: number) {
  return Math.min(Math.floor((discountCents ?? 0) / 100), price);
}

export function formatDiscount(discountCents: number | undefined) {
  return `฿${((discountCents ?? 0) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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
  durationMinutes: number;
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
  durationMinutes: number;
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
  profileCount: number;
  availableSlots: number;
  occupiedSlots: number;
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
  pricePaid?: number;
  discountPoints?: number;
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
  durationMinutes: number;
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
    duration_minutes: number;
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
    maxProfiles: number;
    hasAccountPin?: boolean;
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
  paymentAccounts: Array<{
    id: string;
    name: string;
    promptPayIdMasked: string;
    hasLineCookie: boolean;
    status: "active" | "inactive";
    isDefault: boolean;
    topupExpiresMinutes: number;
    note: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  lineTransferEvents: Array<{
    id: string;
    paymentAccountId: string | null;
    paymentAccountName: string | null;
    lineRevision: string | number | null;
    incomingAmountCents: number;
    balanceCents: number | null;
    destinationAccount: string | null;
    senderName: string | null;
    fromAccount: string | null;
    transferType: string | null;
    occurredAt: string | null;
    occurredRaw: string | null;
    status: "received" | "matched" | "unmatched" | "ignored" | "failed";
    matchedTopUpId: string | null;
    matchReason: string | null;
    userId: string | null;
    userEmail: string | null;
    createdAt: string;
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
  durationMinutes: number;
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
  durationMinutes?: number;
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
  service: string;
  email: string;
  password: string;
  accountPin?: string;
  purchasedAt?: string;
  masterExpiredAt: string;
  status?: string;
  maxProfiles?: number;
  note?: string;
}) {
  return apiFetch("/admin/master-emails", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateMasterEmail(masterEmailId: string, body: {
  service?: string;
  email?: string;
  password?: string;
  accountPin?: string;
  purchasedAt?: string;
  masterExpiredAt?: string;
  status?: string;
  maxProfiles?: number;
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

export function expireProfileRental(profileId: string) {
  return apiFetch<{ ended: number; pinRotation: boolean }>(`/admin/profiles/${profileId}/expire`, {
    method: "POST",
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

export function savePaymentAccount(body: {
  name: string;
  promptPayId: string;
  lineCookie?: string | null;
  status?: "active" | "inactive";
  isDefault?: boolean;
  topupExpiresMinutes?: number;
  note?: string | null;
}) {
  return apiFetch("/admin/payment-accounts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updatePaymentAccount(paymentAccountId: string, body: {
  name?: string;
  promptPayId?: string;
  lineCookie?: string | null;
  status?: "active" | "inactive";
  isDefault?: boolean;
  topupExpiresMinutes?: number;
  note?: string | null;
}) {
  return apiFetch(`/admin/payment-accounts/${paymentAccountId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function setDefaultPaymentAccount(paymentAccountId: string) {
  return apiFetch(`/admin/payment-accounts/${paymentAccountId}/default`, {
    method: "POST",
  });
}

export function deletePaymentAccount(paymentAccountId: string) {
  return apiFetch(`/admin/payment-accounts/${paymentAccountId}`, {
    method: "DELETE",
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

export type ReportRange = "day" | "week" | "month" | "year";

export type ReportTotals = {
  visitors: number;
  pageViews: number;
  newUsers: number;
  purchases: number;
  renewals: number;
  buyers: number;
  pointsSpent: number;
  topups: number;
  topupCents: number;
};

export type AdminReport = {
  range: ReportRange;
  date: string;
  from: string;
  to: string;
  unit: "hour" | "day" | "month";
  totals: ReportTotals;
  previous: ReportTotals;
  series: Array<{
    bucket: string;
    visitors: number;
    purchases: number;
    pointsSpent: number;
    topupCents: number;
  }>;
  topPackages: Array<{ name: string; service: string; count: number; points: number }>;
  topPages: Array<{ path: string; views: number; visitors: number }>;
  recentPurchases: Array<{
    id: string;
    createdAt: string;
    points: number;
    isRenewal: boolean;
    userName: string;
    userEmail: string;
    packageName: string;
    service: string;
    profileName: string;
  }>;
  recentTopups: Array<{
    id: string;
    paidAt: string;
    points: number;
    amountCents: number;
    userName: string;
    userEmail: string;
  }>;
  streamers: Array<{
    id: string;
    name: string;
    code: string;
    newCustomers: number;
    totalCustomers: number;
    maxUses: number | null;
    topupCents: number;
    purchases: number;
    pointsSpent: number;
  }>;
  snapshot: {
    activeSubscriptions: number;
    expiringIn24h: number;
    availableSlots: number;
    mastersExpiringIn7d: number;
    pendingTopups: number;
    pinRotationFailed: number;
    totalUsers: number;
    outstandingPoints: number;
  };
};

export function fetchAdminReport(range: ReportRange, date: string) {
  const query = new URLSearchParams({ range, date });
  return apiFetch<AdminReport>(`/admin/reports?${query}`);
}

export function trackPageView(body: { visitorId: string; path: string; referrer?: string }) {
  return fetch(`${apiUrl}/track`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

export function fetchTopupSettings() {
  return apiFetch<{ minTopupPoints: number }>("/points/settings");
}

export function fetchAdminSettings() {
  return apiFetch<{ minTopupPoints: number }>("/admin/settings");
}

export function updateAdminSettings(body: { minTopupPoints: number }) {
  return apiFetch<{ minTopupPoints: number }>("/admin/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export type RewardType = "fixed" | "percent";

export type TopupPromotion = {
  id: string;
  name: string;
  minAmountCents: number;
  rewardType: RewardType;
  rewardValue: number;
  maxRewardCents: number | null;
  status?: "active" | "inactive";
  timesUsed?: number;
  rewardGivenCents?: number;
};

export type StreamerCodeInfo = {
  streamerName: string;
  code: string;
  rewardType: RewardType;
  rewardValue: number;
  maxRewardCents: number | null;
};

/** Discount (satang) a reward rule gives for a top-up of baseCents; mirrors the backend. */
export function rewardCentsFor(
  rule: { rewardType: RewardType; rewardValue: number; maxRewardCents: number | null },
  baseCents: number,
) {
  const raw = rule.rewardType === "fixed" ? Math.round(rule.rewardValue * 100) : Math.floor((baseCents * rule.rewardValue) / 100);
  return rule.maxRewardCents ? Math.min(raw, rule.maxRewardCents) : raw;
}

export function describeReward(rule: { rewardType: RewardType; rewardValue: number; maxRewardCents: number | null }) {
  if (rule.rewardType === "fixed") return `ส่วนลด ฿${rule.rewardValue.toLocaleString("th-TH")}`;
  const cap = rule.maxRewardCents ? ` (สูงสุด ฿${(rule.maxRewardCents / 100).toLocaleString("th-TH")})` : "";
  return `ส่วนลด ${rule.rewardValue.toLocaleString("th-TH")}%${cap}`;
}

export function fetchTopupPromotions() {
  return apiFetch<{ promotions: TopupPromotion[] }>("/points/promotions");
}

export function checkStreamerCode(code: string) {
  return apiFetch<StreamerCodeInfo>(`/points/codes/${encodeURIComponent(code.trim())}`);
}

export type RewardInput = {
  rewardType: RewardType;
  rewardValue: number;
  maxReward: number | null; // baht, percent only
  status: "active" | "inactive";
};

export type AdminStreamer = {
  id: string;
  name: string;
  link: string | null;
  code: string;
  rewardType: RewardType;
  rewardValue: number;
  maxRewardCents: number | null;
  maxUses: number | null;
  status: "active" | "inactive";
  redeemed: number;
  pending: number;
  rewardGivenCents: number;
  customers: number;
  topups: number;
  topupCents: number;
  purchases: number;
  pointsSpent: number;
  referralLink: string;
};

export function fetchAdminTopupPromotions() {
  return apiFetch<{ promotions: TopupPromotion[] }>("/admin/topup-promotions");
}

export function saveAdminTopupPromotion(id: string | null, body: RewardInput & { name: string; minAmount: number }) {
  return apiFetch(id ? `/admin/topup-promotions/${id}` : "/admin/topup-promotions", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(body),
  });
}

export function deleteAdminTopupPromotion(id: string) {
  return apiFetch(`/admin/topup-promotions/${id}`, { method: "DELETE" });
}

export function fetchAdminStreamers() {
  return apiFetch<{ streamers: AdminStreamer[] }>("/admin/streamers");
}

export function saveAdminStreamer(
  id: string | null,
  body: RewardInput & { name: string; link: string | null; code?: string; maxUses: number | null; regenerateCode?: boolean },
) {
  return apiFetch(id ? `/admin/streamers/${id}` : "/admin/streamers", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(body),
  });
}

export function deleteAdminStreamer(id: string) {
  return apiFetch(`/admin/streamers/${id}`, { method: "DELETE" });
}

export type DecoyRoom = { id: string; service: string; expiresAt: string; createdAt: string; slots: string[] };

export function fetchDecoyRooms() {
  return apiFetch<{ rooms: DecoyRoom[] }>("/admin/decoys");
}

export function generateDecoyRooms(body: { rooms: number; slotsPerRoom: number; service: string; replace: boolean }) {
  return apiFetch<{ rooms: number; slots: number }>("/admin/decoys/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteDecoyRoom(id: string) {
  return apiFetch(`/admin/decoys/${id}`, { method: "DELETE" });
}

export function deleteAllDecoyRooms() {
  return apiFetch<{ removed: number }>("/admin/decoys", { method: "DELETE" });
}

export type PendingTopup = {
  id: string;
  points: number;
  createdAt: string;
  expiresAt: string;
  payableCents: number;
  discountCents: number;
  userId: string;
  userName: string;
  userEmail: string;
  streamerName: string | null;
  streamerCode: string | null;
};

export function fetchPendingTopups() {
  return apiFetch<{ topups: PendingTopup[] }>("/admin/topups/pending");
}

export function cancelTopup(id: string) {
  return apiFetch(`/admin/topups/${id}/cancel`, { method: "POST" });
}
