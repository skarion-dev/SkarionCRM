import { useOpportunities, useUpdateEntity } from '../hooks/use-api.js';
import { BarChart, DollarSign, Calendar, ArrowRight, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import { useState } from 'react';
import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_ORDER,
  type OpportunityStageKey,
} from '../lib/opportunityStages.js';

const stages = OPPORTUNITY_STAGES;

type Stage = OpportunityStageKey;

const stageOrder: Stage[] = OPPORTUNITY_STAGE_ORDER;

function nextStage(s: Stage): Stage | null {
  const idx = stageOrder.indexOf(s);
  return idx < stageOrder.length - 1 ? (stageOrder[idx + 1] as Stage) : null;
}

function prevStage(s: Stage): Stage | null {
  const idx = stageOrder.indexOf(s);
  return idx > 0 ? (stageOrder[idx - 1] as Stage) : null;
}

export default function PipelinePage() {
  const { data, isLoading } = useOpportunities();
  const update = useUpdateEntity('opportunities');
  const navigate = useNavigate();
  const [dragging, setDragging] = useState<string | null>(null);

  const opportunities = data?.opportunities.filter((o) => !o.deletedAt) ?? [];

  const moveStage = (id: string, stage: Stage) => {
    update.mutate({ id, data: { stage } });
  };

  const totalValue = opportunities.reduce((s, o) => s + (parseFloat(o.amount ?? '0') || 0), 0);
  const weightedValue = opportunities.reduce((s, o) => {
    const amount = parseFloat(o.amount ?? '0') || 0;
    const prob = o.probability ?? 0;
    return s + amount * (prob / 100);
  }, 0);

  if (isLoading) return <div className="text-slate-500">Loading pipeline...</div>;

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <BarChart size={20} className="text-slate-600" />
          <h1 className="text-xl font-semibold">Pipeline</h1>
          <span className="text-sm text-slate-500">({opportunities.length} opportunities)</span>
        </div>
        <div className="flex gap-3 text-sm">
          <div className="bg-white border border-slate-200 rounded-md px-3 py-2">
            <span className="text-slate-500">Total: </span>
            <span className="font-medium">${totalValue.toLocaleString()}</span>
          </div>
          <div className="bg-white border border-slate-200 rounded-md px-3 py-2">
            <span className="text-slate-500">Weighted: </span>
            <span className="font-medium">${Math.round(weightedValue).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-4 min-w-max h-full">
          {stages.map((stage) => {
            const stageOpps = opportunities.filter((o) => o.stage === stage.key);
            const stageValue = stageOpps.reduce(
              (s, o) => s + (parseFloat(o.amount ?? '0') || 0),
              0
            );
            return (
              <div
                key={stage.key}
                className="w-72 flex flex-col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragging;
                  if (id) {
                    moveStage(id, stage.key);
                    setDragging(null);
                  }
                }}
              >
                <div
                  className={cn(
                    'flex items-center justify-between px-3 py-2 rounded-t-lg border border-b-0 text-sm font-medium',
                    stage.color
                  )}
                >
                  <span>{stage.label}</span>
                  <span className="text-xs opacity-70">
                    {stageOpps.length} · ${(stageValue / 1000).toFixed(1)}k
                  </span>
                </div>
                <div className="flex-1 bg-white border border-slate-200 rounded-b-lg p-2 space-y-2 overflow-y-auto">
                  {stageOpps.map((opp) => (
                    <div
                      key={opp.id}
                      draggable
                      onDragStart={() => setDragging(opp.id)}
                      onDragEnd={() => setDragging(null)}
                      className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => navigate(`/opportunities/${opp.id}`)}
                    >
                      <div className="font-medium text-sm mb-1">{opp.name}</div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        {opp.amount && (
                          <span className="flex items-center gap-1">
                            <DollarSign size={12} />
                            {parseFloat(opp.amount).toLocaleString()} {opp.currency}
                          </span>
                        )}
                        {opp.expectedCloseDate && (
                          <span className="flex items-center gap-1">
                            <Calendar size={12} />
                            {opp.expectedCloseDate}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="text-xs text-slate-400">
                          {opp.probability ? `${opp.probability}% probability` : ''}
                        </div>
                        <div className="flex gap-1">
                          {prevStage(opp.stage as Stage) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                moveStage(opp.id, prevStage(opp.stage as Stage)!);
                              }}
                              className="p-1 rounded hover:bg-slate-100 text-slate-400"
                            >
                              <ArrowLeft size={12} />
                            </button>
                          )}
                          {nextStage(opp.stage as Stage) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                moveStage(opp.id, nextStage(opp.stage as Stage)!);
                              }}
                              className="p-1 rounded hover:bg-slate-100 text-slate-400"
                            >
                              <ArrowRight size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {stageOpps.length === 0 && (
                    <div className="text-xs text-slate-400 text-center py-4">
                      Drop opportunities here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
