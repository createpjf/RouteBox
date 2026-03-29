import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle } from "lucide-react";
import * as api from "@/lib/api";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset email");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-page px-4">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-accent-ember flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-2xl">R</span>
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Reset password</h1>
          <p className="text-text-secondary mt-1">We'll send you a reset link</p>
        </div>

        {sent ? (
          <div className="glass-card-static p-6 text-center">
            <CheckCircle size={48} className="text-accent-green mx-auto mb-4" />
            <p className="text-text-primary font-medium mb-2">Check your email</p>
            <p className="text-sm text-text-secondary">
              We've sent a password reset link to <strong>{email}</strong>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="glass-card-static p-6 space-y-4">
            {error && (
              <div className="bg-accent-red/10 border border-accent-red/20 rounded-lg px-4 py-3 text-sm text-accent-red">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Email</label>
              <input
                type="email"
                className="input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                required
                autoFocus
              />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <div className="text-center mt-6">
          <Link to="/login" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
            <ArrowLeft size={14} /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
