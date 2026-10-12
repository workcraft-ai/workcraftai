import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { safeInternalRedirect } from "@/lib/security.mjs";
import { queueWelcomeNotification } from "@/lib/welcome-notification";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeInternalRedirect(searchParams.get("next"));
  const isRecovery = next === "/reset-password";
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type");

  const errorCode = searchParams.get("error_code");
  const authError = searchParams.get("error_description") || searchParams.get("error");
  if (errorCode || authError) {
    const destination = isRecovery
      ? "/forgot-password?error=expired"
      : "/login?error=email-link";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (code || (tokenHash && otpType)) {
    const supabaseResponse = NextResponse.redirect(new URL(next, request.url));

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              supabaseResponse.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    // Exchange the PKCE code or verify a token-hash email link into a session.
    const result = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({
          token_hash: tokenHash!,
          type: otpType as "recovery" | "signup" | "invite" | "magiclink" | "email_change" | "email",
        });

    if (!result.error) {
      // The email-confirmation callback is the earliest reliable point at
      // which a verified new account can receive its one-time welcome.
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (result.data.user && serviceKey && supabaseUrl) {
        try {
          const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
          await queueWelcomeNotification(admin, result.data.user);
        } catch (error) {
          console.error("Welcome notification could not be queued after confirmation:", error);
        }
      }
      return supabaseResponse;
    }
  }

  // Recovery failures need a new reset email; other confirmation failures return to sign in.
  const destination = isRecovery
    ? "/forgot-password?error=expired"
    : "/login?error=email-link";
  return NextResponse.redirect(new URL(destination, request.url));
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const tokenHash = form.get("token_hash");
  if (typeof tokenHash !== "string" || !tokenHash || form.get("type") !== "recovery") {
    return NextResponse.redirect(new URL("/forgot-password?error=expired", request.url), 303);
  }

  const cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }> = [];
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            cookiesToSet.push({ name, value, options });
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
  const destination = error ? "/forgot-password?error=expired" : "/reset-password";
  const response = NextResponse.redirect(new URL(destination, request.url), 303);
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}
