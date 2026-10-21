const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const methods = new Set(["registered_phone_callback", "business_records"]);

export function validMfaRecoveryRequest(body, accountEmail) {
  return Boolean(body && typeof body === "object"
    && typeof body.reason === "string" && body.reason.trim().length >= 8 && body.reason.trim().length <= 500
    && typeof body.verification_details === "string"
    && body.verification_details.trim().length >= 12 && body.verification_details.trim().length <= 500
    && methods.has(body.verification_method)
    && typeof body.factor_id === "string" && uuidPattern.test(body.factor_id)
    && typeof body.confirm_email === "string"
    && body.confirm_email.trim().toLowerCase() === accountEmail.toLowerCase());
}
