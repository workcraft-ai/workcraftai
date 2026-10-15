import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { id, attachmentId } = await params;
  const supabase = await createUserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to edit this estimate." }, { status: 401 });

  const { data: estimate, error: estimateError } = await supabase.from("estimates")
    .select("id, status").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (estimateError) return NextResponse.json({ error: "Could not check this estimate." }, { status: 500 });
  if (!estimate) return NextResponse.json({ error: "Estimate not found." }, { status: 404 });
  if (["accepted", "paid"].includes(String(estimate.status).toLowerCase())) {
    return NextResponse.json({ error: "Approved estimates cannot be edited." }, { status: 409 });
  }

  const { data: attachment, error: attachmentError } = await supabase.from("estimate_attachments")
    .select("id, storage_path").eq("id", attachmentId).eq("estimate_id", id).eq("user_id", user.id).maybeSingle();
  if (attachmentError) return NextResponse.json({ error: "Could not check this attachment." }, { status: 500 });
  if (!attachment) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });

  const { error: storageError } = await supabase.storage.from("estimate-media").remove([attachment.storage_path]);
  if (storageError) {
    console.error("Estimate attachment storage removal failed:", storageError.message);
    return NextResponse.json({ error: "Could not remove this attachment." }, { status: 500 });
  }
  const { error: deleteError } = await supabase.from("estimate_attachments")
    .delete().eq("id", attachmentId).eq("estimate_id", id).eq("user_id", user.id);
  if (deleteError) {
    console.error("Estimate attachment metadata removal failed:", deleteError.message);
    return NextResponse.json({ error: "Attachment storage was removed, but the saved record needs support review." }, { status: 500 });
  }
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "private, no-store" } });
}
