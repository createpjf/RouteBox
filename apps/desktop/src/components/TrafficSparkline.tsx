import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import type { TrafficPoint } from "@/types/stats";

interface TrafficSparklineProps {
  data: TrafficPoint[];
}

export function TrafficSparkline({ data }: TrafficSparklineProps) {
  const hasTraffic = data.some((d) => d.value > 0);

  return (
    <div className="glass-card-static rounded-xl p-3">
      <h3 className="section-header">Traffic</h3>
      {!hasTraffic ? (
        <div className="flex items-center justify-center h-[48px]">
          <p className="text-[11px] text-text-tertiary">No traffic yet</p>
        </div>
      ) : (
      <ResponsiveContainer width="100%" height={48}>
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id="trafficGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Tooltip
            contentStyle={{
              background: "rgba(30, 30, 34, 0.92)",
              border: "0.5px solid rgba(255,255,255,0.12)",
              borderRadius: "8px",
              fontSize: "11px",
              fontFamily: "var(--font-sans)",
              color: "rgba(255,255,255,0.9)",
              padding: "4px 8px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            }}
            labelStyle={{ display: "none" }}
            formatter={(value: number) => [`${value} req/min`, ""]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#3B82F6"
            fill="url(#trafficGrad)"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: "#3B82F6", strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}
