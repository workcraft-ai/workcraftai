/** Keep account-existence responses neutral, without presenting outages as success. */
export function authResetOutcome(error) {
  if (!error) return 'accepted';
  if (error.code?.toLowerCase() === 'captcha_failed') return 'captcha';
  // Rate limits and invalid/account-specific requests retain the same neutral
  // response. Network failures, configuration errors and provider outages do not.
  if (error.status === 429 || error.status === 400 || error.status === 422) return 'accepted';
  return 'unavailable';
}
