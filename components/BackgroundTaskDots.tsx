'use client';

import { useBackgroundTasks, type BackgroundTask } from '@/components/BackgroundTaskProvider';
import { useState } from 'react';

function TaskDot({ task }: { task: BackgroundTask }) {
  const [showTooltip, setShowTooltip] = useState(false);

  const dotColor = task.status === 'running'
    ? 'bg-red-500'
    : task.status === 'completed'
      ? 'bg-green-500'
      : 'bg-red-600';

  const animate = task.status === 'running' ? 'animate-pulse' : '';

  const tooltipText = task.status === 'error'
    ? `${task.clientName}: ${task.activity} — Error: ${task.error}`
    : task.status === 'completed'
      ? `${task.clientName}: ${task.activity} — Complete`
      : `${task.clientName}: ${task.activity}`;

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        className={`w-3 h-3 rounded-full ${dotColor} ${animate} cursor-default transition-colors`}
      />
      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-[100] pointer-events-none">
          <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg max-w-xs">
            <div className="font-semibold">{task.clientName}</div>
            <div className="text-slate-300">{task.activity}</div>
            {task.status === 'error' && (
              <div className="text-red-300 mt-1">{task.error}</div>
            )}
            {task.status === 'completed' && (
              <div className="text-green-300 mt-1">Complete</div>
            )}
          </div>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-900" />
        </div>
      )}
    </div>
  );
}

export function BackgroundTaskDots() {
  const { tasks } = useBackgroundTasks();

  if (tasks.length === 0) return null;

  return (
    <div className="flex items-center gap-2.5 ml-3">
      {tasks.map(task => (
        <TaskDot key={task.id} task={task} />
      ))}
    </div>
  );
}
