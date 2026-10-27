import { NextResponse } from "next/server";
import { createProAccessAdminClient, getProAccess } from "@/lib/pro-access";
import { renderJobCalendar, type CalendarJob } from "@/lib/job-calendar-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: "Calendar not found." }, { status: 404, headers: privateHeaders });
  }
  try {
    const admin = createProAccessAdminClient(Date.now() + 15_000);
    const { data: feed, error: feedError } = await admin.from("workcraft_calendar_feeds")
      .select("user_id,include_estimate_jobs,include_standalone_jobs,include_completed_jobs,show_customer_name")
      .eq("feed_token", token).maybeSingle();
    if (feedError) throw feedError;
    if (!feed || !(await getProAccess(admin, feed.user_id)).hasPro) {
      return NextResponse.json({ error: "Calendar not found." }, { status: 404, headers: privateHeaders });
    }

    // Keep the subscription bounded while covering near-term field work and
    // changes to recent jobs. Stable event UIDs let calendar clients update
    // existing entries instead of creating duplicates after rescheduling.
    const earliest = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const latest = new Date(Date.now() + 370 * 24 * 60 * 60 * 1000).toISOString();
    const jobs: CalendarJob[] = [];
    for (let offset = 0; offset < 5000; offset += 500) {
      const { data, error } = await admin.from("jobs")
        .select("id,title,client_name,job_address,estimate_id,scheduled_at,scheduled_end_at,schedule_timezone,status,updated_at")
        .eq("user_id", feed.user_id)
        .gte("scheduled_at", earliest).lte("scheduled_at", latest)
        .neq("status", "cancelled")
        .order("scheduled_at").order("id")
        .range(offset, offset + 499);
      if (error) throw error;
      jobs.push(...((data ?? []) as CalendarJob[]));
      if (!data || data.length < 500) break;
      if (offset === 4500) throw new Error("Calendar feed exceeded its event limit.");
    }
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.workcraftai.com";
    return new Response(renderJobCalendar(jobs, feed, appOrigin), {
      status: 200,
      headers: {
        ...privateHeaders,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="workcraft-ai-jobs.ics"',
      },
    });
  } catch (error) {
    console.error("Calendar feed could not be generated:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Calendar is temporarily unavailable." }, { status: 503, headers: privateHeaders });
  }
}
