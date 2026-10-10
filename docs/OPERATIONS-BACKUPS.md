# WorkCraft AI encrypted off-site backups

This runbook covers the repository-managed backup workflow for Supabase Production. It uses Supabase's logical database dump plus a separate, narrowly scoped Auth account export, downloads the private `estimate-media` Storage bucket, encrypts and deduplicates the snapshot with Restic, and stores the encrypted repository in a dedicated Google Drive folder through rclone.

## What the workflow protects

- A database dump runs daily at 04:00 UTC. It includes database roles, schema, application data, and the Supabase migration history. Because Supabase's normal CLI dump excludes its managed Auth schema, a separate PostgreSQL 17 `pg_dump` exports `auth.users`, `auth.identities`, and `auth.mfa_factors` into `database/auth-users.sql`.
- The Auth export preserves user IDs, account metadata, password hashes, login identities, and enrolled MFA factors. It intentionally excludes active sessions, refresh tokens, one-time codes, and Supabase's internal Auth migration history; users will need to sign in again after recovery.
- Every Sunday at 04:00 UTC, the snapshot also downloads private estimate photos and voice notes from `estimate-media`. A manual run from the `main` branch can include Storage on demand.
- Restic encrypts file contents and repository metadata on the GitHub runner before data is uploaded. Google Drive stores encrypted Restic repository objects; it is not the encryption layer.
- Restic retains 30 daily snapshots and prunes expired data. A complete database-plus-media recovery point is therefore normally no more than a week old, and old/deleted data can remain in a backup for up to 30 days.
- No backup has been verified until the workflow has completed successfully and a restore drill has succeeded. The repository does not contain production secrets.

The workflow uses a GitHub-hosted runner. Its temporary unencrypted dump and media directory and temporary credential files are removed when the job ends. Do not add backup dumps, `rclone.conf`, or the Restic password to Git.

## One-time setup

### 1. Authorize a dedicated Google Drive remote

