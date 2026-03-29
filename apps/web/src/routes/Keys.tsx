import { useState, useEffect, useCallback } from "react";
import { Key, Copy, Check, Plus, Trash2, Edit2, Save, X } from "lucide-react";
import * as api from "@/lib/api";

export function Keys() {
  const [keys, setKeys] = useState<api.ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [showNewKey, setShowNewKey] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const loadKeys = useCallback(async () => {
    setLoading(true);
    const res = await api.getApiKeys().catch(() => ({ keys: [] }));
    setKeys(res.keys);
    setLoading(false);
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

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

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="h-12 skeleton rounded-xl w-48" />
        <div className="h-64 skeleton rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">API Keys</h2>
            <p className="text-sm text-text-secondary mt-0.5">
              Create and manage API keys to authenticate requests.
            </p>
          </div>
          <button onClick={() => setShowNewKey(true)} className="btn-primary text-sm h-9 px-4">
            <Plus size={14} /> New Key
          </button>
        </div>

        {showNewKey && (
          <div className="flex gap-2 mb-4">
            <input
              className="input flex-1"
              placeholder="Key name (e.g. production, development)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createKey()}
              autoFocus
            />
            <button onClick={createKey} className="btn-primary text-sm h-[42px]">Create</button>
            <button onClick={() => { setShowNewKey(false); setNewKeyName(""); }} className="btn-ghost">
              <X size={16} />
            </button>
          </div>
        )}

        {keys.length === 0 ? (
          <div className="text-center py-8 text-text-secondary text-sm">
            No API keys yet. Create one to start using the API.
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 py-3 px-4 rounded-lg bg-bg-elevated/50 border border-border-light">
                <Key size={16} className="text-text-tertiary shrink-0" />
                <div className="flex-1 min-w-0">
                  {editingId === k.id ? (
                    <div className="flex gap-2 items-center">
                      <input
                        className="input text-sm h-8 flex-1"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleRename(k.id)}
                        autoFocus
                      />
                      <button onClick={() => handleRename(k.id)} className="text-accent-green hover:opacity-80">
                        <Save size={14} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-text-tertiary hover:text-text-primary">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-medium text-text-primary">{k.name}</div>
                      <div className="text-xs text-text-tertiary font-mono mt-0.5">{k.plainKey || k.maskedKey}</div>
                    </>
                  )}
                </div>
                <div className="text-xs text-text-tertiary whitespace-nowrap">
                  {new Date(k.createdAt).toLocaleDateString()}
                </div>
                {editingId !== k.id && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => copyKey(k.id, k.plainKey || k.maskedKey)}
                      className="btn-ghost h-7 w-7 p-0"
                      title="Copy"
                    >
                      {copiedId === k.id ? <Check size={13} className="text-accent-green" /> : <Copy size={13} />}
                    </button>
                    <button
                      onClick={() => { setEditingId(k.id); setEditName(k.name); }}
                      className="btn-ghost h-7 w-7 p-0"
                      title="Rename"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(k.id)}
                      className="btn-ghost h-7 w-7 p-0 hover:text-accent-red"
                      title="Delete"
                    >
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
