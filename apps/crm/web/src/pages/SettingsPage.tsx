import { useEffect, useState, type FormEvent } from 'react';
import { useAuthStore, type AuthStore } from '../stores/auth.js';
import {
  useIntegrationStatus,
  useWorkflowRules,
  useCreateWorkflowRule,
  useUpdateWorkflowRule,
  useDeleteWorkflowRule,
  useAiConfig,
  useAiUsage,
  useUpdateAiConfig,
  useExtensionApiKeys,
  useCreateExtensionApiKey,
  useRevokeExtensionApiKey,
  useTags,
  useCreateTag,
  type AiRuntimeSettings,
  type AiUsagePeriod,
  type AiUsageResponse,
} from '../hooks/use-api.js';
import { CRM_API_URL } from '../api.js';
import {
  Settings,
  Users,
  Layers,
  Tag,
  Puzzle,
  User,
  CheckCircle,
  XCircle,
  Shield,
  Mail,
  FileText,
  Bot,
  Workflow,
  Plus,
  Trash2,
  Loader2,
  Clock,
  KeyRound,
  Save,
  Zap,
  Copy,
  Activity,
  Coins,
  Gauge,
  BarChart3,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'pipelines', label: 'Pipelines', icon: Layers },
  { id: 'tags', label: 'Tags', icon: Tag },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'ai', label: 'AI & Agents', icon: Bot },
  { id: 'extension-keys', label: 'Extension Keys', icon: KeyRound },
  { id: 'integrations', label: 'Integrations', icon: Puzzle },
] as const;

type TabId = (typeof TABS)[number]['id'];

const PIPELINE_STAGES = [
  { name: 'Prospecting', description: 'Initial contact and discovery', probability: 10 },
  { name: 'Qualification', description: 'Assess fit and budget', probability: 25 },
  { name: 'Proposal', description: 'Present solution and pricing', probability: 50 },
  { name: 'Negotiation', description: 'Terms and final details', probability: 75 },
  { name: 'Closed Won', description: 'Deal signed and won', probability: 100 },
  { name: 'Closed Lost', description: 'Deal lost or abandoned', probability: 0 },
];