Use a Google account you control and keep two-step verification enabled. The OAuth app and Google Drive API can be set up without a Google Workspace subscription. Create your own OAuth client: rclone's shared Google client is being retired during 2026, and Google OAuth apps left in Testing mode expire their grants after seven days. Rclone's setup guide has current screenshots and details: [Google Drive backend setup](https://rclone.org/drive/#making-your-own-client-id).

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project and enable **Google Drive API**.
2. Configure the OAuth consent screen as **External**, give it a recognizable name such as `WorkCraft AI Backups`, add only your Google account as a test user, and add `https://www.googleapis.com/auth/drive.file` under **Data access**. Create a **Desktop app** OAuth client and keep its client ID and secret private.
3. On the OAuth app's Audience page, publish it for personal use so refresh grants do not expire after a week. Google may show an unverified-app warning when you authorize it; this is a single-user backup tool, so do not request public access or add other users. If Google will not let you publish yet, follow the homepage/privacy-policy steps in rclone's guide. You can use `https://workcraftai.com/` and `https://workcraftai.com/privacy` as those URLs.
4. On a trusted computer, install rclone, then run `rclone config`. Create a remote named exactly `drive`, choose Google Drive, enter the OAuth client ID and secret, select the narrow `drive.file` scope, leave the service-account path blank, and answer **Yes** to browser authentication. Complete the Google authorization in your browser, select **No** for Shared Drive, and save the remote.

The `drive.file` scope lets rclone access files and folders it creates; those files remain visible in the Google Drive website. The workflow creates `WorkCraftAI-Backups/production` in that account. The rclone configuration includes the OAuth client secret and a refresh token, so treat the file as a password. To copy its Base64 form directly to the clipboard on macOS:

```sh
base64 < "$HOME/.config/rclone/rclone.conf" | tr -d '\n' | pbcopy
```

Paste it directly into the GitHub Actions secret below. Do not send it in chat, email, an issue, or a repository file. Clear the clipboard afterward. If rclone uses a different config path, use the path printed by `rclone config file`.

### 2. Create the Restic encryption password

Generate a strong random password once:

```sh
openssl rand -base64 48
```

Save it in a password manager and keep a separate offline recovery copy. Add the same value as a GitHub Actions secret. If this password is lost, Google Drive cannot decrypt the backups; it cannot be reset by WorkCraft AI or Google.

### 3. Add GitHub Actions secrets

In the GitHub repository `workcraft-ai/workcraftai`, open **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Value |
| --- | --- |
| `PROD_SUPABASE_DB_URL` | Production database connection URI from Supabase **Connect**. Use the Session pooler if direct IPv6 access is unavailable. URL-encode special characters in the database password. |
| `PROD_SUPABASE_URL` | Production Supabase project URL. |
| `PROD_SUPABASE_SERVICE_ROLE_KEY` | Production service-role key; used only by the scheduled workflow to read private Storage objects. Never use the publishable/anon key here. |
| `RCLONE_CONFIG_B64` | Base64 text of the authorized rclone config file containing the `drive` remote. |
| `RESTIC_PASSWORD` | The random encryption password created above. |

This repository is public. Anonymous readers cannot access Actions secrets, and the backup workflow does not run for pull requests. Still, anyone who can change `main` or dispatch the workflow can cause it to run with these secrets; keep write access minimal, protect `main`, and review workflow changes. The workflow itself has read-only GitHub permissions. Rotate the Supabase service-role key and rclone authorization if either is exposed.

## Start and verify backups

After saving the secrets, open **Actions → Encrypted off-site backup → Run workflow** on `main`. Select `include_storage: true` for the initial full snapshot. Confirm the run finishes green and its summary says Auth account data was included and media was included. Subsequent daily runs back up database and Auth account data; Sunday runs include media.

Confirm the encrypted repository exists with rclone (the object names are Restic's encrypted repository files, not readable SQL or photos):

```sh
rclone lsf drive:WorkCraftAI-Backups/production
```

GitHub Actions notifications report failed runs to repository watchers according to their GitHub notification settings. Make sure the account that needs backup alerts watches workflow failures. A successful job shows that a snapshot was written; it does not prove that the snapshot can be restored. Complete the restore drill below before treating backups as a production recovery guarantee.

## Restore drill or recovery

Restore into a **new recovery Supabase project first**. Do not overwrite the live project as the first recovery attempt. Check Supabase's current restore guide and project compatibility before starting: [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

1. Install `restic`, `rclone`, the Supabase CLI, and PostgreSQL client tools on a trusted computer. Put the authorized rclone config at a private local path, set `RCLONE_CONFIG` to that file, set `RESTIC_REPOSITORY=rclone:drive:WorkCraftAI-Backups/production`, and set `RESTIC_PASSWORD` to the saved Restic password. Do not put these values in shell history or share them.
2. List full-media snapshots and restore a selected one to a private local directory. The `full-media` tag marks snapshots that include the private Storage bucket:

   ```sh
   restic snapshots --host workcraftai-production --tag full-media
   RESTORE_SNAPSHOT_ID="paste-the-selected-snapshot-id-here"
   mkdir -p ./workcraftai-restore
   restic restore "$RESTORE_SNAPSHOT_ID" --host workcraftai-production --target ./workcraftai-restore
   find ./workcraftai-restore -type d -name workcraftai-backup -print
   ```

   The `find` command prints the restored backup directory; use that path as `BACKUP_ROOT` below. Protect and delete this local plaintext recovery copy after the drill.
3. Create a new Supabase project and set `RECOVERY_DB_URL` to its connection URI. Before importing Auth records, confirm the recovery project's Auth schema is compatible with the source schema represented by the backup. Do not import Auth data into a project with a mismatched schema; stop and adapt the restore with Supabase support or an Auth migration specialist. Restore database objects and rows in this order:

   ```sh
   psql "$RECOVERY_DB_URL" --single-transaction --set ON_ERROR_STOP=1 \
     --file "$BACKUP_ROOT/database/roles.sql" \
     --file "$BACKUP_ROOT/database/schema.sql" \
     --command 'SET session_replication_role = replica' \
     --file "$BACKUP_ROOT/database/auth-users.sql" \
     --file "$BACKUP_ROOT/database/data.sql"
   ```

   Restore the saved `supabase_migrations` schema and rows separately:

   ```sh
   psql "$RECOVERY_DB_URL" --single-transaction --set ON_ERROR_STOP=1 \
     --file "$BACKUP_ROOT/database/migration-history-schema.sql" \
     --file "$BACKUP_ROOT/database/migration-history-data.sql"
   ```

   The selected Auth records preserve account IDs used by application rows, but they do not restore active sessions or project configuration. A recovery project has its own JWT signing secret, so existing access tokens will not work and every user must sign in again. Password hashes and MFA factors are included, but verify that the target Auth version accepts them before relying on password sign-in. Auth/provider settings, email templates and URLs, Auth customizations/triggers, Edge Functions, API keys, and project settings require separate recovery. Compare the recovered project with the checked-in migrations and reapply the `estimate-media` bucket and its private access policies from `supabase/migrations/202609290001_proposals_field_tools.sql` before restoring files. Do not make the bucket public.
4. Restore the files into the private bucket in the recovery project. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` to the recovery project's values, and `BACKUP_STORAGE_DIR` to the restored `storage` directory, then run:

   ```sh
   npm ci --omit=dev
   npm run restore:storage
   ```

   The script uploads to the original object paths with `upsert` enabled. It logs only an object count. Keep the recovered bucket private and verify representative contractor-owned photos and voice notes with the matching test account.
5. Verify sign-in, estimates, proposal links, scheduled work, invoices, payment records, Storage access policies, and the app health endpoint against the recovery project. Reconfigure Auth URLs/provider settings and secrets separately. Do not switch Vercel Production to the recovery project until the owner has reviewed the recovery and explicitly approved a cutover.

## Limitations and operating notes

- Supabase Free does not provide managed daily backups or point-in-time recovery. This workflow is an owner-managed logical backup, not a substitute for Supabase PITR.
- Database snapshots are daily; media is captured weekly. Changes made to media after the last weekly run may not be recoverable. A manual full snapshot can be run before a high-risk database or Storage change.
- Database and Storage are read at different times, so the weekly snapshot is not a transactionally consistent point-in-time image. The restore drill must check application relationships and sample files.
- The Auth export is data-only and depends on compatible managed Auth table definitions in the recovery project. Supabase does not provide a one-size-fits-all Auth-only restore script; a successful dump is not proof that the Auth rows can be imported into every project version. Complete the restore drill before relying on it.
- The backup contains sensitive personal and business data, including customer addresses, estimate details, account data, and uploaded media. Access to the Drive account, GitHub secrets, and Restic password must be restricted.
- Account deletion removes live application data immediately, but an encrypted copy may remain in the rolling backup set for up to 30 days before Restic retention expires it.
- This workflow does not back up Vercel environment variables, Stripe/Resend/Gemini settings, Supabase Auth provider configuration, Edge Functions, or DNS. Keep a separate secure operations inventory and recovery steps for those services.

## Free isolated automated restore drill

Run **Actions → Encrypted off-site backup → Run workflow → main**, with **restore_drill** checked. This forces private media inclusion, encrypts the snapshot, restores it from Google Drive into the temporary runner and imports it into a fresh localhost-only Supabase stack. It includes durable Auth users/identities/MFA factors, current application schema/data, migration history, private Storage ownership policies and the files. The report checks schema compatibility, RLS, owner references, downloaded file sizes and public-access denial. It never writes Production or Staging, changes Vercel, or creates a paid cloud project.

The organization currently uses both active free project slots. No third paid project or pause of an existing project was authorized. The local drill provides structural recovery evidence; password/MFA sign-in and full application acceptance must still be completed against a compatible recovery environment before claiming a tested cutover. Keep the database/auth versions compatible and preserve separate provider configuration. Restore plaintext and credentials are removed even on failure; diagnostic SQL is not published in logs.
