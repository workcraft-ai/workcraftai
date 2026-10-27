import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { sameOrigin } from "@/lib/admin-support";
import { createProAccessAdminClient, getProAccess } from "@/lib/pro-access";
import type { CalendarFeedPreferences } from "@/lib/job-calendar-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const defaults: CalendarFeedPreferences = {
  include_estimate_jobs: true,
  include_standalone_jobs: true,
  include_completed_jobs: false,
  show_customer_name: false,
};

async function access() {
  const client = await createUserSupabaseClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Sign in to manage calendar sync." }, { status: 401, headers: noStore }) };
  const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || !assurance || (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2")) {
    return { response: NextResponse.json({ error: "Complete your authenticator check first." }, { status: 403, headers: noStore }) };
  }
  try {
    const admin = createProAccessAdminClient(Date.now() + 10_000);
    if (!(await getProAccess(admin, user.id)).hasPro) {
      return { response: NextResponse.json({ error: "Calendar sync requires Pro." }, { status: 403, headers: noStore }) };
    }
    return { admin, user };
  } catch {
    return { response: NextResponse.json({ error: "Calendar sync is temporarily unavailable." }, { status: 503, headers: noStore }) };
  }
}

function feedResponse(request: Request, row: CalendarFeedPreferences & { feed_token: string } | null) {
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  return NextResponse.json({
    enabled: Boolean(row),
    url: row ? `${appOrigin}/api/calendar/feed/${row.feed_token}` : null,
    preferences: row ? {
      include_estimate_jobs: row.include_estimate_jobs,
      include_standalone_jobs: row.include_standalone_jobs,
      include_completed_jobs: row.include_completed_jobs,
      show_customer_name: row.show_customer_name,
    } : defaults,
  }, { headers: noStore });
}

export async function GET(request: Request) {
  const result = await access();
  if ("response" in result) return result.response;
  const { data, error } = await result.admin.from("workcraft_calendar_feeds")
    .select("feed_token,include_estimate_jobs,include_standalone_jobs,include_completed_jobs,show_customer_name")
    .eq("user_id", result.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load calendar settings." }, { status: 503, headers: noStore });
  return feedResponse(request, data);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin was not accepted." }, { status: 403, headers: noStore });
  const result = await access();
  if ("response" in result) return result.response;
  const token = randomBytes(32).toString("hex");
  const { data: existing, error: readError } = await result.admin.from("workcraft_calendar_feeds")
    .select("user_id").eq("user_id", result.user.id).maybeSingle();
  if (readError) return NextResponse.json({ error: "Could not load calendar settings." }, { status: 503, headers: noStore });
  const query = existing
    ? result.admin.from("workcraft_calendar_feeds").update({ feed_token: token, updated_at: new Date().toISOString() }).eq("user_id", result.user.id)
    : result.admin.from("workcraft_calendar_feeds").insert({ user_id: result.user.id, feed_token: token });
  const { data, error } = await query.select("feed_token,include_estimate_jobs,include_standalone_jobs,include_completed_jobs,show_customer_name").single();
  if (error) return NextResponse.json({ error: "Could not create a calendar link. Please try again." }, { status: 503, headers: noStore });
  return feedResponse(request, data);
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin was not accepted." }, { status: 403, headers: noStore });
  const result = await access();
  if ("response" in result) return result.response;
  let body: Partial<CalendarFeedPreferences>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid calendar settings." }, { status: 400, headers: noStore }); }
  if (!body || typeof body !== "object" ||
    !["include_estimate_jobs", "include_standalone_jobs", "include_completed_jobs", "show_customer_name"]
      .every((key) => typeof body[key as keyof CalendarFeedPreferences] === "boolean") ||
    (!body.include_estimate_jobs && !body.include_standalone_jobs)) {
    return NextResponse.json({ error: "Choose at least one job type and set every option." }, { status: 400, headers: noStore });
  }
  const preferences: CalendarFeedPreferences = {
    include_estimate_jobs: body.include_estimate_jobs!,
    include_standalone_jobs: body.include_standalone_jobs!,
    include_completed_jobs: body.include_completed_jobs!,
    show_customer_name: body.show_customer_name!,
  };
  const { data, error } = await result.admin.from("workcraft_calendar_feeds")
    .update({ ...preferences, updated_at: new Date().toISOString() })
    .eq("user_id", result.user.id)
    .select("feed_token,include_estimate_jobs,include_standalone_jobs,include_completed_jobs,show_customer_name")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Create a calendar link before saving options." }, { status: 503, headers: noStore });
  return feedResponse(request, data);
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin was not accepted." }, { status: 403, headers: noStore });
  const result = await access();
  if ("response" in result) return result.response;
  const { error } = await result.admin.from("workcraft_calendar_feeds").delete().eq("user_id", result.user.id);
  if (error) return NextResponse.json({ error: "Could not turn off calendar sync." }, { status: 503, headers: noStore });
  return feedResponse(request, null);
}
