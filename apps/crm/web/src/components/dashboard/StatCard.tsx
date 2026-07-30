import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export interface TrendData {
  value: number;
  label: string;
}

export function StatCard({
  icon: Icon,
  label,
  value,
  trend,
}: {
  icon: React.ComponentType<{ size: number; className?: string }>;
  label: string;
  value: string;
  trend?: TrendData;
}) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="p-2 bg-slate-100 rounded-md">
          <Icon size={18} className="text-slate-600" />
        </div>
        {trend && (
          <span
            className={cn(
              'text-xs font-medium flex items-center gap-0.5',
              trend.value >= 0 ? 'text-green-600' : 'text-red-600'
            )}
          >
            {trend.value >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {trend.label}
          </span>
        )}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-slate-500 text-sm">{label}</div>
    </div>
  );
}
