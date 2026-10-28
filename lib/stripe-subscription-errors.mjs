// A subscription cancellation can arrive after account deletion has removed
// the user referenced by Stripe metadata. Ignore only a confirmed missing user.
export async function isDeletedSubscriptionOwner(admin, userId, error) {
  if (!error || error.code !== "23503") return false;
  const { data, error: lookupError } = await admin.auth.admin.getUserById(userId);
  if (lookupError) return lookupError.status === 404;
  return !data?.user;
}
