import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Pause, Play, DollarSign, Activity, X } from "lucide-react";
import * as api from "@/lib/api";

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function MyListings() {
  const [keys, setKeys] = useState<api.SharedKey[]>([]);
  const [earnings, setEarnings] = useState<api.EarningsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);

  // Register form
  const [regProvider, setRegProvider] = useState("OpenAI");
  const [regApiKey, setRegApiKey] = useState("");
  const [regModels, setRegModels] = useState("");
  const [regRpm, setRegRpm] = useState("60");
  const [regDailyLimit, setRegDailyLimit] = useState("1000");
  const [regPriceIn, setRegPriceIn] = useState("");
  const [regPriceOut, setRegPriceOut] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [keysRes, earningsRes] = await Promise.all([
      api.getMySharedKeys().catch(() => ({ keys: [] })),
      api.getMyEarnings().catch(() => null),
    ]);
    setKeys(keysRes.keys);
    setEarnings(earningsRes);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegLoading(true);
    setRegError(null);
    try {
      const models = regModels.split(",").map((m) => m.trim()).filter(Boolean);
      if (models.length === 0) {
        setRegError("Enter at least one model");
        return;
      }
      const res = await api.registerSharedKey({
        providerName: regProvider,
        apiKey: regApiKey,
        models,
        rateLimitRpm: parseInt(regRpm) || 60,
        dailyLimit: parseInt(regDailyLimit) || 1000,
      });

      // Create listing if pricing provided
      if (regPriceIn && regPriceOut) {
        await api.createListing(res.key.id, {
          priceInputPerM: parseFloat(regPriceIn),
          priceOutputPerM: parseFloat(regPriceOut),
        });
      }

      setShowRegister(false);
      resetForm();
      loadData();
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "Failed to register key");
    } finally {
      setRegLoading(false);
    }
  }

  function resetForm() {
    setRegProvider("OpenAI");
    setRegApiKey("");
    setRegModels("");
    setRegRpm("60");
    setRegDailyLimit("1000");
    setRegPriceIn("");
    setRegPriceOut("");
    setRegError(null);
  }

  async function toggleKeyStatus(key: api.SharedKey) {
    const newStatus = key.status === "active" ? "paused" : "active";
    await api.updateSharedKey(key.id, { status: newStatus });
    setKeys((prev) => prev.map((k) => (k.id === key.id ? { ...k, status: newStatus } : k)));
  }

  async function deleteKey(id: string) {
    await api.deleteSharedKey(id);
    setKeys((prev) => prev.filter((k) => k.id !== id));
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-48 skeleton" />
        <div className="h-28 skeleton rounded-2xl" />
        <div className="h-64 skeleton rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">My Shared Keys</h1>
          <p className="text-text-secondary mt-1">Share your API keys and earn from idle capacity</p>
        </div>
        <button onClick={() => setShowRegister(true)} className="btn-primary">
          <Plus size={16} /> Share a Key
        </button>
      </div>

      {/* Earnings Summary */}
      {earnings && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="glass-card-static p-5">
            <div className="flex items-center gap-2 text-text-tertiary text-xs uppercase tracking-wider mb-2">
              <DollarSign size={14} /> Total Earned
            </div>
            <div className="text-2xl font-bold text-accent-green">{formatCost(earnings.totalEarnedCents)}</div>
          </div>
          <div className="glass-card-static p-5">
            <div className="flex items-center gap-2 text-text-tertiary text-xs uppercase tracking-wider mb-2">
              <Activity size={14} /> Requests Served
            </div>
            <div className="text-2xl font-bold text-text-primary">{earnings.totalRequests.toLocaleString()}</div>
          </div>
          <div className="glass-card-static p-5">
            <div className="flex items-center gap-2 text-text-tertiary text-xs uppercase tracking-wider mb-2">
              <DollarSign size={14} /> Pending Settlement
            </div>
            <div className="text-2xl font-bold text-accent-amber">{formatCost(earnings.pendingSettlementCents)}</div>
          </div>
        </div>
      )}

      {/* Register Modal */}
      {showRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleRegister} className="glass-card-static p-6 w-full max-w-lg mx-4 space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-text-primary">Share an API Key</h2>
              <button type="button" onClick={() => { setShowRegister(false); resetForm(); }} className="text-text-tertiary hover:text-text-primary">
                <X size={18} />
              </button>
            </div>

            {regError && (
              <div className="bg-accent-red/10 border border-accent-red/20 rounded-lg px-4 py-3 text-sm text-accent-red">
                {regError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Provider</label>
              <select className="input" value={regProvider} onChange={(e) => setRegProvider(e.target.value)}>
                {["OpenAI", "Anthropic", "Google", "DeepSeek", "MiniMax", "Kimi"].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">API Key</label>
              <input
                type="password"
                className="input font-mono text-sm"
                placeholder="sk-..."
                value={regApiKey}
                onChange={(e) => setRegApiKey(e.target.value)}
                required
              />
              <p className="text-xs text-text-tertiary mt-1">Your key is encrypted and never exposed</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Models (comma-separated)</label>
              <input
                className="input text-sm"
                placeholder="gpt-4o, gpt-4o-mini"
                value={regModels}
                onChange={(e) => setRegModels(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Rate Limit (RPM)</label>
                <input type="number" className="input text-sm" value={regRpm} onChange={(e) => setRegRpm(e.target.value)} min="1" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Daily Limit</label>
                <input type="number" className="input text-sm" value={regDailyLimit} onChange={(e) => setRegDailyLimit(e.target.value)} min="1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Price Input ($/1M tokens)</label>
                <input type="number" step="0.01" className="input text-sm" placeholder="2.50" value={regPriceIn} onChange={(e) => setRegPriceIn(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Price Output ($/1M tokens)</label>
                <input type="number" step="0.01" className="input text-sm" placeholder="10.00" value={regPriceOut} onChange={(e) => setRegPriceOut(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary flex-1" disabled={regLoading}>
                {regLoading ? "Registering..." : "Register & List"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setShowRegister(false); resetForm(); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Shared Keys List */}
      {keys.length === 0 ? (
        <div className="glass-card-static p-12 text-center">
          <p className="text-text-secondary mb-4">
            You haven't shared any API keys yet.
            Share your idle API capacity and earn credits when others use it.
          </p>
          <button onClick={() => setShowRegister(true)} className="btn-primary">
            <Plus size={16} /> Share Your First Key
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <div key={key.id} className="glass-card-static p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="badge bg-accent-blue/15 text-accent-blue">{key.providerName}</span>
                <span className={`badge ${
                  key.status === "active"
                    ? "bg-accent-green/15 text-accent-green"
                    : key.status === "paused"
                    ? "bg-accent-amber/15 text-accent-amber"
                    : "bg-accent-red/15 text-accent-red"
                }`}>
                  {key.status}
                </span>
                <span className="text-xs text-text-tertiary font-mono">{key.keyHint}</span>
                <div className="ml-auto flex gap-1">
                  <button onClick={() => toggleKeyStatus(key)} className="btn-ghost h-8 px-2" title={key.status === "active" ? "Pause" : "Resume"}>
                    {key.status === "active" ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button onClick={() => deleteKey(key.id)} className="btn-ghost h-8 px-2 hover:text-accent-red" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mb-3">
                {key.models.map((m) => (
                  <span key={m} className="text-xs font-mono bg-bg-elevated px-2 py-0.5 rounded text-text-secondary">
                    {m}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-4 text-center text-xs">
                <div>
                  <div className="text-text-tertiary">RPM Limit</div>
                  <div className="font-medium text-text-primary mt-0.5">{key.rateLimitRpm}</div>
                </div>
                <div>
                  <div className="text-text-tertiary">Daily Limit</div>
                  <div className="font-medium text-text-primary mt-0.5">{key.dailyLimit}</div>
                </div>
                <div>
                  <div className="text-text-tertiary">Requests</div>
                  <div className="font-medium text-text-primary mt-0.5">{key.totalRequests.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-text-tertiary">Earned</div>
                  <div className="font-medium text-accent-green mt-0.5">{formatCost(key.totalEarnedCents)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
