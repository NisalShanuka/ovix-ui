export type ActivityKind = 'online' | 'offline' | 'xray' | 'notice' | 'expiring' | 'depleted';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  subject: string;
  detail?: string;
  // 0 marks a standing "needs action" item rather than a timed event.
  at: number;
}

let seq = 0;
export function nextEventId(): string {
  seq += 1;
  return `ev-${seq}`;
}

// null means "no snapshot yet": the first list is the baseline, not news.
export function onlineChanges(
  prev: readonly string[] | null,
  next: readonly string[],
  at: number,
): ActivityEvent[] {
  if (prev === null) return [];
  const before = new Set(prev);
  const after = new Set(next);
  const events: ActivityEvent[] = [];
  for (const email of next) {
    if (!before.has(email)) events.push({ id: nextEventId(), kind: 'online', subject: email, at });
  }
  for (const email of prev) {
    if (!after.has(email)) events.push({ id: nextEventId(), kind: 'offline', subject: email, at });
  }
  return events;
}

export function prependEvents(
  list: readonly ActivityEvent[],
  events: readonly ActivityEvent[],
  max: number,
): ActivityEvent[] {
  return [...events, ...list].slice(0, max);
}
