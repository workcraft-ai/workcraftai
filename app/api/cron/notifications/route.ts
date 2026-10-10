import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { processNotifications } from "@/lib/notification-outbox";

export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({error: "Unauthorized."}, {status: 401});
  }
  if (!process.env.RESEND_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({error: "Notification service is not configured."}, {status: 503});
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false},
    global: {fetch: (input, init) => fetch(input, {...init, signal: AbortSignal.timeout(5000)})},
  });
  try {
    const result = await processNotifications(admin, undefined, 4, 6000);
    return NextResponse.json({sent: result.sent, pending: result.pending}, {headers: {"Cache-Control": "no-store"}});
  } catch {
    console.error("Notification retry could not complete.");
    return NextResponse.json({error: "Notification retry is temporarily unavailable."}, {status: 503});
  }
}
