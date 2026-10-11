type EmailEvent = {
  estimate_id: string;
  provider_email_id: string | null;
  event: string;
  created_at: string;
};
const rank: Record<string, number> = {
  sent: 1, follow_up_sent: 1, delivery_delayed: 2, delivered: 3,
  failed: 4, suppressed: 4, bounced: 5, complained: 6,
};

// Track the most recently sent message, then reduce that message's events.
// A delayed older webhook must not replace a newer send or a terminal outcome.
export function latestEstimateEmailEvents(events: EmailEvent[]): Record<string, string> {
  const latest: Record<string, string> = {};
  const message: Record<string, string | null> = {};
  const sent = events.filter((row) => row.event === "sent" || row.event === "follow_up_sent")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const row of sent) {
    if (row.estimate_id in message) continue;
    message[row.estimate_id] = row.provider_email_id;
    latest[row.estimate_id] = row.event;
  }
  for (const row of events) {
    if (!(row.estimate_id in message) || row.provider_email_id !== message[row.estimate_id]) continue;
    if ((rank[row.event] ?? 0) > (rank[latest[row.estimate_id]] ?? 0)) latest[row.estimate_id] = row.event;
  }
  return latest;
}
