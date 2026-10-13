export function getCronCredential(request: Request): "github" | "database" | null {
  const supplied = request.headers.get("authorization");
  const databaseSecret = process.env.SCHEDULER_SECRET;
  if (databaseSecret && supplied === `Bearer ${databaseSecret}`) return "database";
  const githubSecret = process.env.CRON_SECRET;
  if (githubSecret && supplied === `Bearer ${githubSecret}`) return "github";
  return null;
}
