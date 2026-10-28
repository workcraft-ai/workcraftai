import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { sameOrigin } from "@/lib/admin-support";
import { MAX_LOGO_BYTES, detectLogoContentType } from "@/lib/logo-upload";
import { getServiceSupabase } from "@/lib/stripe-server";

const LOGO_BUCKET = "business-logos";
const MAX_REQUEST_BYTES = MAX_LOGO_BYTES + 100_000;

async function authenticatedUser() {
  const client = await createUserSupabaseClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || !assurance || (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2")) return null;
  return { client, user };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await authenticatedUser();
  if (!access) return NextResponse.json({ error: "Sign in and complete any required security check." }, { status: 401 });

  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) return NextResponse.json({ error: "Logo must be 2 MB or smaller." }, { status: 413 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return NextResponse.json({ error: "Choose a PNG, JPEG, or WebP image." }, { status: 415 });
  }

  try {
    const form = await request.formData();
    const file = form.get("logo");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a logo file." }, { status: 400 });
    if (file.size === 0 || file.size > MAX_LOGO_BYTES) return NextResponse.json({ error: "Logo must be 2 MB or smaller." }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = detectLogoContentType(bytes);
    if (!contentType || file.type !== contentType) {
      return NextResponse.json({ error: "Choose a valid PNG, JPEG, or WebP image." }, { status: 415 });
    }

    const bucket = getServiceSupabase(12_000).storage.from(LOGO_BUCKET);
    const path = `${access.user.id}/logo`;
    const { error: uploadError } = await bucket.upload(path, bytes, { contentType, cacheControl: "60", upsert: true });
    if (uploadError) throw uploadError;
    const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
    const logoUrl = `${publicUrl}?v=${Date.now()}`;
    const { error: updateError } = await access.client.auth.updateUser({ data: { logo_url: logoUrl } });
    if (updateError) throw updateError;
    return NextResponse.json({ logo_url: logoUrl }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Logo upload failed:", error);
    return NextResponse.json({ error: "Could not upload the logo. Please try again." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await authenticatedUser();
  if (!access) return NextResponse.json({ error: "Sign in and complete any required security check." }, { status: 401 });
  try {
    const { error: removeError } = await getServiceSupabase(12_000).storage.from(LOGO_BUCKET).remove([`${access.user.id}/logo`]);
    if (removeError) throw removeError;
    const { error: updateError } = await access.client.auth.updateUser({ data: { logo_url: "" } });
    if (updateError) throw updateError;
    return NextResponse.json({ logo_url: "" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Logo removal failed:", error);
    return NextResponse.json({ error: "Could not remove the logo. Please try again." }, { status: 503 });
  }
}
