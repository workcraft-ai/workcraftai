// Auth tokens never enter the asynchronous retry queue. Only signed Auth
// requests may retry this synchronous send with the same provider key.
export async function sendAuthMessages({ messages, prepare, finish, retire, apiKey, providerFetch }) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 2) throw new Error("Invalid Auth messages.");
  const outcomes = await Promise.allSettled(messages.map(async ({ mail, sendKey }) => {
    let id;
    try {
      const claim = await prepare(sendKey);
      id = claim?.allowed === true && !claim.sent ? claim.id : undefined;
      if (claim?.sent) return;
      if (!id || claim.allowed !== true) throw new Error("Auth email admission unavailable.");
      const response = await providerFetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": sendKey }, body: JSON.stringify(mail),
      });
      if (!response.ok) throw new Error("Auth provider rejected request.");
      const result = await response.json();
      if (typeof result.id !== "string") throw new Error("Invalid Auth provider response.");
      await finish(id, result.id, mail.to[0]);
    } catch (error) {
      if (id) await retire(id).catch(() => {});
      throw error;
    }
  }));
  if (outcomes.some(outcome => outcome.status === "rejected")) throw new Error("Auth email delivery unavailable.");
}
