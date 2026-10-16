import { NextResponse } from "next/server";
import { requireTradeFlowAdmin } from "@/lib/admin-support";

const USERS_PER_PAGE = 1000;
const MAX_PAGES = 100;

export async function GET() {
  const access = await requireTradeFlowAdmin();
  if ("response" in access) return access.response;

  let created = 0;
  let emailVerified = 0;
  let signedIn = 0;

  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, error } = await access.admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
      if (error) throw error;

      created += data.users.length;
      for (const user of data.users) {
        if (user.email_confirmed_at) emailVerified += 1;
        if (user.last_sign_in_at) signedIn += 1;
      }

      if (data.users.length < USERS_PER_PAGE) {
        return NextResponse.json(
          { created, email_verified: emailVerified, signed_in: signedIn },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
    }
    throw new Error("Auth user pagination exceeded the supported account count.");
  } catch (error) {
    console.error("Could not load admin account totals:", error);
    return NextResponse.json({ error: "Could not load account totals." }, { status: 503 });
  }
}
