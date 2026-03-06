import { Activity } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, Tooltip, Cell } from "recharts";
import type { TrafficPoint } from "@/types/stats";

interface TrafficSparklineProps {
  data: TrafficPoint[];
}

export function TrafficSparkline({ data }: TrafficSparklineProps) {
  const hasTraffic = data.some((d) => d.value > 0);
  const peak = hasTraffic ? Math.max(...data.map((d) => d.value)) : 0;

  return (
    <div className="glass-card-static p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity size={13} strokeWidth={1.75} className="text-[#AEAEB2]" />
          <span className="text-[11px] font-medium text-[#86868B] tracking-[0.03em]">
            Traffic (30 min)
          </span>
        </div>
        {hasTraffic && (
          <span className="text-[11px] text-[#C7C7CC]">
            Peak: {peak} req/min
          </span>
        )}
      </div>
      {!hasTraffic ? (
        <div className="flex items-center justify-center h-[56px]">
          <p className="text-[11px] text-text-tertiary">No traffic yet</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={56}>
          <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <Tooltip
              cursor={{ fill: "rgba(0,0,0,0.03)", radius: 2 }}
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
            <Bar dataKey="value" radius={[2, 2, 0, 0]} maxBarSize={8}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.value > 0 ? "#1D1D1F" : "transparent"}
                  fillOpacity={entry.value > 0 ? 0.7 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
