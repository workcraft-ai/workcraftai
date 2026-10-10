import test from "node:test";
import assert from "node:assert/strict";
import { storageBackupConfig, assertStorageBackupCount } from "../scripts/backup-storage-config.mjs";

const env = {
  BACKUP_EXPECTED_PROJECT_REF: "ivioejiiigtbmhpzjuni",
  SUPABASE_URL: "https://ivioejiiigtbmhpzjuni.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-only",
  BACKUP_STORAGE_DIR: "/tmp/fixture",
  BACKUP_STORAGE_EXPECTED_COUNT: "3",
};
test("backup binds Storage API to the expected Production project", () => {
  assert.equal(storageBackupConfig(env).expectedCount, 3);
  for (const url of ["https://wuebymyvhzieockrohyp.supabase.co", "http://ivioejiiigtbmhpzjuni.supabase.co", `${env.SUPABASE_URL}/other`, `${env.SUPABASE_URL}?key=unsafe`]) {
    assert.throws(() => storageBackupConfig({ ...env, SUPABASE_URL: url }));
  }
});
test("backup requires a valid source count including legitimate zero", () => {
  assert.equal(storageBackupConfig({ ...env, BACKUP_STORAGE_EXPECTED_COUNT: "0" }).expectedCount, 0);
  for (const count of [undefined, "", "-1", "3junk", "1.5", "9007199254740992"]) {
    assert.throws(() => storageBackupConfig({ ...env, BACKUP_STORAGE_EXPECTED_COUNT: count }));
  }
});
test("empty or partial downloads cannot pass against a nonempty source", () => {
  assert.throws(() => assertStorageBackupCount(0, 3));
  assert.throws(() => assertStorageBackupCount(2, 3));
  assert.doesNotThrow(() => assertStorageBackupCount(3, 3));
  assert.doesNotThrow(() => assertStorageBackupCount(0, 0));
});
