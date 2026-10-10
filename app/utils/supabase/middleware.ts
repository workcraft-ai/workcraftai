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
  const isProtectedRoute =
    internalRoots.some((root) => path === root || path.startsWith(`${root}/`)) ||
    path === "/estimate/new" ||
    (path.startsWith("/estimate") && path.endsWith("/edit"));

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

  // Redirect authenticated users away from /login or /signup to /dashboard
  if (user && (path === "/login" || path === "/signup")) {
    url.pathname = "/dashboard";
    return redirectWithSession();
  }

  return supabaseResponse;
}
