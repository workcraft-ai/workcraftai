// GitHub Actions scheduled runs have recently arrived 24–45 minutes apart
// despite a 15-minute cron. Alert after an hour without a recorded run.
export const AVAILABILITY_MONITOR_HEARTBEAT_MAX_AGE_MS = 60 * 60_000;
