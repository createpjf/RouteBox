import { useState, useEffect, useCallback } from "react";
import { Key, Copy, Check, Plus, Trash2, Edit2, Save, X, Share2 } from "lucide-react";
import * as api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export function Account() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<api.ApiKey[]>([]);
  const [subscription, setSubscription] = useState<api.SubscriptionInfo | null>(null);
  const [referral, setReferral] = useState<api.ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [showNewKey, setShowNewKey] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Password change
  const [showPwChange, setShowPwChange] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [keysRes, subRes, refRes] = await Promise.all([
      api.getApiKeys().catch(() => ({ keys: [] })),
      api.getSubscription().catch(() => null),
      api.getReferral().catch(() => null),
    ]);
    setKeys(keysRes.keys);
    setSubscription(subRes);
    setReferral(refRes);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function createKey() {
    if (!newKeyName.trim()) return;
    const res = await api.createApiKey(newKeyName.trim());
    setKeys((prev) => [res.key, ...prev]);
    setNewKeyName("");
    setShowNewKey(false);
    if (res.key.plainKey) {
      copyKey(res.key.id, res.key.plainKey);
    }
  }

  function copyKey(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    await api.renameApiKey(id, editName.trim());
    setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, name: editName.trim() } : k)));
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    await api.deleteApiKey(id);
    setKeys((prev) => prev.filter((k) => k.id !== id));
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwLoading(true);
    setPwMessage(null);
    try {
      await api.changePassword(currentPw, newPw);
      setPwMessage({ type: "success", text: "Password updated successfully" });
      setCurrentPw("");
      setNewPw("");
    } catch (err) {
      setPwMessage({ type: "error", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setPwLoading(false);
    }
  }

  function copyReferralCode() {
    if (!referral) return;
    navigator.clipboard.writeText(referral.code);
    setCopiedId("referral");
    setTimeout(() => setCopiedId(null), 2000);
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-48 skeleton" />
        <div className="h-40 skeleton rounded-2xl" />
        <div className="h-60 skeleton rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Account</h1>
        <p className="text-text-secondary mt-1">Manage your profile, API keys, and subscription</p>
      </div>

      {/* Profile */}
      <div className="glass-card-static p-6">
        <h2 className="section-header">Profile</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-text-tertiary">Display Name</label>
            <div className="text-sm text-text-primary font-medium mt-1">{user?.displayName || "—"}</div>
          </div>
          <div>
            <label className="text-xs text-text-tertiary">Email</label>
            <div className="text-sm text-text-primary font-medium mt-1">{user?.email || "—"}</div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border-light">
          {showPwChange ? (
            <form onSubmit={handlePasswordChange} className="space-y-3 max-w-sm">
              {pwMessage && (
                <div className={`text-sm px-3 py-2 rounded-lg ${pwMessage.type === "success" ? "bg-accent-green/10 text-accent-green" : "bg-accent-red/10 text-accent-red"}`}>
                  {pwMessage.text}
                </div>
              )}
              <input type="password" className="input" placeholder="Current password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} required />
              <input type="password" className="input" placeholder="New password (min 8 chars)" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={8} />
              <div className="flex gap-2">
                <button type="submit" className="btn-primary text-sm" disabled={pwLoading}>{pwLoading ? "Saving..." : "Update Password"}</button>
                <button type="button" className="btn-ghost" onClick={() => setShowPwChange(false)}>Cancel</button>
              </div>
            </form>
          ) : (
            <button className="btn-ghost text-sm" onClick={() => setShowPwChange(true)}>Change Password</button>
          )}
        </div>
      </div>

      {/* Subscription */}
      <div className="glass-card-static p-6">
        <h2 className="section-header">Subscription</h2>
        <div className="flex items-center gap-4">
          <span className="badge bg-accent-ember/15 text-accent-ember text-sm capitalize">
            {subscription?.plan || user?.plan || "starter"}
          </span>
          <span className="text-sm text-text-secondary capitalize">{subscription?.status || "active"}</span>
          {subscription?.currentPeriodEnd && (
            <span className="text-xs text-text-tertiary">
              Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Referral */}
      {referral && (
        <div className="glass-card-static p-6">
          <h2 className="section-header">Referral Program</h2>
          <div className="flex items-center gap-3">
            <Share2 size={18} className="text-accent-purple" />
            <div className="flex-1">
              <div className="text-sm text-text-primary font-mono">{referral.code}</div>
              <div className="text-xs text-text-tertiary mt-0.5">
                {referral.totalUses} uses &middot; ${(referral.totalRewardCents / 100).toFixed(2)} earned
              </div>
            </div>
            <button onClick={copyReferralCode} className="btn-ghost text-xs">
              {copiedId === "referral" ? <Check size={14} className="text-accent-green" /> : <Copy size={14} />}
              Copy
            </button>
          </div>
        </div>
      )}

      {/* API Keys */}
      <div className="glass-card-static p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-header mb-0">API Keys</h2>
          <button onClick={() => setShowNewKey(true)} className="btn-primary text-sm h-8 px-3">
            <Plus size={14} /> New Key
          </button>
        </div>

        {showNewKey && (
          <div className="flex gap-2 mb-4">
            <input
              className="input flex-1"
              placeholder="Key name (e.g. production)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createKey()}
              autoFocus
            />
            <button onClick={createKey} className="btn-primary text-sm h-[42px]">Create</button>
            <button onClick={() => { setShowNewKey(false); setNewKeyName(""); }} className="btn-ghost"><X size={16} /></button>
          </div>
        )}

        {keys.length === 0 ? (
          <div className="text-sm text-text-secondary text-center py-4">
            No API keys yet. Create one to start using the API.
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 py-3 px-4 rounded-lg bg-bg-elevated/50">
                <Key size={16} className="text-text-tertiary shrink-0" />
                <div className="flex-1 min-w-0">
                  {editingId === k.id ? (
                    <div className="flex gap-2">
                      <input className="input text-sm h-8" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRename(k.id)} autoFocus />
                      <button onClick={() => handleRename(k.id)} className="text-accent-green"><Save size={14} /></button>
                      <button onClick={() => setEditingId(null)} className="text-text-tertiary"><X size={14} /></button>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-medium text-text-primary">{k.name}</div>
                      <div className="text-xs text-text-tertiary font-mono">{k.plainKey || k.maskedKey}</div>
                    </>
                  )}
                </div>
                {editingId !== k.id && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => copyKey(k.id, k.plainKey || k.maskedKey)} className="btn-ghost h-7 w-7 p-0" title="Copy">
                      {copiedId === k.id ? <Check size={13} className="text-accent-green" /> : <Copy size={13} />}
                    </button>
                    <button onClick={() => { setEditingId(k.id); setEditName(k.name); }} className="btn-ghost h-7 w-7 p-0" title="Rename">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDelete(k.id)} className="btn-ghost h-7 w-7 p-0 hover:text-accent-red" title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
