export function storageBackupConfig(env) {
  const expectedRef = env.BACKUP_EXPECTED_PROJECT_REF;
  if (!/^[a-z]{20}$/.test(expectedRef ?? "")) {
    throw new Error("BACKUP_EXPECTED_PROJECT_REF must identify the source project.");
  }
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch {
    throw new Error("Storage backup requires a valid Supabase project URL.");
  }
  if (url.origin !== `https://${expectedRef}.supabase.co` ||
      url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("Storage backup URL does not match the expected Production project.");
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.BACKUP_STORAGE_DIR) {
    throw new Error("Storage backup requires a service credential and output directory.");
  }
  const count = env.BACKUP_STORAGE_EXPECTED_COUNT;
  if (!/^(0|[1-9][0-9]*)$/.test(count ?? "") || !Number.isSafeInteger(Number(count))) {
    throw new Error("Storage backup requires the source database object count.");
  }
  return { url: url.origin, key: env.SUPABASE_SERVICE_ROLE_KEY,
    directory: env.BACKUP_STORAGE_DIR, expectedCount: Number(count) };
}

export function assertStorageBackupCount(actual, expected) {
  if (actual !== expected) {
    throw new Error(`Storage backup downloaded ${actual} objects; source database expected ${expected}. Check project credentials or retry after concurrent media changes.`);
  }
}
