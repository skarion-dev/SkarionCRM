import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTasks, useDeleteEntity, useClaimTask } from '../hooks/use-api.js';
import { useAuthStore } from '../stores/auth.js';
import {
  CheckSquare,
  Plus,
  Search,
  Trash2,
  CheckCircle2,
  Circle,
  Pencil,
  BellRing,
  Hand,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { crmFetch } from '../api.js';
import TaskForm from '../components/forms/TaskForm.js';
import type { Task } from '../api.js';
import { showToast } from '../stores/toast.js';

function TaskCard({
  task,
  claimable,
  claiming,
  onToggleComplete,
  onClaim,
  onEdit,
  onDelete,
}: {
  task: Task;
  claimable: boolean;
  claiming: boolean;
  onToggleComplete: (task: Task) => void;
  onClaim: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  return (
    <div
      className={cn(
        'bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-3 hover:shadow-sm transition-shadow',
        task.completedAt && 'opacity-60'
      )}
    >
      <button onClick={() => onToggleComplete(task)} className="shrink-0">
        {task.completedAt ? (
          <CheckCircle2 size={20} className="text-green-500" />
        ) : (
          <Circle size={20} className="text-slate-300 hover:text-slate-500" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className={cn('text-sm font-medium', task.completedAt && 'line-through text-slate-400')}
        >
          {task.leadId ? (
            <Link to={`/leads/${task.leadId}`} className="text-blue-600 hover:underline">
              {task.title}
            </Link>
          ) : (
            task.title
          )}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {task.description ?? 'No description'}
          {task.dueDate && ` · Due ${new Date(task.dueDate).toLocaleDateString()}`}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'px-2 py-0.5 rounded text-xs font-medium',
            task.priority === 'high'
              ? 'bg-red-100 text-red-700'
              : task.priority === 'medium'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-blue-100 text-blue-700'
          )}
        >
          {task.priority}
        </span>
        {claimable && (
          <button
            onClick={() => onClaim(task)}
            disabled={claiming}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Hand size={12} /> Claim
          </button>
        )}
        <button
          onClick={() => onEdit(task)}
          className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => onDelete(task)}
          className="p-1.5 rounded hover:bg-red-100 text-red-500"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function TaskColumn({
  title,
  tasksInColumn,
  claimable,
  claiming,
  onToggleComplete,
  onClaim,
  onEdit,
  onDelete,
}: {
  title: string;
  tasksInColumn: Task[];
  claimable: boolean;
  claiming: boolean;
  onToggleComplete: (task: Task) => void;
  onClaim: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  return (
    <div className="flex-1 min-w-[280px] space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 px-1">
        {title} ({tasksInColumn.length})
      </h2>
      <div className="space-y-2">
        {tasksInColumn.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            claimable={claimable}
            claiming={claiming}
            onToggleComplete={onToggleComplete}
            onClaim={onClaim}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
        {tasksInColumn.length === 0 && (
          <div className="text-center text-slate-300 text-sm py-8 border border-dashed border-slate-200 rounded-lg">
            Nothing here
          </div>
        )}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { data, isLoading, refetch } = useTasks();
  const deleteMutation = useDeleteEntity();
  const claimMutation = useClaimTask();
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const isSuperadmin = useAuthStore((s) => s.user?.isSuperadmin ?? false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'completed'>('all');
  const [followupsOnly, setFollowupsOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);

  const openCreate = () => {
    setEditTask(null);
    setModalOpen(true);
  };
  const openEdit = (task: Task) => {
    setEditTask(task);
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setEditTask(null);
  };

  const tasks = data?.tasks.filter((t) => !t.deletedAt) ?? [];
  const filtered = tasks.filter((t) => {
    const matchesSearch = !search || t.title.toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === 'all' || (filter === 'open' ? !t.completedAt : !!t.completedAt);
    const matchesFollowup = !followupsOnly || (t.type ?? '').startsWith('outreach_followup');
    return matchesSearch && matchesFilter && matchesFollowup;
  });

  // Open-claim board: Unclaimed (anyone can pick it up), Mine, and — since
  // the backend only sends non-superadmins their own + unassigned tasks in
  // the first place — Team's is only ever populated for a superadmin, who
  // sees everyone's.
  const unclaimed = filtered.filter((t) => !t.assigneeId);
  const mine = filtered.filter((t) => t.assigneeId === currentUserId);
  const teams = filtered.filter((t) => t.assigneeId && t.assigneeId !== currentUserId);

  const toggleComplete = async (task: Task) => {
    if (task.completedAt) {
      await crmFetch(`/api/tasks/${task.id}/reopen`, { method: 'PUT' });
    } else {
      await crmFetch(`/api/tasks/${task.id}/complete`, { method: 'PUT' });
    }
    refetch();
  };

  const handleClaim = (task: Task) => {
    claimMutation.mutate(task.id, {
      onSuccess: () => showToast('Task claimed', 'success'),
      onError: (err) =>
        showToast(err instanceof Error ? err.message : 'Already claimed by someone else', 'error'),
    });
  };

  const handleDelete = (task: Task) => deleteMutation.mutate({ type: 'tasks', id: task.id });

  if (isLoading) return <div className="text-slate-500">Loading tasks...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckSquare size={20} className="text-slate-600" />
          <h1 className="text-xl font-semibold">Tasks</h1>
          <span className="text-sm text-slate-500">({filtered.length})</span>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
        >
          <Plus size={16} /> Add Task
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['all', 'open', 'completed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm border capitalize',
              filter === f
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white border-slate-200 hover:bg-slate-50'
            )}
          >
            {f} (
            {f === 'all'
              ? tasks.length
              : tasks.filter((t) => (f === 'open' ? !t.completedAt : !!t.completedAt)).length}
            )
          </button>
        ))}
        <button
          onClick={() => setFollowupsOnly((v) => !v)}
          className={cn(
            'px-3 py-1.5 rounded-md text-sm border flex items-center gap-1',
            followupsOnly
              ? 'bg-amber-600 text-white border-amber-600'
              : 'bg-white border-slate-200 hover:bg-slate-50'
          )}
        >
          <BellRing size={14} /> Outreach Follow-ups Only
        </button>
      </div>

      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-md px-3 py-2">
        <Search size={16} className="text-slate-400" />
        <input
          type="text"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-sm outline-none"
        />
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <TaskColumn
          title="Unclaimed"
          tasksInColumn={unclaimed}
          claimable
          claiming={claimMutation.isPending}
          onToggleComplete={toggleComplete}
          onClaim={handleClaim}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
        <TaskColumn
          title="Mine"
          tasksInColumn={mine}
          claimable={false}
          claiming={claimMutation.isPending}
          onToggleComplete={toggleComplete}
          onClaim={handleClaim}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
        {isSuperadmin && (
          <TaskColumn
            title="Team's"
            tasksInColumn={teams}
            claimable={false}
            claiming={claimMutation.isPending}
            onToggleComplete={toggleComplete}
            onClaim={handleClaim}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        )}
      </div>

      <TaskForm open={modalOpen} onClose={closeModal} task={editTask} />
    </div>
  );
}
