// GitHub Actions scheduled runs are best-effort and have recently arrived
// 24–45 minutes apart despite a 15-minute cron. Allow one delayed interval;
// alert only when the availability monitor has been missing for an hour.
export const AVAILABILITY_MONITOR_HEARTBEAT_MAX_AGE_MS = 60 * 60_000;
