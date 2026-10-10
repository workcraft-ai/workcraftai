// Webhook destinations retain their API version independently of the SDK.
export function getInvoiceSubscriptionId(invoice) {
  if (!invoice || typeof invoice !== 'object') return null;
  const parent = invoice.parent;
  const reference = parent?.type === 'subscription_details'
    ? parent.subscription_details?.subscription
    : invoice.subscription;
  const id = typeof reference === 'string' ? reference : reference?.id;
  return typeof id === 'string' && /^sub_[A-Za-z0-9]+$/.test(id) ? id : null;
}
