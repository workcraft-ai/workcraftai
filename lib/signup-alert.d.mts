export function buildSignupAlert(user: { email: string; created_at: string; email_confirmed_at?: string | null }): { to: string[]; subject: string; text: string; html: string };
