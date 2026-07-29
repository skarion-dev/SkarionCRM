import type { LeadJourneyStage } from '../api.js';

export const LEAD_JOURNEY_STAGES: LeadJourneyStage[] = [
  'new',
  'ready_to_reach_out',
  'connection_sent',
  'connected',
  'engaged',
  'qualified',
  'meeting_booked',
  'opportunity',
  'follow_up',
  'converted',
  'nurture',
  'no_response',
  'disqualified',
  'lost',
];

export const ACTIVE_LEAD_JOURNEY: LeadJourneyStage[] = [
  'new',
  'ready_to_reach_out',
  'connection_sent',
  'connected',
  'engaged',
  'qualified',
  'meeting_booked',
  'opportunity',
  'follow_up',
  'converted',
];

export const LEAD_JOURNEY_LABELS: Record<LeadJourneyStage, string> = {
  new: 'New',
  ready_to_reach_out: 'Ready to reach out',
  connection_sent: 'Connection sent',
  connected: 'Connected',
  engaged: 'Engaged',
  qualified: 'Qualified',
  meeting_booked: 'Meeting booked',
  opportunity: 'Opportunity',
  follow_up: 'Follow-up',
  converted: 'Converted',
  nurture: 'Nurture',
  no_response: 'No response',
  disqualified: 'Disqualified',
  lost: 'Lost',
};

export function journeyLabel(stage: LeadJourneyStage | string | null | undefined): string {
  if (!stage) return 'New';
  return LEAD_JOURNEY_LABELS[stage as LeadJourneyStage] ?? stage.replace(/_/g, ' ');
}

export function journeyBadgeClass(stage: LeadJourneyStage | string): string {
  if (stage === 'converted') return 'bg-emerald-100 text-emerald-700';
  if (
    stage === 'qualified' ||
    stage === 'meeting_booked' ||
    stage === 'opportunity' ||
    stage === 'follow_up'
  ) {
    return 'bg-green-100 text-green-700';
  }
  if (stage === 'engaged' || stage === 'connected') return 'bg-blue-100 text-blue-700';
  if (stage === 'connection_sent' || stage === 'ready_to_reach_out') {
    return 'bg-violet-100 text-violet-700';
  }
  if (stage === 'nurture' || stage === 'no_response') return 'bg-amber-100 text-amber-700';
  if (stage === 'disqualified' || stage === 'lost') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-700';
}
