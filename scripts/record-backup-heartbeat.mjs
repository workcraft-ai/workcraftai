const name = process.argv[2];
if (!new Set(["database_backup", "private_media_backup"]).has(name)) {
  console.error("Provide database_backup or private_media_backup.");
  process.exit(2);
}

const baseUrl = process.env.PROD_SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !key) {
  console.error("Backup heartbeat credentials are unavailable.");
  process.exit(2);
}

try {
  const response = await fetch(`${baseUrl}/rest/v1/operational_heartbeats?on_conflict=name`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ name, last_success_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    console.error(`Backup heartbeat could not be saved (HTTP ${response.status}).`);
    process.exit(1);
  }
  console.log(`Recorded ${name} heartbeat.`);
} catch {
  console.error("Backup heartbeat request failed.");
  process.exit(1);
}
