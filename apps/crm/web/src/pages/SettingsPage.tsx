import { useState } from 'react';
import { useAuthStore, type AuthStore } from '../stores/auth.js';
import { useIntegrationStatus } from '../hooks/use-api.js';
import {
  Settings, Users, Layers, Tag, Puzzle, User, CheckCircle, XCircle, Shield, Mail, FileText, Bot,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'pipelines', label: 'Pipelines', icon: Layers },
  { id: 'tags', label: 'Tags', icon: Tag },
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
  'Hot Lead', 'Warm Lead', 'Cold Lead', 'Decision Maker', 'Influencer',
  'Enterprise', 'SMB', 'Startup', 'Referral', 'Inbound', 'Outbound',
  'Follow-up', 'Nurture', 'Qualified', 'Unqualified', 'Competitor',
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
                  disabled && 'opacity-40 cursor-not-allowed hover:text-slate-500 hover:border-transparent'
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
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Name</label>
                <div className="mt-1 text-sm font-medium">{user?.name ?? '—'}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Email</label>
                <div className="mt-1 text-sm font-medium">{user?.email ?? '—'}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Role</label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="capitalize text-sm font-medium">{role || '—'}</span>
                  {role === 'manager' && <Shield size={14} className="text-blue-500" />}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">User ID</label>
                <div className="mt-1 text-sm font-mono text-slate-600 bg-slate-50 rounded px-2 py-1">{user?.id ?? '—'}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Superadmin</label>
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
                <div className="text-xs text-slate-500 capitalize">{role} {user?.isSuperadmin && '· Superadmin'}</div>
              </div>
              <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">You</span>
            </div>
            <p className="text-sm text-slate-500">
              Team management is available for managers. Contact your superadmin to add or remove team members.
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
            Tags are read-only placeholders for now. Tag management will be available in a future update.
          </p>
        </div>
      )}

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
                <div className="text-sm font-medium">AI Integration (Gemini)</div>
                <div className="text-xs text-slate-500">Google API key for AI features</div>
              </div>
              <div className="flex items-center gap-1.5">
                {integrationData?.googleApiKey ? (
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
