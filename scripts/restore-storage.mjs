import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const bucketName = "estimate-media";
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const backupStorageDir = process.env.BACKUP_STORAGE_DIR;

if (!supabaseUrl || !serviceRoleKey || !backupStorageDir) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and BACKUP_STORAGE_DIR are required.");
}

const outputRoot = resolve(backupStorageDir);
const bucketRoot = join(outputRoot, bucketName);
const manifestPath = join(outputRoot, `${bucketName}-manifest.json`);
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function safeObjectPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0")) return false;
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function sourcePath(objectPath) {
  const source = resolve(bucketRoot, ...objectPath.split("/"));
  if (!source.startsWith(`${bucketRoot}${sep}`)) throw new Error("A storage backup path is invalid.");
  return source;
}

const rawManifest = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(rawManifest);
if (manifest.version !== 1 || manifest.bucket !== bucketName || !Array.isArray(manifest.objects)) {
  throw new Error("The storage backup manifest is invalid or belongs to an unsupported bucket.");
}

const seen = new Set();
for (const object of manifest.objects) {
  if (!safeObjectPath(object.path) || seen.has(object.path)) {
    throw new Error("The storage backup manifest contains an invalid or duplicate path.");
  }
  seen.add(object.path);
}

for (const object of manifest.objects) {
  const bytes = await readFile(sourcePath(object.path));
  if (Number.isInteger(object.size) && bytes.length !== object.size) {
    throw new Error("A storage backup object size does not match its manifest.");
  }
  const contentType = typeof object.contentType === "string" && object.contentType.length <= 255
    ? object.contentType
    : "application/octet-stream";
  const { error } = await supabase.storage.from(bucketName).upload(object.path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error("Storage restore could not upload an object. Check the destination bucket and service credentials.");
}

console.log(`Restored ${manifest.objects.length} private estimate-media objects.`);
