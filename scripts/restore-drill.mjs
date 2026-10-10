#!/usr/bin/env node
// Runs ONLY against a fresh, disposable local Supabase stack. Never accepts a
// remote database URL. No payment or outbound email integrations are enabled.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = resolve(process.env.RESTORE_ROOT || '');
const workdir = resolve(process.env.RESTORE_WORKDIR || '');
if (!process.env.RESTORE_ROOT || !process.env.RESTORE_WORKDIR || root === workdir) throw Error('Separate restore and local-stack directories are required.');
const container = 'supabase_db_workcraftai-restore-drill';
try {
  execFileSync('docker',['inspect',container],{stdio:'ignore'});
  throw Error('An existing recovery container must not be reused.');
} catch (error) {
  if (error.status !== 1) throw error;
}
try {
  if ((await readdir(workdir)).length) throw Error('Recovery work directory must be empty.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }

async function locate(directory) {
  for (const item of await readdir(directory, {withFileTypes:true})) {
    if (!item.isDirectory()) continue;
    const sub = join(directory,item.name);
    if (item.name === 'workcraftai-backup') return sub;
    const found = await locate(sub); if(found) return found;
  }
  return null;
}
const backup = await locate(root);
if (!backup) throw Error('Restored backup directory is missing.');
for (const name of ['roles.sql','schema.sql','data.sql','auth-users.sql','migration-history-schema.sql','migration-history-data.sql','storage-policies.sql']) {
  const text = await readFile(join(backup,'database',name),'utf8');
  if (!text.trim()) throw Error('Required backup file is empty: '+name);
}
await mkdir(join(workdir,'supabase'), {recursive:true,mode:0o700});
await writeFile(join(workdir,'supabase','config.toml'), 'project_id = "workcraftai-restore-drill"\n[api]\nport = 55331\n[db]\nport = 55332\nshadow_port = 55330\nmajor_version = 17\n[studio]\nport = 55333\n[storage]\nenabled = true\n', {mode:0o600});
function cli(args) {
  return execFileSync('supabase',[...args,'--workdir',workdir],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
}
function query(sql) {
  return execFileSync('docker',['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
}
async function importSql(parts) {
  const child = spawn('docker',['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-1','-v','ON_ERROR_STOP=1'],{stdio:['pipe','ignore','pipe']});
  let diagnostic=''; child.stderr.on('data',value=>{diagnostic+=value.toString()});
  const complete = new Promise((res,rej)=>{child.on('error',rej);child.on('close',code=>res(code));});
  // Keep SQL and any row-level error details out of GitHub's public logs.
  child.stdin.on('error',()=>{});
  for(const part of parts) child.stdin.write(part+'\n');
  child.stdin.end();
  if(await complete !== 0) {
    await writeFile(join(workdir,'restore-diagnostic.log'),diagnostic,{mode:0o600});
    throw Error('Restore import failed. Private diagnostics were saved only in the temporary runner directory.');
  }
}
let phase = 'start isolated stack';
try {
  cli(['start','-x','logflare,vector,studio,imgproxy,edge-runtime,realtime,supavisor,mailpit']);
  phase = 'check Auth schema compatibility';
  const auth = await readFile(join(backup,'database','auth-users.sql'),'utf8');
  for(const table of ['users','identities','mfa_factors']) {
    const match=auth.match(new RegExp(`COPY auth\\.${table} \\(([^)]+)\\) FROM stdin;`));
    if(!match) throw Error('Auth export is missing a durable account table.');
    const available=new Set(query(`select column_name from information_schema.columns where table_schema='auth' and table_name='${table}'`).split('\n'));
    if(match[1].split(',').some(c=>!available.has(c.trim().replaceAll('"','')))) throw Error('Source Auth columns are incompatible with the local restore version.');
  }
  const files=await Promise.all(['roles.sql','schema.sql','data.sql','migration-history-schema.sql','migration-history-data.sql'].map(f=>readFile(join(backup,'database',f),'utf8')));
  phase = 'import database and durable Auth records';
  await importSql([files[0],files[1],'SET session_replication_role = replica;',auth,files[2]]);
  // A new local stack already has an empty managed migration-history schema.
  phase = 'import migration history';
  await importSql(['DROP SCHEMA IF EXISTS supabase_migrations CASCADE;',files[3],files[4]]);
  phase = 'restore private Storage policies';
  await importSql([await readFile(join(backup,'database','storage-policies.sql'),'utf8')]);
  const policyCount=Number(query("select count(*) from pg_policies where schemaname='storage' and tablename='objects'"));
  if(policyCount < 3)throw Error('Private Storage ownership policies were not recovered.');
  const env=Object.fromEntries(cli(['status','-o','env']).split('\n').flatMap(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);return m?[[m[1],m[2].replace(/^['"]|['"]$/g,'')]]:[]}));
  if(new URL(env.API_URL).hostname !== '127.0.0.1' || new URL(env.API_URL).port !== '55331') throw Error('Restore API must be the isolated localhost stack.');
  const admin=createClient(env.API_URL,env.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  const {data:buckets,error:bucketError}=await admin.storage.listBuckets();if(bucketError)throw Error('Recovery Storage is unavailable.');
  if(!buckets.some(b=>b.id==='estimate-media')) {
    const {error}=await admin.storage.createBucket('estimate-media',{public:false,fileSizeLimit:15728640});if(error)throw Error('Private recovery bucket could not be created.');
  } else {
    const {error}=await admin.storage.updateBucket('estimate-media',{public:false});if(error)throw Error('Recovery bucket must be private.');
  }
  const manifest=JSON.parse(await readFile(join(backup,'storage','estimate-media-manifest.json'),'utf8'));
  if(!Array.isArray(manifest.objects))throw Error('Full-media manifest missing.');
  phase = 'restore private media';
  execFileSync(process.execPath,['scripts/restore-storage.mjs'],{env:{...process.env,SUPABASE_URL:env.API_URL,SUPABASE_SERVICE_ROLE_KEY:env.SERVICE_ROLE_KEY,BACKUP_STORAGE_DIR:join(backup,'storage')},stdio:['ignore','pipe','pipe']});
  // Check bytes after uploading rather than merely trusting the upload response.
  for(const object of manifest.objects) {
    const {data,error}=await admin.storage.from('estimate-media').download(object.path);
    if(error||!data||data.size!==object.size)throw Error('Recovered media failed its byte-count check.');
    const response=await fetch(`${env.API_URL}/storage/v1/object/public/estimate-media/${object.path.split('/').map(encodeURIComponent).join('/')}`);
    if(response.ok)throw Error('Recovered private media was publicly accessible.');
  }
  phase = 'verify recovered RLS and ownership';
  const unsafe=Number(query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"));
  if(unsafe)throw Error('Recovered application tables are missing RLS.');
  const orphans=Number(query('select count(*) from public.estimates e left join auth.users u on u.id=e.user_id where u.id is null'));
  if(orphans)throw Error('Recovered estimates have missing Auth owners.');
  const counts=query("select json_build_object('users',(select count(*) from auth.users),'identities',(select count(*) from auth.identities),'mfa_factors',(select count(*) from auth.mfa_factors),'estimates',(select count(*) from public.estimates),'jobs',(select count(*) from public.jobs),'migrations',(select count(*) from supabase_migrations.schema_migrations))");
  const report=`## Isolated encrypted restore drill\n\n- Database, durable Auth records, migration history: restored\n- Application RLS and estimate owner relationships: passed\n- Private media uploaded and byte counts checked: ${manifest.objects.length}\n- Counts: ${counts}\n- Password/MFA sign-in and full application flows: still require a recovery acceptance test\n- No Production/Staging writes or cutover performed\n`;
  if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,report,{flag:'a'});
  console.log('Isolated restore structure and private media checks passed. Password/MFA and application acceptance remain separate.');
} catch {
  // Do not expose SQL row contents, authentication hashes, object paths or keys.
  console.error(`The isolated restore drill did not pass during: ${phase}. Do not treat recovery as verified.`);
  process.exitCode=1;
} finally {
  try{cli(['stop','--no-backup'])}catch{/* runner disposal removes any remaining isolated containers */}
}
