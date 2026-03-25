/**
 * React hook for connecting to the Server-Sent Events stream.
 *
 * Provides real-time event delivery for:
 * - Job progress updates (doc summary, extraction)
 * - Background task completion
 * - Data sync notifications
 *
 * Auto-reconnects on connection loss with exponential backoff.
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

type EventHandler = (data: any) => void;

interface UseEventStreamOptions {
  /** Auto-connect on mount (default true) */
  autoConnect?: boolean;
  /** Event types to listen for */
  eventTypes?: string[];
}

interface EventStreamState {
  connected: boolean;
  reconnecting: boolean;
  error: string | null;
}

export function useEventStream(
  handlers: Record<string, EventHandler>,
  options: UseEventStreamOptions = {},
) {
  const { autoConnect = true } = options;
  const [state, setState] = useState<EventStreamState>({
    connected: false,
    reconnecting: false,
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef(handlers);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const MAX_RECONNECT_DELAY = 30000;

  // Keep handlers ref current
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const connect = useCallback(() => {
    // Don't connect in SSR
    if (typeof window === 'undefined') return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setState(s => ({ ...s, reconnecting: reconnectAttemptRef.current > 0, error: null }));

    const es = new EventSource('/api/events');
    eventSourceRef.current = es;

    es.onopen = () => {
      setState({ connected: true, reconnecting: false, error: null });
      reconnectAttemptRef.current = 0;
    };

    es.onerror = () => {
      es.close();
      setState(s => ({ ...s, connected: false }));

      // Reconnect with exponential backoff
      reconnectAttemptRef.current++;
      const delay = Math.min(
        1000 * Math.pow(2, reconnectAttemptRef.current - 1),
        MAX_RECONNECT_DELAY,
      );

      setState(s => ({ ...s, reconnecting: true }));
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    // Listen for the connected event
    es.addEventListener('connected', (e) => {
      setState({ connected: true, reconnecting: false, error: null });
    });

    // Register handlers for each event type
    const eventTypes = options.eventTypes || Object.keys(handlers);
    for (const type of eventTypes) {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          handlersRef.current[type]?.(data);
        } catch {
          // Non-JSON data
          handlersRef.current[type]?.(e.data);
        }
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setState({ connected: false, reconnecting: false, error: null });
    reconnectAttemptRef.current = 0;
  }, []);

  useEffect(() => {
    if (autoConnect) connect();
    return disconnect;
  }, [autoConnect, connect, disconnect]);

  return { ...state, connect, disconnect };
}
