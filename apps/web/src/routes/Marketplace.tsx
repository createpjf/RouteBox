import { useState, useEffect } from "react";
import { Search, ArrowUpDown, Zap, Shield, Clock } from "lucide-react";
import * as api from "@/lib/api";

const PROVIDERS = ["All", "OpenAI", "Anthropic", "Google", "DeepSeek", "MiniMax", "Kimi"];
const SORT_OPTIONS = [
  { value: "price" as const, label: "Lowest Price" },
  { value: "latency" as const, label: "Fastest" },
  { value: "rating" as const, label: "Most Reliable" },
];

export function Marketplace() {
  const [listings, setListings] = useState<api.MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("All");
  const [modelFilter, setModelFilter] = useState("");
  const [sort, setSort] = useState<"price" | "latency" | "rating">("price");

  useEffect(() => {
    setLoading(true);
    api.getMarketplaceListings({
      provider: provider === "All" ? undefined : provider,
      model: modelFilter || undefined,
      sort,
    })
      .then((res) => setListings(res.listings))
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, [provider, sort, modelFilter]);

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Marketplace</h1>
        <p className="text-text-secondary mt-1">
          Browse shared API keys from other users. Requests are automatically routed to the best available provider.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Provider filter */}
        <div className="flex gap-1 bg-bg-card border border-border rounded-lg p-1">
          {PROVIDERS.map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                provider === p
                  ? "bg-accent-ember text-white"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Model search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            className="input pl-9 h-9 text-sm"
            placeholder="Filter by model..."
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
          />
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <ArrowUpDown size={14} className="text-text-tertiary" />
          <select
            className="input h-9 text-sm w-auto pr-8"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Listings */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-48 skeleton rounded-2xl" />)}
        </div>
      ) : listings.length === 0 ? (
        <div className="glass-card-static p-12 text-center">
          <Store size={48} className="mx-auto text-text-tertiary mb-4" />
          <p className="text-text-secondary">No listings found. Be the first to share your API keys!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {listings.map((listing) => (
            <div key={listing.id} className="glass-card-static p-5 flex flex-col">
              {/* Provider badge */}
              <div className="flex items-center justify-between mb-3">
                <span className="badge bg-accent-blue/15 text-accent-blue">{listing.providerName}</span>
                {listing.ownerDisplayName && (
                  <span className="text-xs text-text-tertiary">by {listing.ownerDisplayName}</span>
                )}
              </div>

              {/* Models */}
              <div className="flex flex-wrap gap-1 mb-3">
                {listing.models.slice(0, 4).map((m) => (
                  <span key={m} className="text-xs font-mono bg-bg-elevated px-2 py-0.5 rounded text-text-secondary">
                    {m}
                  </span>
                ))}
                {listing.models.length > 4 && (
                  <span className="text-xs text-text-tertiary">+{listing.models.length - 4} more</span>
                )}
              </div>

              {/* Description */}
              {listing.description && (
                <p className="text-sm text-text-secondary mb-3 line-clamp-2">{listing.description}</p>
              )}

              {/* Stats */}
              <div className="mt-auto pt-3 border-t border-border-light grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="flex items-center justify-center gap-1 text-xs text-text-tertiary mb-0.5">
                    <Zap size={10} /> Price
                  </div>
                  <div className="text-xs font-medium text-text-primary">
                    ${listing.priceInputPerM.toFixed(2)}/M
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-center gap-1 text-xs text-text-tertiary mb-0.5">
                    <Clock size={10} /> Latency
                  </div>
                  <div className="text-xs font-medium text-text-primary">
                    {listing.avgLatencyMs ? `${listing.avgLatencyMs}ms` : "—"}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-center gap-1 text-xs text-text-tertiary mb-0.5">
                    <Shield size={10} /> Uptime
                  </div>
                  <div className="text-xs font-medium text-accent-green">
                    {listing.successRate.toFixed(0)}%
                  </div>
                </div>
              </div>

              {/* Served count */}
              <div className="text-xs text-text-tertiary text-center mt-2">
                {listing.totalServed.toLocaleString()} requests served
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Store({ size, className }: { size: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" /><path d="M2 7h20" /><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" />
    </svg>
  );
}
