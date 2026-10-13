// Setup eligibility is independent of subsequent legal-document versions.
// Never use this user-editable marker as an authorization/entitlement claim.
export function onboardingEligible(user) {
  const metadata = user?.user_metadata;
  return metadata?.workcraft_terms_accepted === true
    && /^\d{4}-\d{2}-\d{2}$/.test(metadata?.workcraft_terms_version ?? "")
    && metadata.workcraft_terms_version >= "2026-10-11"
    && Boolean(user.email_confirmed_at && user.email);
}
