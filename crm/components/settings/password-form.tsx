"use client";
import { useState } from "react";
import { changePassword } from "@/app/(app)/settings/profile/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export function PasswordForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <form className="max-w-md space-y-3" onSubmit={async e => {
    e.preventDefault(); const form = e.currentTarget; setBusy(true); setMessage("");
    try { const result = await changePassword(new FormData(form)); setMessage(result.message); if (result.ok) form.reset(); }
    catch { setMessage("Password could not be updated. Please try again."); }
    finally { setBusy(false); }
  }}>
    <div><Label htmlFor="currentPassword">Current password</Label><Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required /></div>
    <div><Label htmlFor="newPassword">New password</Label><Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></div>
    <div><Label htmlFor="confirmPassword">Confirm new password</Label><Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required /></div>
    <Button type="submit" disabled={busy}>{busy ? "Updating…" : "Change password"}</Button>
    <p role="status" className="text-sm">{message}</p>
  </form>;
}
