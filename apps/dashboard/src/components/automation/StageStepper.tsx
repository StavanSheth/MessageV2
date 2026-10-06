import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export interface StageDefinition {
  key: string;
  label: string;
  aliases: string[];
}

interface StageStepperProps {
  stages: StageDefinition[];
  currentStage: string;
  title: string;
  themeColor?: 'indigo' | 'cyan' | 'amber' | 'purple';
}

export const StageStepper: React.FC<StageStepperProps> = ({
  stages,
  currentStage,
  title,
  themeColor = 'indigo'
}) => {
  const currentStageIndex = stages.findIndex(
    (s) => s.key === currentStage || s.aliases.includes(currentStage)
  );

  const colorStyles = {
    indigo: {
      stepLabel: 'text-indigo-400',
      activeCard: 'bg-indigo-600/30 border-indigo-400 text-indigo-300 shadow-md shadow-indigo-500/20 scale-105',
      activeDot: 'bg-indigo-400',
    },
    cyan: {
      stepLabel: 'text-cyan-400',
      activeCard: 'bg-cyan-600/30 border-cyan-400 text-cyan-300 shadow-md shadow-cyan-500/20 scale-105',
      activeDot: 'bg-cyan-400',
    },
    amber: {
      stepLabel: 'text-amber-400',
      activeCard: 'bg-amber-600/30 border-amber-400 text-amber-300 shadow-md shadow-amber-500/20 scale-105',
      activeDot: 'bg-amber-400',
    },
    purple: {
      stepLabel: 'text-purple-400',
      activeCard: 'bg-purple-600/30 border-purple-400 text-purple-300 shadow-md shadow-purple-500/20 scale-105',
      activeDot: 'bg-purple-400',
    },
  }[themeColor];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase font-bold text-gray-400 tracking-wider">
          {title} ({stages.length} Steps)
        </span>
        <span className={`text-xs ${colorStyles.stepLabel} font-mono font-semibold`}>
          {currentStageIndex >= 0
            ? `Step ${currentStageIndex + 1} of ${stages.length}: ${stages[currentStageIndex].label}`
            : 'Stage: Idle'}
        </span>
      </div>
      <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-${Math.min(stages.length, 7)} gap-2`}>
        {stages.map((s, idx) => {
          const isPast = currentStageIndex > idx;
          const isCurrent = currentStage === s.key || s.aliases.includes(currentStage);
          return (
            <div
              key={s.key}
              className={`flex flex-col items-center p-2 rounded-xl border text-center transition-all ${
                isCurrent
                  ? colorStyles.activeCard
                  : isPast
                  ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-400'
                  : 'bg-gray-950/60 border-gray-800 text-gray-500'
              }`}
            >
              <div className="flex items-center space-x-1 mb-1">
                {isPast ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : isCurrent ? (
                  <span className={`w-2 h-2 rounded-full ${colorStyles.activeDot} animate-ping`} />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-gray-600" />
                )}
                <span className="text-[10px] font-mono font-bold">Step {idx + 1}</span>
              </div>
              <span className="text-xs font-semibold truncate w-full">{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
