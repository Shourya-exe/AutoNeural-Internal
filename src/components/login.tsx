"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ShieldCheck,
  Eye,
  EyeOff,
} from "lucide-react";
export default function Login() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [visible, setVisible] = useState(false);
  return (
    <div className="login-page">
      <section className="login-story">
        <a className="brand" href="/">
          {" "}
          <span className="brand-mark">
            a<span>n</span>
          </span>
          <span>
            autoneural<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="login-message">
          <span className="eyebrow">THE TEAM BEHIND THE WORK</span>
          <h1>
            Good work.
            <br />
            Great together.
          </h1>
          <p>
            A little more clarity. A lot more progress.
            <br />
            Your team’s work, connected in one place.
          </p>
          <div className="illustration" aria-hidden="true">
            <div className="orbit o1" />
            <div className="orbit o2" />
            <div className="float-card">
              <span className="mini-check">
                <Check size={17} />
              </span>
              <div>
                <strong>Make things happen.</strong>
                <small>One task at a time.</small>
              </div>
              <ArrowUpRight size={19} />
            </div>
            <span className="float-avatar av1">M</span>
            <span className="float-avatar av2">R</span>
            <span className="float-avatar av3">S</span>
          </div>
        </div>
        <div className="login-foot">
          AutoNeural team workspace <span>Built for forward motion ↗</span>
        </div>
      </section>
      <section className="login-form-side">
        <div className="login-form">
          <span className="label-pill">
            <ShieldCheck size={14} /> PRIVATE WORKSPACE
          </span>
          <h2>Welcome back.</h2>
          <p>Sign in with your AutoNeural work account.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                const r = await fetch("/api/auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: f.get("email"),
                    password: f.get("password"),
                  }),
                });
                const j = await r.json();
                if (!r.ok) throw new Error(j.error);
                window.location.assign("/");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Unable to sign in.");
                setBusy(false);
              }
            }}
          >
            <label>
              Work email
              <input
                name="email"
                type="email"
                placeholder="you@autoneural.in"
                autoComplete="username"
                required
                maxLength={254}
              />
            </label>
            <label>
              Password
              <div className="password-field">
                <input
                  name="password"
                  type={visible ? "text" : "password"}
                  placeholder="Enter your CRM password"
                  autoComplete="current-password"
                  required
                  maxLength={200}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visible ? "Hide password" : "Show password"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary wide" disabled={busy}>
              {busy ? "Signing in…" : "Sign in to workspace"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="login-help">
            First time here or need a password reset?
            <br />
            Ask your workspace administrator for your CRM login.
          </p>
          <div className="secure-note">
            <ShieldCheck size={16} /> Your work stays within your team.
          </div>
        </div>
        <p className="copyright">
          © {new Date().getFullYear()} AutoNeural. All rights reserved.
        </p>
      </section>
    </div>
  );
}
