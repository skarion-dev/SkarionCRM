export const OPPORTUNITY_STAGES = [
  {
    key: 'prospecting',
    label: 'Prospecting',
    color: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  {
    key: 'qualification',
    label: 'Qualification',
    color: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  { key: 'proposal', label: 'Proposal', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  {
    key: 'negotiation',
    label: 'Negotiation',
    color: 'bg-purple-100 text-purple-700 border-purple-200',
  },
  { key: 'closed_won', label: 'Closed Won', color: 'bg-green-100 text-green-700 border-green-200' },
  { key: 'closed_lost', label: 'Closed Lost', color: 'bg-red-100 text-red-700 border-red-200' },
] as const;

export type OpportunityStageKey = (typeof OPPORTUNITY_STAGES)[number]['key'];

export const OPPORTUNITY_STAGE_ORDER: OpportunityStageKey[] = [
  'prospecting',
  'qualification',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
];

export function opportunityStageLabel(key: string): string {
  return OPPORTUNITY_STAGES.find((s) => s.key === key)?.label ?? key.replace(/_/g, ' ');
}

export function opportunityStageColor(key: string): string {
  return (
    OPPORTUNITY_STAGES.find((s) => s.key === key)?.color ??
    'bg-slate-100 text-slate-600 border-slate-200'
  );
}
