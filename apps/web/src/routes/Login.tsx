import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Eye, EyeOff } from "lucide-react";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { login, loading, error, setError } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login(email, password);
      navigate("/");
    } catch {
      // error is set in hook
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-page px-4">
      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-accent-ember flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-2xl">R</span>
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Welcome back</h1>
          <p className="text-text-secondary mt-1">Sign in to your RouteBox account</p>
        </div>

        {/* Form */}
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

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="input pr-10"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="text-right">
            <Link to="/forgot-password" className="text-xs text-accent-ember hover:underline">
              Forgot password?
            </Link>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-text-secondary mt-6">
          Don't have an account?{" "}
          <Link to="/register" className="text-accent-ember hover:underline font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
