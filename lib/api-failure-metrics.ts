type RouteHandler<Args extends unknown[]> = (...args: Args) => Promise<Response>;

async function recordFailure(route: string, statusCode: number) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return;
  try {
    await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/workcraft_record_api_failure`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_route: route, p_status_code: statusCode }),
      cache: "no-store",
      signal: AbortSignal.timeout(200),
    });
  } catch {
      // Monitoring must never replace the route's response; its request is bounded.
  }
}

/** Record only returned/thrown server failures, using a static route template. */
export function withApiFailureMetrics<Args extends unknown[]>(route: string, handler: RouteHandler<Args>): RouteHandler<Args> {
  return async (...args) => {
    let response: Response;
    try {
      response = await handler(...args);
    } catch (error) {
      await recordFailure(route, 500);
      throw error;
    }
    if (response.status >= 500) await recordFailure(route, response.status);
    return response;
  };
}
