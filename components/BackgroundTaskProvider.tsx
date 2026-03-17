'use client';

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';

export type TaskStatus = 'running' | 'completed' | 'error';

export interface BackgroundTask {
  id: string;
  clientName: string;
  activity: string;
  status: TaskStatus;
  error?: string;
  startedAt: number;
  completedAt?: number;
  result?: unknown;
}

interface BackgroundTaskContextValue {
  tasks: BackgroundTask[];
  addTask: (task: Omit<BackgroundTask, 'startedAt'>) => void;
  updateTask: (id: string, updates: Partial<BackgroundTask>) => void;
  removeTask: (id: string) => void;
  getTaskResult: (id: string) => unknown | undefined;
}

const BackgroundTaskContext = createContext<BackgroundTaskContextValue | null>(null);

export function useBackgroundTasks() {
  const ctx = useContext(BackgroundTaskContext);
  if (!ctx) throw new Error('useBackgroundTasks must be used within BackgroundTaskProvider');
  return ctx;
}

const COMPLETED_EXPIRY_MS = 3 * 60 * 60 * 1000;

export function BackgroundTaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const cleanupRef = useRef<ReturnType<typeof setInterval>>();

  const addTask = useCallback((task: Omit<BackgroundTask, 'startedAt'>) => {
    setTasks(prev => [...prev, { ...task, startedAt: Date.now() }]);
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<BackgroundTask>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  const getTaskResult = useCallback((id: string) => {
    return tasks.find(t => t.id === id)?.result;
  }, [tasks]);

  useEffect(() => {
    cleanupRef.current = setInterval(() => {
      const now = Date.now();
      setTasks(prev => prev.filter(t => {
        if (t.status === 'completed' && t.completedAt) {
          return now - t.completedAt < COMPLETED_EXPIRY_MS;
        }
        return true;
      }));
    }, 60_000);

    return () => {
      if (cleanupRef.current) clearInterval(cleanupRef.current);
    };
  }, []);

  return (
    <BackgroundTaskContext.Provider value={{ tasks, addTask, updateTask, removeTask, getTaskResult }}>
      {children}
    </BackgroundTaskContext.Provider>
  );
}
