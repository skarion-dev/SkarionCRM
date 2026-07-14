import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEmployee, updateEmployee, deleteEmployee, listTimeOff } from '../api.js';
import { useAuthStore } from '../stores/auth.js';
import { useToastStore } from '../stores/toast.js';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  intern: 'Intern',
};

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const user = useAuthStore((s) => s.user);

  const isPrivileged = user?.isSuperadmin || user?.role === 'manager';

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const { data: empData, isLoading: empLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => getEmployee(id!),
    enabled: !!id,
  });

  const { data: timeOffData, isLoading: timeOffLoading } = useQuery({
    queryKey: ['timeOff', 'employee', id],
    queryFn: () => listTimeOff(undefined, id),
    enabled: !!id,
  });

  const updateMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateEmployee(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', id] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      setEditing(false);
      addToast('Employee updated', 'success');
    },
    onError: (e: Error) => addToast(e.message, 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteEmployee(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      addToast('Employee deleted', 'success');
      navigate('/employees');
    },
    onError: (e: Error) => addToast(e.message, 'error'),
  });

  if (empLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  const employee = empData?.employee;
  if (!employee) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/employees')}
          className="flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700"
        >
          <ArrowLeft size={16} /> Back to Employees
        </button>
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
          Employee not found
        </div>
      </div>
    );
  }

  const startEdit = () => {
    setForm({
      employeeNumber: employee.employeeNumber ?? '',
      position: employee.position ?? '',
      departmentId: employee.departmentId ?? '',
      hireDate: employee.hireDate ?? '',
      salary: employee.salary?.toString() ?? '',
      salaryCurrency: employee.salaryCurrency ?? 'USD',
      employmentType: employee.employmentType ?? 'full_time',
      emergencyContact:
        typeof employee.emergencyContact === 'string' ? (employee.emergencyContact as string) : '',
    });
    setEditing(true);
  };

  const handleSave = () => {
    const data: Record<string, unknown> = {};
    if (form.employeeNumber !== undefined) data.employeeNumber = form.employeeNumber || null;
    if (form.position !== undefined) data.position = form.position || null;
    if (form.departmentId !== undefined) data.departmentId = form.departmentId || null;
    if (form.hireDate !== undefined) data.hireDate = form.hireDate || null;
    if (form.salary !== undefined) data.salary = form.salary ? Number(form.salary) : null;
    if (form.salaryCurrency !== undefined) data.salaryCurrency = form.salaryCurrency;
    if (form.employmentType !== undefined) data.employmentType = form.employmentType;
    if (form.emergencyContact !== undefined) data.emergencyContact = form.emergencyContact || null;
    updateMut.mutate(data);
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-700',
      approved: 'bg-green-100 text-green-700',
      rejected: 'bg-red-100 text-red-700',
      cancelled: 'bg-slate-100 text-slate-600',
    };
    return (
      <span
        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[s] || ''}`}
      >
        {s}
      </span>
    );
  };

  const typeLabel = (t: string) => t.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const timeOffRequests = timeOffData?.timeOffRequests ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/employees')}
          className="flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700"
        >
          <ArrowLeft size={16} /> Back to Employees
        </button>
        <button
          onClick={() => {
            if (confirm('Delete this employee?')) deleteMut.mutate();
          }}
          className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700"
        >
          <Trash2 size={16} /> Delete
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">
          {employee.employeeNumber ?? 'Employee'} — {employee.position ?? 'No position'}
        </h1>

        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  Employee Number
                </label>
                <input
                  type="text"
                  value={form.employeeNumber}
                  onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">Position</label>
                <input
                  type="text"
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  Department ID
                </label>
                <input
                  type="text"
                  value={form.departmentId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">Hire Date</label>
                <input
                  type="date"
                  value={form.hireDate}
                  onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  Employment Type
                </label>
                <select
                  value={form.employmentType}
                  onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full"
                >
                  <option value="full_time">Full Time</option>
                  <option value="part_time">Part Time</option>
                  <option value="contract">Contract</option>
                  <option value="intern">Intern</option>
                </select>
              </div>
              {isPrivileged && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">Salary</label>
                    <input
                      type="number"
                      value={form.salary}
                      onChange={(e) => setForm({ ...form, salary: e.target.value })}
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">
                      Currency
                    </label>
                    <select
                      value={form.salaryCurrency}
                      onChange={(e) => setForm({ ...form, salaryCurrency: e.target.value })}
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full"
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="AED">AED</option>
                    </select>
                  </div>
                </>
              )}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  Emergency Contact
                </label>
                <input
                  type="text"
                  value={form.emergencyContact}
                  onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full max-w-md"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={updateMut.isPending}
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
              <Field label="Employee Number" value={employee.employeeNumber ?? '—'} />
              <Field label="Position" value={employee.position ?? '—'} />
              <Field label="Department ID" value={employee.departmentId ?? '—'} />
              <Field label="Hire Date" value={employee.hireDate ?? '—'} />
              <Field
                label="Employment Type"
                value={EMPLOYMENT_TYPE_LABELS[employee.employmentType] ?? employee.employmentType}
              />
              {isPrivileged && (
                <Field
                  label="Salary"
                  value={
                    employee.salary
                      ? `${employee.salaryCurrency} ${employee.salary.toLocaleString()}`
                      : '—'
                  }
                />
              )}
              <Field
                label="Emergency Contact"
                value={
                  typeof employee.emergencyContact === 'string'
                    ? (employee.emergencyContact as string)
                    : '—'
                }
              />
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
          <h2 className="font-semibold text-slate-900">Time-Off History</h2>
        </div>
        {timeOffLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-slate-400" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-6 py-3 font-medium text-slate-500">Type</th>
                <th className="px-6 py-3 font-medium text-slate-500">Dates</th>
                <th className="px-6 py-3 font-medium text-slate-500">Status</th>
                <th className="px-6 py-3 font-medium text-slate-500">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {timeOffRequests.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3 font-medium">{typeLabel(r.type)}</td>
                  <td className="px-6 py-3 text-slate-500">
                    {r.startDate} → {r.endDate}
                  </td>
                  <td className="px-6 py-3">{statusBadge(r.status)}</td>
                  <td className="px-6 py-3 text-slate-500">{r.reason ?? '—'}</td>
                </tr>
              ))}
              {timeOffRequests.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-400">
                    No time-off requests
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
