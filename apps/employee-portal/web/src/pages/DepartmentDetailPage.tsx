import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDepartment, updateDepartment, deleteDepartment, listEmployees } from '../api.js';
import { useToastStore } from '../stores/toast.js';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';

export default function DepartmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });

  const { data: deptData, isLoading: deptLoading } = useQuery({
    queryKey: ['department', id],
    queryFn: () => getDepartment(id!),
    enabled: !!id,
  });

  const { data: empData, isLoading: empLoading } = useQuery({
    queryKey: ['employees', 'department', id],
    queryFn: () => listEmployees(undefined, id),
    enabled: !!id,
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateDepartment(id!, { name: form.name, description: form.description || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['department', id] });
      qc.invalidateQueries({ queryKey: ['departments'] });
      setEditing(false);
      addToast('Department updated', 'success');
    },
    onError: (e: Error) => addToast(e.message, 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteDepartment(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      addToast('Department deleted', 'success');
      navigate('/departments');
    },
    onError: (e: Error) => addToast(e.message, 'error'),
  });

  if (deptLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  const department = deptData?.department;
  if (!department) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/departments')}
          className="flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700"
        >
          <ArrowLeft size={16} /> Back to Departments
        </button>
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
          Department not found
        </div>
      </div>
    );
  }

  const employees = empData?.employees ?? [];

  const startEdit = () => {
    setForm({ name: department.name, description: department.description ?? '' });
    setEditing(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/departments')}
          className="flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700"
        >
          <ArrowLeft size={16} /> Back to Departments
        </button>
        <button
          onClick={() => {
            if (confirm('Delete this department?')) deleteMut.mutate();
          }}
          className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700"
        >
          <Trash2 size={16} /> Delete
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">{department.name}</h1>

        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full max-w-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full max-w-md"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => updateMut.mutate()}
                disabled={!form.name || updateMut.isPending}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50"
              >
                {updateMut.isPending ? <Loader2 size={16} className="animate-spin" /> : 'Save'}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="border border-slate-200 px-4 py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Description" value={department.description ?? '—'} />
              <Field label="Manager User ID" value={department.managerUserId ?? '—'} />
              <Field label="Parent Department ID" value={department.parentId ?? '—'} />
            </div>
            <button
              onClick={startEdit}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Employees in this Department</h2>
        </div>
        {empLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-slate-400" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-6 py-3 font-medium text-slate-500">Employee #</th>
                <th className="px-6 py-3 font-medium text-slate-500">Position</th>
                <th className="px-6 py-3 font-medium text-slate-500">Hire Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((e) => (
                <tr
                  key={e.id}
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => navigate(`/employees/${e.id}`)}
                >
                  <td className="px-6 py-3 font-medium">{e.employeeNumber ?? '—'}</td>
                  <td className="px-6 py-3">{e.position ?? '—'}</td>
                  <td className="px-6 py-3 text-slate-500">{e.hireDate ?? '—'}</td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-slate-400">
                    No employees in this department
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm text-slate-900 mt-0.5">{value}</div>
    </div>
  );
}
