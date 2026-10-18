import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Retrieve user session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const url = request.nextUrl.clone();
  const path = url.pathname;

  // Protect internal routes: Redirect unauthenticated users to /login
  const internalRoots = ["/dashboard", "/customers", "/schedule", "/pricebook", "/reports", "/profile", "/admin", "/invoice"];
  // The UUID proposal page is shared with customers. Its API validates the
  // revocable share token; only the estimate editor needs a contractor session.
  const isCustomerProposal = /^\/estimate\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path);
  const isProtectedRoute =
    internalRoots.some((root) => path === root || path.startsWith(`${root}/`)) ||
    (path === "/estimate" || path.startsWith("/estimate/")) && !isCustomerProposal;

  const redirectWithSession = () => {
    const response = NextResponse.redirect(url);
    for (const cookie of supabaseResponse.cookies.getAll()) response.cookies.set(cookie);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };

  if (!user && isProtectedRoute) {
    url.pathname = "/login";
    return redirectWithSession();
  }

  // A verified TOTP factor makes the password-only session incomplete. Gate
  // both pages and app APIs before any handler can use the service role.
  // Auth callbacks, password recovery, public customer links, and machine
  // webhooks remain reachable without an app session.
  const externalApi = /^\/api\/(?:auth\/|cron\/|webhooks\/|health(?:\/|$)|support(?:\/|$)|proposals\/)/.test(path);
  if (user && (isProtectedRoute || (path.startsWith("/api/") && !externalApi))) {
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError || !assurance) {
      if (path.startsWith("/api/")) return NextResponse.json({ error: "Could not verify your sign-in security." }, { status: 503 });
      url.pathname = "/mfa";
      return redirectWithSession();
    }
    if (assurance.currentLevel !== "aal2" && assurance.nextLevel === "aal2") {
      if (path.startsWith("/api/")) return NextResponse.json({ error: "Complete the authenticator check to continue.", code: "mfa_required" }, { status: 403 });
      url.pathname = "/mfa";
      url.search = "";
      return redirectWithSession();
    }
  }

  // Redirect authenticated users away from /login or /signup to /dashboard
  if (user && (path === "/login" || path === "/signup")) {
    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    url.pathname = assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2" ? "/mfa" : "/dashboard";
    return redirectWithSession();
  }

  return supabaseResponse;
}
