import { Activity } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import type { TrafficPoint } from "@/types/stats";

interface TrafficSparklineProps {
  data: TrafficPoint[];
}

export function TrafficSparkline({ data }: TrafficSparklineProps) {
  const hasTraffic = data.some((d) => d.value > 0);
  const peak = hasTraffic ? Math.max(...data.map((d) => d.value)) : 0;

  return (
    <div className="glass-card-static p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={13} strokeWidth={1.75} className="text-[#AEAEB2]" />
          <span className="text-[11px] font-medium text-[#86868B] tracking-[0.03em]">
            Traffic (30 min)
          </span>
        </div>
        {hasTraffic && (
          <span className="text-[11px] text-[#C7C7CC]">
            Peak: {peak} req/s
          </span>
        )}
      </div>
      {!hasTraffic ? (
        <div className="flex items-center justify-center h-[50px]">
          <p className="text-[11px] text-text-tertiary">No traffic yet</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={50}>
          <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
            <defs>
              <linearGradient id="trafficGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1D1D1F" stopOpacity={0.06} />
                <stop offset="100%" stopColor="#1D1D1F" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip
              contentStyle={{
                background: "#FFFFFF",
                border: "0.5px solid rgba(0, 0, 0, 0.08)",
                borderRadius: "8px",
                fontSize: "11px",
                fontFamily: "var(--font-sans)",
                color: "#1D1D1F",
                padding: "4px 8px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              }}
              labelStyle={{ display: "none" }}
              formatter={(value: number) => [`${value} req/min`, ""]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="rgba(29,29,31,0.5)"
              fill="url(#trafficGrad)"
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 3, fill: "#1D1D1F", strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
