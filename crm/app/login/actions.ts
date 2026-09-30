"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";

/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
function safeCallback(raw: FormDataEntryValue | null): string {
  const v = typeof raw === "string" ? raw : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") ? v : "/";
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = safeCallback(formData.get("callbackUrl"));

  try {
    await signIn("credentials", { email, password, redirectTo: callbackUrl });
  } catch (e) {
    if (e instanceof AuthError) {
      const qs = new URLSearchParams({ error: "1", email });
      if (callbackUrl !== "/") qs.set("callbackUrl", callbackUrl);
      redirect(`/login?${qs}`);
    }
    throw e; // Auth.js signals a successful sign-in by throwing a redirect
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login?signedOut=1" });
}
