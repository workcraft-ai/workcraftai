// GitHub Actions scheduled runs are best-effort. This secondary check has
// arrived five hours apart while the primary Supabase scheduler stayed healthy.
// Alert only when the fallback workflow has not started for half a day.
export const AVAILABILITY_MONITOR_HEARTBEAT_MAX_AGE_MS = 12 * 60 * 60_000;