export default function SettingsPage() {
  const role = useAuthStore((s: AuthStore) => s.user?.role ?? '');
  const user = useAuthStore((s: AuthStore) => s.user);
  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const { data: integrationData } = useIntegrationStatus();

  const canManage = role === 'manager' || Boolean(user?.isSuperadmin);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-2">
        <Settings size={20} className="text-slate-600" />
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const disabled =
              tab.id === 'extension-keys'
                ? !user?.isSuperadmin
                : tab.id !== 'profile' && !canManage;
            return (
              <button
                key={tab.id}
                onClick={() => !disabled && setActiveTab(tab.id)}
                disabled={disabled}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                  disabled &&
                    'opacity-40 cursor-not-allowed hover:text-slate-500 hover:border-transparent'
                )}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <User size={18} className="text-slate-500" /> My Profile
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Name
                </label>
                <div className="mt-1 text-sm font-medium">{user?.name ?? '—'}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Email
                </label>
                <div className="mt-1 text-sm font-medium">{user?.email ?? '—'}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Role
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="capitalize text-sm font-medium">{role || '—'}</span>
                  {role === 'manager' && <Shield size={14} className="text-blue-500" />}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  User ID
                </label>
                <div className="mt-1 text-sm font-mono text-slate-600 bg-slate-50 rounded px-2 py-1">
                  {user?.id ?? '—'}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Superadmin
                </label>
                <div className="mt-1 text-sm">{user?.isSuperadmin ? 'Yes' : 'No'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team Tab */}
      {activeTab === 'team' && canManage && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Users size={18} className="text-slate-500" /> Team
          </h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
              <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">
                {user?.name?.charAt(0) ?? user?.email?.charAt(0) ?? '?'}
              </div>
              <div>
                <div className="text-sm font-medium">{user?.name ?? user?.email ?? 'You'}</div>
                <div className="text-xs text-slate-500 capitalize">
                  {role} {user?.isSuperadmin && '· Superadmin'}
                </div>
              </div>
              <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">
                You
              </span>
            </div>
            <p className="text-sm text-slate-500">
              Team management is available for managers. Contact your superadmin to add or remove
              team members.
            </p>
          </div>
        </div>
      )}

      {/* Pipelines Tab */}
      {activeTab === 'pipelines' && canManage && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Layers size={18} className="text-slate-500" /> Opportunity Stages
          </h2>
          <div className="space-y-3">
            {PIPELINE_STAGES.map((stage, index) => (
              <div
                key={stage.name}
                className="flex items-center gap-4 p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{stage.name}</div>
                  <div className="text-xs text-slate-500">{stage.description}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-slate-700">{stage.probability}%</div>
                  <div className="text-xs text-slate-400">Probability</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-500 mt-4">
            Pipeline stages are read-only for now. Contact your administrator to customize stages.
          </p>
        </div>
      )}

      {/* Tags Tab */}
      {activeTab === 'tags' && canManage && <TagsPanel />}

      {/* Workflows Tab */}
      {activeTab === 'workflows' && canManage && <WorkflowRulesPanel />}

      {/* AI & Agents Tab */}
      {activeTab === 'ai' && canManage && <AiControlPanel />}

      {/* Extension Keys Tab */}
      {activeTab === 'extension-keys' && user?.isSuperadmin && (
        <ExtensionKeysPanel defaultEmail={user.email} />
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && canManage && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Puzzle size={18} className="text-slate-500" /> Integrations
          </h2>
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 rounded-lg border border-slate-100">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <Bot size={18} className="text-blue-600" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">AI Integration (Vertex proxy)</div>
                <div className="text-xs text-slate-500">
                  Default managed key and task-aware model routing
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {integrationData?.aiGateway ? (
                  <>
                    <CheckCircle size={16} className="text-green-500" />
                    <span className="text-xs font-medium text-green-600">Connected</span>
                  </>
                ) : (
                  <>
                    <XCircle size={16} className="text-red-500" />
                    <span className="text-xs font-medium text-red-600">Not configured</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 p-4 rounded-lg border border-slate-100">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <FileText size={18} className="text-amber-600" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">Document Converter</div>
                <div className="text-xs text-slate-500">PDF and document import processing</div>
              </div>
              <div className="flex items-center gap-1.5">
                {integrationData?.documentConverter ? (
                  <>
                    <CheckCircle size={16} className="text-green-500" />
                    <span className="text-xs font-medium text-green-600">Active</span>
                  </>
                ) : (
                  <>
                    <XCircle size={16} className="text-red-500" />
                    <span className="text-xs font-medium text-red-600">Inactive</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 p-4 rounded-lg border border-slate-100">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <Mail size={18} className="text-emerald-600" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">Email (Resend)</div>
                <div className="text-xs text-slate-500">Transactional email sending</div>
              </div>
              <div className="flex items-center gap-1.5">
                {integrationData?.resendConfigured ? (
                  <>
                    <CheckCircle size={16} className="text-green-500" />
                    <span className="text-xs font-medium text-green-600">Connected</span>
                  </>
                ) : (
                  <>
                    <XCircle size={16} className="text-red-500" />
                    <span className="text-xs font-medium text-red-600">Not configured</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TAG_COLOR_CLASSES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700',
  red: 'bg-red-100 text-red-700',
  amber: 'bg-amber-100 text-amber-700',
  green: 'bg-green-100 text-green-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  blue: 'bg-blue-100 text-blue-700',
  violet: 'bg-violet-100 text-violet-700',
  pink: 'bg-pink-100 text-pink-700',
  cyan: 'bg-cyan-100 text-cyan-700',
};

function TagsPanel() {
  const { data, isLoading } = useTags();
  const createTag = useCreateTag();
  const [name, setName] = useState('');
  const [color, setColor] = useState('slate');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    createTag.mutate(
      { name: trimmedName, color },
      {
        onSuccess: () => setName(''),
      }
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
      <div>
        <h2 className="font-semibold flex items-center gap-2">
          <Tag size={18} className="text-slate-500" /> Lead tags
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Tags hold flexible context such as campaign batches, source sheets, and lead traits. A
          lead can have any number of tags.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder="New tag name"
          className="flex-1 px-3 py-2 border border-slate-200 rounded-md text-sm"
        />
        <select
          value={color}
          onChange={(event) => setColor(event.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-md text-sm bg-white"
        >
          {Object.keys(TAG_COLOR_CLASSES).map((tagColor) => (
            <option key={tagColor} value={tagColor}>
              {tagColor.charAt(0).toUpperCase() + tagColor.slice(1)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!name.trim() || createTag.isPending}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium disabled:opacity-50"
        >
          {createTag.isPending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Plus size={15} />
          )}
          Create tag
        </button>
      </form>

      {createTag.error && (
        <p className="text-sm text-red-600">
          {createTag.error instanceof Error ? createTag.error.message : 'Could not create tag.'}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {isLoading && <Loader2 size={18} className="animate-spin text-slate-400" />}
        {data?.tags.map((tag) => (
          <span
            key={tag.id}
            title={tag.description ?? (tag.isSystem ? 'System tag' : 'Team tag')}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium',
              TAG_COLOR_CLASSES[tag.color] ?? TAG_COLOR_CLASSES.slate
            )}
          >
            {tag.name}
          </span>
        ))}
        {!isLoading && data?.tags.length === 0 && (
          <p className="text-sm text-slate-400">No tags yet. Create the first one above.</p>
        )}
      </div>
    </div>
  );
}

function ExtensionKeysPanel({ defaultEmail }: { defaultEmail: string }) {
  const { data: keys = [], isLoading, error } = useExtensionApiKeys();
  const createKey = useCreateExtensionApiKey();
  const revokeKey = useRevokeExtensionApiKey();
  const [email, setEmail] = useState(defaultEmail);
  const [label, setLabel] = useState('LinkedIn extension');
  const [newKey, setNewKey] = useState('');
  const [copied, setCopied] = useState(false);

  async function copyForExtension() {
    await navigator.clipboard.writeText(JSON.stringify({ crmUrl: CRM_API_URL, apiKey: newKey }));
    setCopied(true);
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="font-semibold flex items-center gap-2">
          <KeyRound size={18} className="text-blue-600" /> LinkedIn Extension Keys
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          These keys authenticate the browser extension to Skarion CRM. AI provider credentials
          remain protected on the server and are selected under AI &amp; Agents.
        </p>

        {newKey && (
          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-900">
              Copy this key now—it will not be shown again.
            </div>
            <code className="block mt-2 rounded bg-white border border-amber-200 p-3 text-xs break-all">
              {newKey}
            </code>
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                onClick={() => void copyForExtension()}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                <Copy size={15} />
                {copied ? 'Copied for extension' : 'Copy for extension'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewKey('');
                  setCopied(false);
                }}
                className="border border-slate-200 px-4 py-2 rounded-lg text-sm"
              >
                Done
              </button>
            </div>
            <p className="text-xs text-amber-800 mt-2">
              In the extension, open ⚙ Settings and choose “Paste from admin panel.”
            </p>
          </div>
        )}

        <form
          className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end mt-5"
          onSubmit={(event) => {
            event.preventDefault();
            createKey.mutate(
              { email: email.trim(), label: label.trim() },
              {
                onSuccess: (result) => {
                  setNewKey(result.key);
                  setCopied(false);
                },
              }
            );
          }}
        >
          <label className="text-xs font-medium text-slate-500">
            Account email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="block mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 w-full"
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Key label
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              required
              className="block mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 w-full"
            />
          </label>
          <button
            type="submit"
            disabled={createKey.isPending}
            className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {createKey.isPending && <Loader2 size={15} className="animate-spin" />}
            Generate key
          </button>
        </form>

        {createKey.isError && (
          <p className="text-sm text-red-600 mt-3">
            {createKey.error instanceof Error ? createKey.error.message : 'Could not create key.'}
          </p>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="font-semibold">Issued keys</h3>
        </div>
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600">
            {error instanceof Error ? error.message : 'Could not load extension keys.'}
          </div>
        ) : keys.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No extension keys have been issued yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Label</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Last used</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">{key.email}</td>
                    <td className="px-4 py-3">{key.label}</td>
                    <td className="px-4 py-3">{new Date(key.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded-full',
                          key.revokedAt
                            ? 'bg-slate-100 text-slate-500'
                            : 'bg-green-100 text-green-700'
                        )}
                      >
                        {key.revokedAt ? 'Revoked' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!key.revokedAt && (
                        <button
                          type="button"
                          disabled={revokeKey.isPending}
                          onClick={() => {
                            if (
                              confirm(`Revoke “${key.label}”? The extension will stop working.`)
                            ) {
                              revokeKey.mutate(key.id);
                            }
                          }}
                          className="text-red-600 hover:text-red-700 text-sm font-medium disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value
  );
}

function formatEstimatedUsd(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function AiUsageDashboard({
  data,
  period,
  onPeriodChange,
  isLoading,
  hasError,
}: {
  data?: AiUsageResponse;
  period: AiUsagePeriod;
  onPeriodChange: (period: AiUsagePeriod) => void;
  isLoading: boolean;
  hasError: boolean;
}) {
  const maxSeriesTokens = Math.max(1, ...(data?.series.map((point) => point.tokens) ?? [1]));
  const periodOptions: Array<{ id: AiUsagePeriod; label: string }> = [
    { id: 'day', label: 'Daily' },
    { id: 'week', label: 'Weekly' },
    { id: 'month', label: 'Monthly' },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <BarChart3 size={18} className="text-emerald-600" /> Token &amp; Cost Analytics
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Rolling usage totals from every CRM agent and model.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 self-start">
          {periodOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onPeriodChange(option.id)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                period === option.id
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {hasError ? (
        <div className="mt-5 rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
          Usage analytics could not be loaded.
        </div>
      ) : isLoading || !data ? (
        <div className="h-48 flex items-center justify-center">
          <Loader2 className="animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
            {[
              {
                label: 'CRM-estimated cost',
                value: formatEstimatedUsd(data.totals.estimatedCostUsd),
                detail: `${data.label} · tracked inference only`,
                icon: Coins,
                tone: 'text-emerald-700 bg-emerald-50',
              },
              {
                label: 'Total tokens',
                value: formatTokenCount(data.totals.totalTokens),
                detail: `${formatTokenCount(data.totals.inputTokens)} in · ${formatTokenCount(data.totals.outputTokens)} visible out · ${formatTokenCount(data.totals.reasoningTokens)} thinking`,
                icon: Activity,
                tone: 'text-blue-700 bg-blue-50',
              },
              {
                label: 'AI requests',
                value: data.totals.requests.toLocaleString(),
                detail: `${data.totals.failedRequests} failed`,
                icon: Bot,
                tone: 'text-violet-700 bg-violet-50',
              },
              {
                label: 'Average latency',
                value:
                  data.totals.averageLatencyMs >= 1000
                    ? `${(data.totals.averageLatencyMs / 1000).toFixed(1)}s`
                    : `${data.totals.averageLatencyMs}ms`,
                detail: `${data.totals.providerMeasuredRequests} exact token reports`,
                icon: Gauge,
                tone: 'text-amber-700 bg-amber-50',
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-500">{card.label}</span>
                    <span className={cn('rounded-md p-1.5', card.tone)}>
                      <Icon size={15} />
                    </span>
                  </div>
                  <div className="text-xl font-semibold text-slate-900 mt-3">{card.value}</div>
                  <div className="text-[11px] text-slate-400 mt-1">{card.detail}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-medium text-slate-800">Token trend</div>
                <div className="text-xs text-slate-400">
                  {period === 'day' ? 'Hourly' : 'Daily'} token volume
                </div>
              </div>
              <div className="text-xs text-slate-500">{data.label}</div>
            </div>
            <div className="h-36 flex items-end gap-1">
              {data.series.map((point) => (
                <div
                  key={point.timestamp}
                  className="group relative flex-1 min-w-0 flex items-end h-full"
                  title={`${new Date(point.timestamp).toLocaleString()}: ${point.tokens.toLocaleString()} tokens · ${formatEstimatedUsd(point.estimatedCostUsd)}`}
                >
                  <div
                    className={cn(
                      'w-full rounded-t-sm transition-colors',
                      point.tokens ? 'bg-blue-500 group-hover:bg-blue-600' : 'bg-slate-100'
                    )}
                    style={{
                      height: point.tokens
                        ? `${Math.max(5, (point.tokens / maxSeriesTokens) * 100)}%`
                        : '3px',
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-2">
              <span>{new Date(data.range.start).toLocaleString()}</span>
              <span>{new Date(data.range.end).toLocaleString()}</span>
            </div>
          </div>

          {data.totals.requests === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center">
              <Bot size={24} className="mx-auto text-slate-300" />
              <div className="text-sm font-medium text-slate-600 mt-2">No tracked AI calls yet</div>
              <div className="text-xs text-slate-400 mt-1">
                New agent calls will appear here automatically.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
              {[
                { title: 'Cost by provider', rows: data.byProvider },
                { title: 'Cost by model', rows: data.byModel },
                { title: 'Usage by agent', rows: data.byAgent },
              ].map((section) => (
                <div
                  key={section.title}
                  className="rounded-lg border border-slate-200 overflow-hidden"
                >
                  <div className="px-4 py-3 bg-slate-50 text-sm font-medium text-slate-700">
                    {section.title}
                  </div>
                  <div className="divide-y divide-slate-100">
                    {section.rows.slice(0, 8).map((row) => (
                      <div
                        key={row.id}
                        className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 items-center"
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-slate-700 truncate" title={row.label}>
                            {row.label}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {row.requests} requests · {formatTokenCount(row.totalTokens)} tokens
                          </div>
                        </div>
                        <div className="text-sm font-medium text-slate-800">
                          {formatEstimatedUsd(row.estimatedCostUsd)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-slate-400 mt-4">
            CRM costs are inference estimates based on configured model list prices as of{' '}
            {data.pricingUpdatedAt}. Google Cloud Billing is authoritative and may also include
            other projects, Cloud Run, networking, legacy/direct API traffic, taxes, and
            adjustments. Provider token metadata is used when available; streaming or legacy calls
            without metadata use a character-based token estimate.
          </p>
        </>
      )}
    </div>
  );
}

function AiControlPanel() {
  const { data, isLoading, error } = useAiConfig();
  const updateConfig = useUpdateAiConfig();
  const [settings, setSettings] = useState<AiRuntimeSettings | null>(null);
  const [usagePeriod, setUsagePeriod] = useState<AiUsagePeriod>('week');
  const usageQuery = useAiUsage(usagePeriod);

  useEffect(() => {
    if (data) setSettings(data.settings);
  }, [data]);

  if (error) {
    return (
      <div className="bg-white border border-red-200 rounded-lg p-6 text-sm text-red-600">
        AI configuration could not be loaded.
      </div>
    );
  }

  if (isLoading || !settings || !data) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 flex justify-center">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }

  const setTierModel = (tier: 'reasoning' | 'fast' | 'cheap', model: string) => {
    setSettings({
      ...settings,
      tierModels: { ...settings.tierModels, [tier]: model },
    });
  };

  const setAgentModel = (agentId: string, model: string) => {
    const agentModels = { ...settings.agentModels };
    if (model) agentModels[agentId] = model;
    else delete agentModels[agentId];
    setSettings({ ...settings, agentModels });
  };

  return (
    <div className="space-y-5">
      <AiUsageDashboard
        data={usageQuery.data}
        period={usagePeriod}
        onPeriodChange={setUsagePeriod}
        isLoading={usageQuery.isLoading}
        hasError={Boolean(usageQuery.error)}
      />

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <KeyRound size={18} className="text-blue-600" /> AI API Key Manager
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Keys stay in deployment secrets. The browser only receives masked status.
            </p>
          </div>
          <label className="text-xs font-medium text-slate-500">
            Default provider
            <select
              value={settings.defaultProvider}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  defaultProvider: event.target.value as AiRuntimeSettings['defaultProvider'],
                })
              }
              className="block mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800"
            >
              {data.credentials.map((credential) => (
                <option key={credential.id} value={credential.id} disabled={!credential.configured}>
                  {credential.name}
                  {!credential.configured ? ' (not configured)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.credentials.map((credential) => (
            <div
              key={credential.id}
              className={cn(
                'rounded-lg border p-4',
                settings.defaultProvider === credential.id
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-slate-200'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-sm">{credential.name}</div>
                {credential.configured ? (
                  <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                    Connected
                  </span>
                ) : (
                  <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    Missing
                  </span>
                )}
              </div>
              <div className="font-mono text-xs text-slate-500 mt-3">
                {credential.maskedKey ?? 'No secret configured'}
              </div>
              <div className="text-xs text-slate-400 mt-1">{credential.source}</div>
              {credential.baseUrl && (
                <div className="text-xs text-slate-500 mt-2 truncate" title={credential.baseUrl}>
                  {credential.baseUrl}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="font-semibold flex items-center gap-2">
          <Zap size={18} className="text-amber-500" /> Model Routing Defaults
        </h2>
        <p className="text-sm text-slate-500 mt-1 mb-4">
          Cheap is the default for routine summaries and recommendations. Per-agent choices below
          override these tiers.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(['reasoning', 'fast', 'cheap'] as const).map((tier) => (
            <label key={tier} className="text-xs font-medium text-slate-500 capitalize">
              {tier} tasks
              <select
                value={settings.tierModels[tier]}
                onChange={(event) => setTierModel(tier, event.target.value)}
                className="block mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 w-full"
              >
                {data.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} · {model.costClass}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="font-semibold flex items-center gap-2">
          <Bot size={18} className="text-violet-600" /> AI Usage & Agents
        </h2>
        <p className="text-sm text-slate-500 mt-1 mb-4">
          Every current CRM AI workload is named here and can choose its own proxy model.
        </p>
        <div className="space-y-3">
          {data.agents.map((agent) => {
            const tierDefault =
              agent.tier === 'embedding'
                ? settings.tierModels.embedding
                : settings.tierModels[agent.tier];
            const selected = settings.agentModels[agent.id] ?? '';
            return (
              <div
                key={agent.id}
                className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-3 items-center border border-slate-100 rounded-lg p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{agent.name}</span>
                    <span
                      className={cn(
                        'text-[11px] px-2 py-0.5 rounded-full font-medium',
                        agent.tier === 'cheap'
                          ? 'bg-green-100 text-green-700'
                          : agent.tier === 'reasoning'
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-blue-100 text-blue-700'
                      )}
                    >
                      {agent.tier}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{agent.description}</div>
                </div>
                <select
                  value={selected}
                  onChange={(event) => setAgentModel(agent.id, event.target.value)}
                  disabled={agent.tier === 'embedding'}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 disabled:bg-slate-50"
                >
                  <option value="">Tier default · {tierDefault}</option>
                  {agent.tier !== 'embedding' &&
                    data.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label} · {model.costClass}
                      </option>
                    ))}
                </select>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-3 mt-5">
          {updateConfig.isSuccess && <span className="text-sm text-green-600">Saved</span>}
          {updateConfig.isError && (
            <span className="text-sm text-red-600">Could not save configuration</span>
          )}
          <button
            onClick={() => updateConfig.mutate(settings)}
            disabled={updateConfig.isPending}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {updateConfig.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Save size={15} />
            )}
            Save AI configuration
          </button>
        </div>
      </div>
    </div>
  );
}

const CHANNELS = ['linkedin', 'instagram', 'facebook', 'whatsapp', 'email', 'phone'] as const;

const DEFAULT_SEQUENCE_STEPS = [
  {
    afterDays: '7',
    title:
      'Soft bump — check in with {{lead.first_name}} {{lead.last_name}} ({{channel}}, step {{step}})',
  },
  {
    afterDays: '14',
    title:
      'Value-add follow-up for {{lead.first_name}} {{lead.last_name}} ({{channel}}, step {{step}})',
  },
  {
    afterDays: '21',
    title:
      'Final follow-up (breakup) for {{lead.first_name}} {{lead.last_name}} ({{channel}}, step {{step}})',
  },
];

function WorkflowRulesPanel() {
  const { data: rules, isLoading } = useWorkflowRules();
  const createMut = useCreateWorkflowRule();
  const updateMut = useUpdateWorkflowRule();
  const deleteMut = useDeleteWorkflowRule();
  const [showCreate, setShowCreate] = useState(false);
  const [ruleType, setRuleType] = useState<'escalate' | 'sequence'>('sequence');
  const [form, setForm] = useState({
    name: '',
    channel: 'linkedin',
    afterAttempts: '2',
    waitDays: '7',
    nextChannel: 'email',
  });
  const [sequenceChannel, setSequenceChannel] = useState<'all' | (typeof CHANNELS)[number]>('all');
  const [steps, setSteps] = useState(DEFAULT_SEQUENCE_STEPS.map((s) => ({ ...s })));

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }

  const staleRules = (rules ?? []).filter((r) => r.trigger === 'outreach_stale');

  const resetForm = () => {
    setForm({
      name: '',
      channel: 'linkedin',
      afterAttempts: '2',
      waitDays: '7',
      nextChannel: 'email',
    });
    setSequenceChannel('all');
    setSteps(DEFAULT_SEQUENCE_STEPS.map((s) => ({ ...s })));
  };

  const handleCreate = () => {
    if (ruleType === 'sequence') {
      createMut.mutate(
        {
          name:
            form.name ||
            `${sequenceChannel === 'all' ? 'All channels' : sequenceChannel} — ${steps.length}-step sequence`,
          trigger: 'outreach_stale',
          conditions: {
            channel: sequenceChannel === 'all' ? null : sequenceChannel,
            steps: steps.map((s) => ({ afterDays: Number(s.afterDays) || 1, title: s.title })),
          },
          actions: { kind: 'sequence_followup' },
          enabled: true,
        },
        {
          onSuccess: () => {
            setShowCreate(false);
            resetForm();
          },
        }
      );
      return;
    }

    createMut.mutate(
      {
        name: form.name || `${form.channel} → ${form.nextChannel}`,
        trigger: 'outreach_stale',
        conditions: {
          channel: form.channel,
          afterAttempts: Number(form.afterAttempts) || 2,
          waitDays: Number(form.waitDays) || 7,
          nextChannel: form.nextChannel,
        },
        actions: {
          kind: 'escalate_to_next_channel_task',
          taskTitle: `${form.nextChannel} follow-up due for {{lead.first_name}} {{lead.last_name}} — ${form.channel} stale after ${form.waitDays}d`,
          taskPriority: 'medium',
        },
        enabled: true,
      },
      {
        onSuccess: () => {
          setShowCreate(false);
          resetForm();
        },
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Workflow size={18} className="text-slate-500" /> Outreach Follow-up Rules
          </h2>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700"
          >
            <Plus size={15} /> New Rule
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Auto-create an unassigned follow-up task — anyone on the team can claim it from the Tasks
          board — when a lead goes quiet. Either escalate once to the next channel, or run a
          multi-step cadence (e.g. day 7 / 14 / 21) on the same channel(s).
        </p>

        {showCreate && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 space-y-3">
            <h3 className="font-medium text-sm">New Outreach Stale Rule</h3>

            <div className="flex gap-2">
              <button
                onClick={() => setRuleType('sequence')}
                className={cn(
                  'px-3 py-1 rounded-md text-xs font-medium border',
                  ruleType === 'sequence'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white border-slate-200 text-slate-600'
                )}
              >
                Multi-step sequence
              </button>
              <button
                onClick={() => setRuleType('escalate')}
                className={cn(
                  'px-3 py-1 rounded-md text-xs font-medium border',
                  ruleType === 'escalate'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white border-slate-200 text-slate-600'
                )}
              >
                Escalate to next channel
              </button>
            </div>

            <label className="text-xs text-slate-500 block">
              Name (optional)
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={
                  ruleType === 'sequence' ? 'e.g. Cold-lead 3-step nudge' : 'e.g. LinkedIn → Email'
                }
                className="mt-0.5 border border-slate-200 rounded px-2 py-1 text-sm w-full"
              />
            </label>

            {ruleType === 'sequence' ? (
              <>
                <label className="text-xs text-slate-500 block">
                  Channel
                  <select
                    value={sequenceChannel}
                    onChange={(e) => setSequenceChannel(e.target.value as typeof sequenceChannel)}
                    className="mt-0.5 border border-slate-200 rounded px-2 py-1 text-sm w-full max-w-xs"
                  >
                    <option value="all">All channels</option>
                    {CHANNELS.map((ch) => (
                      <option key={ch} value={ch}>
                        {ch}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="space-y-2">
                  <div className="text-xs text-slate-500">Steps (fire in order, one task each)</div>
                  {steps.map((step, i) => (
                    <div
                      key={i}
                      className="flex gap-2 items-start bg-white border border-slate-200 rounded p-2"
                    >
                      <label className="text-xs text-slate-500 w-24 shrink-0">
                        After (days)
                        <input
                          type="number"
                          min={1}
                          value={step.afterDays}
                          onChange={(e) => {
                            const next = [...steps];
                            next[i] = { ...step, afterDays: e.target.value };
                            setSteps(next);
                          }}
                          className="mt-0.5 border border-slate-200 rounded px-2 py-1 text-sm w-full"
                        />
                      </label>
                      <label className="text-xs text-slate-500 flex-1">
                        Task title (supports {'{{lead.first_name}}'}, {'{{lead.last_name}}'},{' '}
                        {'{{channel}}'}, {'{{step}}'})
                        <input
                          type="text"
                          value={step.title}
                          onChange={(e) => {
                            const next = [...steps];
                            next[i] = { ...step, title: e.target.value };
                            setSteps(next);
                          }}
                          className="mt-0.5 border border-slate-200 rounded px-2 py-1 text-sm w-full"
                        />
                      </label>
                      <button
                        onClick={() => setSteps(steps.filter((_, si) => si !== i))}
                        className="mt-4 text-slate-400 hover:text-red-500 p-1"
                        title="Remove step"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setSteps([
                        ...steps,
                        {
                          afterDays: '7',
                          title: 'Follow up with {{lead.first_name}} {{lead.last_name}}',
                        },
                      ])
                    }
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  >
                    <Plus size={12} /> Add step
                  </button>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <label className="text-xs text-slate-500">
                  Channel
                  <select
                    value={form.channel}
                    onChange={(e) => setForm({ ...form, channel: e.target.value })}
                    className="mt-0.5 border border-slate-200 rounded px-2 py-1 text-sm w-full"
                  >
                    {CHANNELS.map((ch) => (
                      <option key={ch} value={ch}>
                        {ch}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  After attempts
                  <input
                    type="number"
                    min={1}
                    value={form.afterAttempts}
                    onChange={(e) => setForm({ ...form, afterAttempts: e.target.value })}
                    className="mt-0.5 border border-slate-200 rounded px-2 py-1 text-sm w-full"
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Wait days
                  <input
                    type="number"
                    min={1}
                    value={form.waitDays}
                    onChange={(e) => setForm({ ...form, waitDays: e.target.value })}
                    className="mt-0.5 border border-slate-200 rounded px-2 py-1 text-sm w-full"
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Escalate to
                  <select
                    value={form.nextChannel}
                    onChange={(e) => setForm({ ...form, nextChannel: e.target.value })}
                    className="mt-0.5 border border-slate-200 rounded px-2 py-1 text-sm w-full"
                  >
                    {CHANNELS.map((ch) => (
                      <option key={ch} value={ch}>
                        {ch}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={createMut.isPending || (ruleType === 'sequence' && steps.length === 0)}
                className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {createMut.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="border border-slate-200 px-4 py-1.5 rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {staleRules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50"
            >
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <Clock size={16} className="text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{rule.name}</div>
                <div className="text-xs text-slate-500">
                  {rule.actions.kind === 'sequence_followup' ? (
                    <>
                      {rule.conditions.channel ?? 'all channels'} ·{' '}
                      {(rule.conditions.steps ?? []).length}-step sequence (
                      {(rule.conditions.steps ?? []).map((s) => `${s.afterDays}d`).join(' → ')})
                    </>
                  ) : (
                    <>
                      {rule.conditions.channel} · {rule.conditions.afterAttempts} attempts ·{' '}
                      {rule.conditions.waitDays}d → escalate to {rule.conditions.nextChannel}
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => updateMut.mutate({ id: rule.id, data: { enabled: !rule.enabled } })}
                className={cn(
                  'text-xs font-medium px-2 py-1 rounded',
                  rule.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                )}
              >
                {rule.enabled ? 'Active' : 'Paused'}
              </button>
              <button
                onClick={() => {
                  if (confirm('Delete this rule?')) deleteMut.mutate(rule.id);
                }}
                className="text-slate-400 hover:text-red-500 p-1"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {staleRules.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">
              No outreach follow-up rules yet. Click "New Rule" to create one.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
