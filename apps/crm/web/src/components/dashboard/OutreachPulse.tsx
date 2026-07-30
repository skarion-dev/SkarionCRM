import type { DashboardSummary } from '../../api.js';
import { MessageSquare } from 'lucide-react';

export function OutreachPulse({ summary }: { summary: DashboardSummary }) {
  const t = summary.totals;
  const rows = summary.recentLinkedinConversations;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <MessageSquare size={16} className="text-blue-500" /> Outreach Pulse
      </h2>
      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        <div>
          <div className="text-xl font-semibold">{t.linkedinConversations}</div>
          <div className="text-slate-500 text-xs">Conversations</div>
        </div>
        <div>
          <div className="text-xl font-semibold">{t.linkedinMessages}</div>
          <div className="text-slate-500 text-xs">Messages</div>
        </div>
        <div>
          <div className="text-xl font-semibold">{t.leadsWithLinkedinConversations}</div>
          <div className="text-slate-500 text-xs">Leads reached</div>
        </div>
      </div>
      {t.lastLinkedinMessageAt && (
        <p className="text-xs text-slate-400 mb-3">
          Last message {new Date(t.lastLinkedinMessageAt).toLocaleDateString()}
        </p>
      )}
      {rows.length ? (
        <div className="space-y-2">
          {rows.slice(0, 5).map((row, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-2 hover:bg-slate-50 rounded"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{row.leadName}</div>
                <div className="text-slate-500 text-xs truncate">
                  {row.messageCount} msg{row.messageCount === 1 ? '' : 's'} ·{' '}
                  {row.lastMessageFromUs ? 'awaiting reply' : 'they replied'}
                </div>
              </div>
              <span className="text-xs text-slate-400">
                {new Date(row.lastMessageAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-slate-400 text-sm text-center py-6">No LinkedIn conversations yet</div>
      )}
    </div>
  );
}
