const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const maxDatabaseAgeHours = Number(process.env.MAX_DATABASE_BACKUP_AGE_HOURS ?? 26);
const maxMediaAgeHours = Number(process.env.MAX_MEDIA_BACKUP_AGE_HOURS ?? 192);

if (!repository || !token) {
  console.error("::error::GitHub repository metadata is not available to the backup monitor.");
  process.exit(1);
}

const [owner, repo] = repository.split("/");
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function githubJson(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    console.error(`::error::GitHub Actions backup history could not be read (HTTP ${response.status}).`);
    process.exit(1);
  }
  return response.json();
}

const runData = await githubJson(`/repos/${owner}/${repo}/actions/workflows/daily-backup.yml/runs?branch=main&per_page=20`);
const runs = (runData.workflow_runs ?? []).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
const stepsByRun = new Map();

async function backupSteps(run) {
  if (!stepsByRun.has(run.id)) {
    const data = await githubJson(`/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
    stepsByRun.set(run.id, (data.jobs ?? []).flatMap((job) => job.steps ?? []));
  }
  return stepsByRun.get(run.id);
}

const successfulRuns = runs.filter((run) => run.conclusion === "success");
let databaseBackup;
let mediaBackup;

for (const run of successfulRuns) {
  if (databaseBackup && mediaBackup) break;
  const steps = await backupSteps(run);
  const snapshotSaved = steps.some((step) =>
    step.name === "Initialize repository if needed and save encrypted snapshot" && step.conclusion === "success");
  if (!snapshotSaved) continue;

  const databaseDumped = steps.some((step) => step.name === "Create database dump" && step.conclusion === "success");
  if (!databaseBackup && databaseDumped) databaseBackup = run;

  const mediaDownloaded = steps.some((step) => step.name === "Download private estimate media" && step.conclusion === "success");
  if (!mediaBackup && mediaDownloaded) mediaBackup = run;
}

const now = Date.now();
const activeRun = runs.find((run) => run.status === "in_progress");
const activeRunIsRecent = activeRun && now - Date.parse(activeRun.created_at) < 7 * 60 * 60 * 1_000;
const failures = [];
const lines = ["## Encrypted backup freshness", "", "| Snapshot | Last successful run | Age | Result |", "| --- | --- | ---: | --- |"];

function checkBackup(label, run, maxAgeHours, isMedia) {
  if (!run) {
    const backupStillRunning = activeRunIsRecent && (!isMedia || activeRun.event === "schedule");
    if (backupStillRunning) {
      lines.push(`| ${label} | current backup run is still in progress | n/a | In progress |`);
      return;
    }
    failures.push(`${label}: no successful snapshot run is recorded.`);
    lines.push(`| ${label} | none found | n/a | **Missing** |`);
    return;
  }

  const completedAt = run.completed_at ?? run.updated_at ?? run.created_at;
  const ageHours = Math.max(0, (now - Date.parse(completedAt)) / (60 * 60 * 1_000));
  const currentlyRunning = activeRunIsRecent && (!isMedia || activeRun.event === "schedule");
  const fresh = ageHours <= maxAgeHours || currentlyRunning;
  const age = `${ageHours.toFixed(1)} hours`;
  lines.push(`| ${label} | [run #${run.run_number}](${run.html_url}) · ${completedAt} | ${age} | ${fresh ? (currentlyRunning && ageHours > maxAgeHours ? "In progress" : "Fresh") : "**Stale**"} |`);
  if (!fresh) failures.push(`${label}: last successful snapshot is ${age}; threshold is ${maxAgeHours} hours.`);
}

checkBackup("Database and Auth", databaseBackup, maxDatabaseAgeHours, false);
checkBackup("Private estimate media", mediaBackup, maxMediaAgeHours, true);

if (summaryPath) {
  const fs = await import("node:fs/promises");
  await fs.appendFile(summaryPath, `${lines.join("\n")}\n\n`);
}

if (failures.length) {
  for (const failure of failures) console.error(`::error title=Backup freshness::${failure}`);
  process.exit(1);
}

console.log("Database/Auth and private-media snapshots are within their freshness targets.");
