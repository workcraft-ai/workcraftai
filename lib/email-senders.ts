/** Shared sender identity for automated WorkCraft AI application email. */
export function getWorkCraftNoReplySender() {
  return process.env.RESEND_NO_REPLY_FROM_EMAIL?.trim()
    || "WorkCraft AI <no-reply@workcraftai.com>";
}
