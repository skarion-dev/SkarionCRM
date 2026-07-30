import type { DashboardSummary } from '../../api.js';
import { useNavigate } from 'react-router-dom';

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-blue-500',
};

export function MyTasksCard({ summary }: { summary: DashboardSummary }) {
  const navigate = useNavigate();
  const mine = summary.mine;
  const tasks = mine.tasks;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">My Tasks</h2>
        <button
          onClick={() => navigate('/tasks')}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
        >
          Open task board →
        </button>
      </div>
      <div className="flex gap-4 mb-4 text-sm">
        <div>
          <span className="text-slate-500">Open </span>
          <span className="font-semibold">{mine.openTasks}</span>
        </div>
        {mine.dueTodayTasks > 0 && (
          <div>
            <span className="text-amber-600">Due today </span>
            <span className="font-semibold text-amber-700">{mine.dueTodayTasks}</span>
          </div>
        )}
        {mine.overdueTasks > 0 && (
          <div>
            <span className="text-red-600">Overdue </span>
            <span className="font-semibold text-red-700">{mine.overdueTasks}</span>
          </div>
        )}
      </div>
      {tasks.length ? (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => navigate('/tasks')}
              className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded cursor-pointer"
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-blue-500'}`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{task.title}</div>
                <div className="text-xs text-slate-500">
                  {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-slate-400 text-sm text-center py-8">No open tasks assigned to you</div>
      )}
    </div>
  );
}
