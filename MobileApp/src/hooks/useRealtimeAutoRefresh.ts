import { useEffect, useRef } from 'react';
import { realtimeService, RealtimeEvent } from '../services/realtime.service';

interface RealtimeAutoRefreshOptions {
  delayMs?: number;
  enabled?: boolean;
}

export const useRealtimeAutoRefresh = (
  resources: string[],
  refresh: () => void | Promise<void>,
  options: RealtimeAutoRefreshOptions = {}
) => {
  const { delayMs = 600, enabled = true } = options;
  const refreshRef = useRef(refresh);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;

    const scheduleRefresh = (_event: RealtimeEvent) => {
      if (timerRef.current) return;
      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        await refreshRef.current();
      }, delayMs);
    };

    const uniqueResources = Array.from(new Set(['all', ...resources]));
    const unsubscribers = uniqueResources.map((resource) =>
      realtimeService.subscribe(resource, scheduleRefresh)
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, delayMs, resources.join('|')]);
};
