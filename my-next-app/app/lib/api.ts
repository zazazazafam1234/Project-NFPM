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
