import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const bucketName = "estimate-media";
const pageSize = 100;
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
const manifest = { version: 1, bucket: bucketName, objects: [] };

function safeObjectName(name) {
  return typeof name === "string" && name.length > 0 && name !== "." && name !== ".." &&
    !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

function outputPath(objectPath) {
  const destination = resolve(bucketRoot, ...objectPath.split("/"));
  const prefix = `${bucketRoot}${sep}`;
  if (!destination.startsWith(prefix)) throw new Error("A storage object path is invalid.");
  return destination;
}

async function backupFolder(folderPath = "") {
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucketName).list(folderPath, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error || !data) {
      throw new Error("Storage backup could not list the private estimate-media bucket.");
    }

    for (const entry of data) {
      if (!safeObjectName(entry.name)) throw new Error("Storage backup found an invalid object name.");
      const objectPath = folderPath ? `${folderPath}/${entry.name}` : entry.name;
      const isFolder = entry.id == null && entry.metadata == null;

      if (isFolder) {
        await backupFolder(objectPath);
        continue;
      }

      const { data: file, error: downloadError } = await supabase.storage.from(bucketName).download(objectPath);
      if (downloadError || !file) throw new Error("Storage backup could not download an object.");

      const destination = outputPath(objectPath);
      await mkdir(resolve(destination, ".."), { recursive: true });
      const bytes = Buffer.from(await file.arrayBuffer());
      await writeFile(destination, bytes, { flag: "wx" });

      const metadata = entry.metadata && typeof entry.metadata === "object"
        ? entry.metadata
        : {};
      const contentType = typeof metadata.mimetype === "string"
        ? metadata.mimetype
        : typeof metadata.contentType === "string"
          ? metadata.contentType
          : "application/octet-stream";
      manifest.objects.push({ path: objectPath, contentType, size: bytes.length });
    }

    if (data.length < pageSize) break;
    offset += data.length;
  }
}

await mkdir(bucketRoot, { recursive: true });
await backupFolder();
await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, { flag: "wx" });
console.log(`Backed up ${manifest.objects.length} private estimate-media objects.`);
