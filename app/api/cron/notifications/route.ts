import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { processNotifications } from "@/lib/notification-outbox";
import { upgradeLegacyShareSecrets } from "@/lib/proposal-sharing";
import { createBoundedFetch } from "@/lib/bounded-fetch";
import { getCronCredential } from "@/lib/cron-authorization";

export const maxDuration = 60;
export async function GET(request: Request) {
  const deadlineAt=Date.now()+50_000;
  const credential = getCronCredential(request);
  if (!credential) {
    return NextResponse.json({error: "Unauthorized."}, {status: 401});
  }
  if (!process.env.RESEND_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({error: "Notification service is not configured."}, {status: 503});
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false},
    global: {fetch: createBoundedFetch(5_000,deadlineAt)},
  });
  try {
    const result = await processNotifications(admin, undefined, 4, 6000,deadlineAt);
    const shareSecretsUpgraded = await upgradeLegacyShareSecrets(admin);
    if (credential === "database") {
      const { error: heartbeatError } = await admin.from("operational_heartbeats").upsert({
        name: "supabase_scheduler_notifications", last_success_at: new Date().toISOString(),
      });
      if (heartbeatError) throw heartbeatError;
    }
    return NextResponse.json({sent: result.sent, pending: result.pending,shareSecretsUpgraded}, {headers: {"Cache-Control": "no-store"}});
  } catch {
    console.error("Notification retry could not complete.");
    return NextResponse.json({error: "Notification retry is temporarily unavailable."}, {status: 503});
  }
}
