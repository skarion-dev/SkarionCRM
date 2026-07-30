import type { DashboardSummary } from '../../api.js';
import { useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';

export function ProspectsPendingTile({ summary }: { summary: DashboardSummary }) {
  const navigate = useNavigate();
  const count = summary.prospectsPendingReview;

  return (
    <button
      onClick={() => navigate('/prospects')}
      className="text-left bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:border-blue-300 hover:shadow transition w-full"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="p-2 bg-amber-100 rounded-md">
          <UserPlus size={18} className="text-amber-600" />
        </div>
        <h3 className="font-medium text-sm">Prospects Pending Review</h3>
      </div>
      <div className="text-2xl font-semibold">{count}</div>
      <div className="text-slate-500 text-xs mt-1">
        {count === 0 ? 'Queue clear' : 'Open review queue →'}
      </div>
    </button>
  );
}
