import { supabase } from "@/lib/supabase";

export interface EstimateAttachment { file: File; mediaType: "photo" | "voice" }

export const supportedAttachmentMimeTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav",
]);

export function attachmentMimeType(file: File) {
  return file.type.split(";", 1)[0].trim().toLowerCase();
}

export function invalidEstimateAttachment(attachments: EstimateAttachment[]) {
  return attachments.find(({ file, mediaType }) =>
    file.size === 0 || file.size > (mediaType === "photo" ? 8 : 15) * 1048576 ||
    !supportedAttachmentMimeTypes.has(attachmentMimeType(file)) ||
    !attachmentMimeType(file).startsWith(mediaType === "photo" ? "image/" : "audio/"));
}

export async function uploadEstimateAttachments(estimateId: string, userId: string, attachments: EstimateAttachment[], completedFiles: Set<File>) {
  for (const attachment of attachments) {
    if (completedFiles.has(attachment.file)) continue;
    const contentType = attachmentMimeType(attachment.file);
    const path = `${userId}/${estimateId}/${crypto.randomUUID()}-${attachment.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180)}`;
    const { data: reservationRows, error: reservationError } = await supabase.rpc("workcraft_reserve_estimate_media_upload", {
      p_estimate_id: estimateId, p_storage_path: path, p_size: attachment.file.size, p_mime_type: contentType,
    });
    const reservation = Array.isArray(reservationRows) ? reservationRows[0] : reservationRows;
    if (reservationError) throw new Error(`Media upload reservation failed: ${reservationError.message}`);
    if (!reservation?.allowed || typeof reservation.reservation_id !== "string") {
      const reason = reservation?.reason === "monthly_limit" ? "ESTIMATE_MEDIA_MONTHLY_LIMIT" : reservation?.reason === "storage_limit" ? "ESTIMATE_MEDIA_STORAGE_LIMIT" : reservation?.reason === "pro_required" ? "WORKCRAFT_PRO_REQUIRED" : "MEDIA_UPLOAD_UNAVAILABLE";
      throw new Error(reason);
    }
    const { error: uploadError } = await supabase.storage.from("estimate-media").upload(path, attachment.file, { contentType, upsert: false });
    if (uploadError) {
      await supabase.rpc("workcraft_finish_estimate_media_upload", { p_reservation_id: reservation.reservation_id, p_uploaded: false });
      throw new Error(`Attachment upload failed: ${uploadError.message}`);
    }
    const { data: uploadRecorded, error: finalizeError } = await supabase.rpc("workcraft_finish_estimate_media_upload", { p_reservation_id: reservation.reservation_id, p_uploaded: true });
    if (finalizeError || uploadRecorded !== true) throw new Error("Uploaded media usage could not be recorded. Please contact support before retrying the upload.");
    const { error: metadataError } = await supabase.from("estimate_attachments").insert({ estimate_id: estimateId, user_id: userId, storage_path: path, media_type: attachment.mediaType, content_type: contentType });
    if (metadataError) throw new Error(`Attachment details failed: ${metadataError.message}`);
    completedFiles.add(attachment.file);
  }
}
