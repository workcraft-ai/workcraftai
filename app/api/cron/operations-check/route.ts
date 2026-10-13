import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createBoundedFetch } from "@/lib/bounded-fetch";
import { getCronCredential } from "@/lib/cron-authorization";

export const runtime = "nodejs";
export const maxDuration = 20;

const EMAIL_POOL_LIMITS = { app: 75, auth: 20, billing: 5 } as const;
const USAGE_ALERT_PERCENT = 80;

type MetricResult = { count: number | null; error: { message: string } | null };
type UsageWindow = { used: number; limit: number | null; resets_at?: string };

function readUsageWindow(value: unknown): UsageWindow | null {
  if (!value || typeof value !== "object") return null;
  const window = value as { used?: unknown; limit?: unknown; resets_at?: unknown };
  if (typeof window.used !== "number" || !Number.isFinite(window.used)) return null;
  if (window.limit !== null && (typeof window.limit !== "number" || !Number.isFinite(window.limit))) return null;
  return {
    used: window.used,
    limit: window.limit as number | null,
    ...(typeof window.resets_at === "string" ? { resets_at: window.resets_at } : {}),
  };
}

async function getResendEmailUsage(apiKey: string | undefined) {
  if (!apiKey) return null;
  try {
    const response = await fetch("https://api.resend.com/usage", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return null;
    const emails = (payload as { emails?: unknown }).emails;
    if (!emails || typeof emails !== "object") return null;
    const daily = readUsageWindow((emails as { daily?: unknown }).daily);
    const monthly = readUsageWindow((emails as { monthly?: unknown }).monthly);
    return daily && monthly ? { daily, monthly } : null;
  } catch {
    return null;
  }
}

async function probeAppHealth(requestUrl: string) {
  const started = Date.now();
  try {
    const response = await fetch(new URL("/api/health", requestUrl), {
      cache: "no-store", signal: AbortSignal.timeout(7_000),
    });
    return { status_code: response.status, duration_ms: Date.now() - started };
  } catch {
    return { status_code: 0, duration_ms: Date.now() - started };
  }
}

export async function GET(request: Request) {
  if (!getCronCredential(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Operations monitoring is not configured." }, { status: 503 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedFetch(5_000) },
  });
  const now = new Date();
  const nowIso = now.toISOString();
  const strictUsage = new URL(request.url).searchParams.get("strict_usage") === "1";
  const utcToday = nowIso.slice(0, 10);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1_000).toISOString();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1_000).toISOString();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1_000).toISOString();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1_000).toISOString();
  const emailDeliveryWindowStart = strictUsage ? dayAgo : hourAgo;

  const metricQueries = [
    admin.from("stripe_webhook_events").select("event_id", { count: "exact", head: true }).eq("status", "failed"),
    admin.from("stripe_webhook_events").select("event_id", { count: "exact", head: true }).eq("status", "processing").lt("processing_started_at", tenMinutesAgo),
    admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000).toISOString()),
    admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("status", "pending").lte("created_at", thirtyMinutesAgo).lte("next_attempt_at", nowIso),
    admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("status", "sending").lte("created_at", thirtyMinutesAgo).lte("lease_until", fifteenMinutesAgo),
    admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("source", "auth").in("status", ["pending", "sending"]).lte("created_at", tenMinutesAgo),
    admin.from("email_delivery_inbox").select("provider_event_id", { count: "exact", head: true }).in("event", ["failed", "suppressed", "bounced", "complained"]).gte("received_at", emailDeliveryWindowStart),
    admin.from("email_delivery_inbox").select("provider_event_id", { count: "exact", head: true }).eq("event", "delivery_delayed").lte("received_at", hourAgo).gte("received_at", dayAgo),
  ];

  const [metrics, emailUsageResult, aiUsageResult, settingsResult, resendUsage, pressureResult, exceptionResult, probe] = await Promise.all([
    Promise.all(metricQueries),
    admin.from("provider_email_daily_usage").select("source,emails_started").eq("usage_date", utcToday),
    admin.from("tradeflow_ai_global_daily_usage").select("attempts_started").eq("usage_date", utcToday).maybeSingle(),
    admin.from("tradeflow_app_settings").select("ai_global_daily_generation_limit").eq("singleton", true).single(),
    strictUsage ? getResendEmailUsage(process.env.RESEND_USAGE_API_KEY) : Promise.resolve(null),
    admin.rpc("workcraft_db_pressure"),
    admin.from("operational_exceptions").select("id", { count: "exact", head: true }).gte("occurred_at", new Date(now.getTime() - 15 * 60_000).toISOString()),
    probeAppHealth(request.url),
  ]);

  if (metrics.some((metric: MetricResult) => metric.error)
    || emailUsageResult.error || aiUsageResult.error || settingsResult.error || pressureResult.error || exceptionResult.error) {
    console.error("Operations monitoring could not read aggregate health metrics.");
    return NextResponse.json({ error: "Operations metrics are temporarily unavailable." }, { status: 503 });
  }

  const counts = metrics.map((metric: MetricResult) => metric.count ?? 0);
  const criticalAlerts: Array<{ code: string; count: number; action: string }> = [];
  const warnings: Array<{ code: string; source: string; used?: number; limit?: number; action: string }> = [];
  const { error: probeWriteError } = await admin.from("operational_api_probes").insert(probe);
  const { data: recentProbes, error: probeReadError } = await admin.from("operational_api_probes")
    .select("status_code,duration_ms").order("checked_at", { ascending: false }).limit(3);
  if (probeWriteError || probeReadError) {
    return NextResponse.json({ error: "API latency monitoring is temporarily unavailable." }, { status: 503 });
  }
  if (recentProbes.length >= 3 && recentProbes.every((row) => row.status_code === 0 || row.status_code >= 500)) {
    criticalAlerts.push({ code: "api_health_failure_sustained", count: 3,
      action: "The last three synthetic app health requests failed; inspect Vercel function logs and Supabase availability." });
  } else if (recentProbes.length >= 3 && recentProbes.every((row) => row.duration_ms >= 4_000)) {
    warnings.push({ code: "api_health_latency_sustained", source: "application", used: probe.duration_ms, limit: 4_000,
      action: "The last three synthetic app health requests took at least four seconds; inspect Vercel and Supabase latency." });
  }
  const addCritical = (code: string, count: number, action: string) => {
    if (count > 0) criticalAlerts.push({ code, count, action });
  };

  addCritical("stripe_webhook_failed", counts[0], "Inspect Stripe delivery attempts and Vercel logs; replay only after confirming the failure cause.");
  addCritical("stripe_webhook_stuck", counts[1], "Inspect Vercel logs and the Stripe event ledger; processing claims older than ten minutes should be retried safely.");
  addCritical("notification_failed", counts[2], "Review the notification outbox failure reason and matching Resend event; correct the provider or payload issue, then retry safely.");
  addCritical("notification_overdue", counts[3], "Check the notification retry workflow and CRON_SECRET; due messages have waited over thirty minutes.");
  addCritical("notification_lease_stuck", counts[4], "Check the notification retry workflow; sending leases expired more than fifteen minutes ago.");
  addCritical("auth_email_stuck", counts[5], "Check the Supabase Send Email Hook and Resend delivery; Auth messages older than ten minutes may contain expired links.");
  addCritical("email_delivery_issue", counts[6], "Review Resend usage, suppression, bounce, complaint, failed, and delivered-event records for the last 24 hours.");
  addCritical("email_delivery_delayed", counts[7], "Inspect Resend delivery details; messages have remained delayed for over one hour.");
  const pressure = pressureResult.data as { connections?: number; max_connections?: number } | null;
  const connections = pressure?.connections ?? 0;
  const maxConnections = pressure?.max_connections ?? 0;
  const dbUtilization = maxConnections > 0 ? Math.round(connections * 100 / maxConnections) : 0;
  if (maxConnections <= 0) {
    criticalAlerts.push({ code: "db_pressure_unavailable", count: 1, action: "Check the database pressure RPC and Supabase dashboard." });
  } else if (dbUtilization >= 85) {
    criticalAlerts.push({ code: "db_connections_critical", count: connections, action: "Inspect Supabase database connections and slow queries; utilization is at least 85%." });
  } else if (dbUtilization >= 70) {
    warnings.push({ code: "db_connections_warning", source: "supabase_database", used: connections, limit: maxConnections,
      action: "Inspect Supabase connection sources and query latency; utilization is at least 70%." });
  }
  const recentExceptions = exceptionResult.count ?? 0;
  if (recentExceptions >= 10) {
    criticalAlerts.push({ code: "api_exceptions_spike", count: recentExceptions,
      action: "Inspect Vercel runtime logs and operational_exceptions for routes with repeated server errors." });
  } else if (recentExceptions >= 3) {
    warnings.push({ code: "api_exceptions_warning", source: "application", used: recentExceptions,
      action: "Inspect Vercel runtime logs and operational_exceptions; at least three uncaught errors occurred in fifteen minutes." });
  }

  const emailUsage = new Map((emailUsageResult.data ?? []).map((row) => [row.source, row.emails_started]));
  for (const [pool, limit] of Object.entries(EMAIL_POOL_LIMITS)) {
    const used = emailUsage.get(pool) ?? 0;
    if (used >= Math.ceil(limit * USAGE_ALERT_PERCENT / 100)) {
      warnings.push({
        code: `email_pool_${pool}_near_limit`, source: "application_allocation", used, limit,
        action: `The app-admitted ${pool} email allocation is near its ceiling; compare the trend with Resend's usage dashboard and identify the traffic source.`,
      });
    }
  }

  if (strictUsage && !resendUsage) {
    warnings.push({
      code: "resend_provider_usage_unavailable", source: "resend_provider",
      action: "The Resend Usage API did not return email quotas. Confirm RESEND_USAGE_API_KEY has full access and inspect Resend's Usage page; no key or response body is logged.",
    });
  } else if (resendUsage) {
    for (const [period, usage] of Object.entries({ daily: resendUsage.daily, monthly: resendUsage.monthly })) {
      if (usage.limit !== null && usage.limit > 0 && usage.used >= Math.ceil(usage.limit * USAGE_ALERT_PERCENT / 100)) {
        warnings.push({
          code: `resend_${period}_usage_near_limit`, source: "resend_provider", used: usage.used, limit: usage.limit,
          action: `Resend ${period} email usage is near the provider limit. Review the Resend Usage page and preserve capacity for Auth and customer notifications.`,
        });
      }
    }
  }

  const aiLimit = settingsResult.data.ai_global_daily_generation_limit;
  const aiUsed = aiUsageResult.data?.attempts_started ?? 0;
  if (aiUsed >= Math.ceil(aiLimit * USAGE_ALERT_PERCENT / 100)) {
    warnings.push({
      code: "gemini_app_budget_near_limit", source: "application_allocation", used: aiUsed, limit: aiLimit,
      action: "The app-admitted AI allocation is near its ceiling; compare Gemini provider usage and errors. This counter includes failed attempts and is not a vendor billing total.",
    });
  }

  const urgentWarnings = warnings.some((warning) => [
    "db_connections_warning", "api_health_latency_sustained", "api_exceptions_warning",
  ].includes(warning.code));
  const failed = criticalAlerts.length > 0 || urgentWarnings || (strictUsage && warnings.length > 0);
  const response = {
    ok: !failed,
    checked_at: nowIso,
    usage_mode: "application_admission_allocations",
    metrics: {
      stripe_webhook_failed: counts[0],
      stripe_webhook_processing_over_10m: counts[1],
      notification_failed: counts[2],
      notification_due_over_30m: counts[3],
      notification_expired_lease_over_15m: counts[4],
      auth_email_pending_over_10m: counts[5],
      email_delivery_issues_in_window: counts[6],
      email_delivery_issue_window_hours: strictUsage ? 24 : 1,
      email_delivery_delayed_over_1h: counts[7],
      resend_email_daily_used: resendUsage?.daily.used ?? null,
      resend_email_daily_limit: resendUsage?.daily.limit ?? null,
      resend_email_monthly_used: resendUsage?.monthly.used ?? null,
      resend_email_monthly_limit: resendUsage?.monthly.limit ?? null,
      database_connections: connections,
      database_max_connections: maxConnections,
      database_utilization_percent: dbUtilization,
      uncaught_api_exceptions_15m: recentExceptions,
      app_health_status_code: probe.status_code,
      app_health_duration_ms: probe.duration_ms,
    },
    warnings,
    alerts: criticalAlerts,
  };

  return NextResponse.json(response, {
    status: failed ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
