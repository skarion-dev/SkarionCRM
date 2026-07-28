import { useEffect, useState } from 'react';
import { useAuthStore, type AuthStore } from '../stores/auth.js';
import {
  useIntegrationStatus,
  useWorkflowRules,
  useCreateWorkflowRule,
  useUpdateWorkflowRule,
  useDeleteWorkflowRule,
  useAiConfig,
  useUpdateAiConfig,
  type AiRuntimeSettings,
} from '../hooks/use-api.js';
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
} from 'lucide-react';
import { cn } from '../lib/utils.js';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'pipelines', label: 'Pipelines', icon: Layers },
  { id: 'tags', label: 'Tags', icon: Tag },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'ai', label: 'AI & Agents', icon: Bot },
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

const TAGS = [
  'Hot Lead',
  'Warm Lead',
  'Cold Lead',
  'Decision Maker',
  'Influencer',
  'Enterprise',
  'SMB',
  'Startup',
  'Referral',
  'Inbound',
  'Outbound',
  'Follow-up',
  'Nurture',
  'Qualified',
  'Unqualified',
  'Competitor',
];

export default function SettingsPage() {
  const role = useAuthStore((s: AuthStore) => s.user?.role ?? '');
  const user = useAuthStore((s: AuthStore) => s.user);
  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const { data: integrationData } = useIntegrationStatus();

  const isManager = role === 'manager';

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
            const disabled = tab.id !== 'profile' && !isManager;
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
      {activeTab === 'team' && isManager && (
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
      {activeTab === 'pipelines' && isManager && (
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
      {activeTab === 'tags' && isManager && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Tag size={18} className="text-slate-500" /> Tags
          </h2>
          <div className="flex flex-wrap gap-2">
            {TAGS.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-full text-sm font-medium hover:bg-slate-200 transition-colors cursor-default"
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="text-sm text-slate-500 mt-4">
            Tags are read-only placeholders for now. Tag management will be available in a future
            update.
          </p>
        </div>
      )}

      {/* Workflows Tab */}
      {activeTab === 'workflows' && isManager && <WorkflowRulesPanel />}

      {/* AI & Agents Tab */}
      {activeTab === 'ai' && isManager && <AiControlPanel />}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && isManager && (
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

function AiControlPanel() {
  const { data, isLoading, error } = useAiConfig();
  const updateConfig = useUpdateAiConfig();
  const [settings, setSettings] = useState<AiRuntimeSettings | null>(null);

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

function WorkflowRulesPanel() {
  const { data: rules, isLoading } = useWorkflowRules();
  const createMut = useCreateWorkflowRule();
  const updateMut = useUpdateWorkflowRule();
  const deleteMut = useDeleteWorkflowRule();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    channel: 'linkedin',
    afterAttempts: '2',
    waitDays: '7',
    nextChannel: 'email',
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }

  const staleRules = (rules ?? []).filter((r) => r.trigger === 'outreach_stale');

  const handleCreate = () => {
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
          setForm({
            name: '',
            channel: 'linkedin',
            afterAttempts: '2',
            waitDays: '7',
            nextChannel: 'email',
          });
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
          When a channel goes stale (N attempts with no reply for D days), auto-create a follow-up
          task for the next channel in the sequence.
        </p>

        {showCreate && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 space-y-3">
            <h3 className="font-medium text-sm">New Outreach Stale Rule</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <label className="text-xs text-slate-500 col-span-2 md:col-span-3">
                Name
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. LinkedIn → Email"
                  className="mt-0.5 border border-slate-200 rounded px-2 py-1 text-sm w-full"
                />
              </label>
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
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={createMut.isPending}
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
                  {rule.conditions.channel} · {rule.conditions.afterAttempts} attempts ·{' '}
                  {rule.conditions.waitDays}d → escalate to {rule.conditions.nextChannel}
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
