import { apiFetch } from "@/lib/api";
import { auth } from "@/lib/firebase";
import { getApiUrl } from "@/lib/config";

export interface UpdateProfileInput {
  full_name?: string;
  email?: string;
  phone?: string;
}

export const updateProfile = async (data: UpdateProfileInput) =>
  apiFetch<{ user: any }>("/api/users/profile", {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const uploadProfilePhoto = async (uri: string) => {
  const formData = new FormData();
  const filename = uri.split("/").pop() || "photo.jpg";
  const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  formData.append("photo", {
    uri,
    name: filename,
    type: mime,
  } as any);

  let authHeader: Record<string, string> = {};
  if (auth.currentUser) {
    const token = await auth.currentUser.getIdToken();
    authHeader = { Authorization: `Bearer ${token}` };
  }

  const res = await fetch(getApiUrl("/api/users/photo"), {
    method: "POST",
    headers: authHeader,
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to upload photo");
  }

  return res.json() as Promise<{ photoURL: string }>;
};
