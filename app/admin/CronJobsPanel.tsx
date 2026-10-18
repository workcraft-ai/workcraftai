import type { Language } from "@/app/components/LanguageProvider";

type Copy = { en: string; es: string };
type SourceLink = { label: Copy; path: string };
type CronJob = {
  platform: Copy;
  name: Copy;
  schedule: Copy;
  purpose: Copy;
  scheduleSource: SourceLink;
  logicSources: SourceLink[];
  historyUrl: string;
};

const repository = "https://github.com/workcraft-ai/workcraftai";
const productionProject = "ivioejiiigtbmhpzjuni";

const cronJobs: CronJob[] = [
  {
    platform: { en: "Vercel Cron", es: "Vercel Cron" },
    name: { en: "Estimate follow-ups and notification cleanup", es: "Seguimientos de cotizaciones y limpieza de notificaciones" },
    schedule: { en: "Daily at 09:00 UTC", es: "Todos los días a las 09:00 UTC" },
    purpose: {
      en: "Processes queued transactional notifications, sends due estimate follow-ups, and prunes old delivery, exception, probe, and webhook records.",
      es: "Procesa notificaciones transaccionales en cola, envía seguimientos de cotizaciones pendientes y elimina registros antiguos de entregas, excepciones, comprobaciones y webhooks.",
    },
    scheduleSource: { label: { en: "Schedule", es: "Calendario" }, path: "vercel.json" },
    logicSources: [{ label: { en: "Job logic", es: "Lógica del trabajo" }, path: "app/api/cron/followups/route.ts" }],
    historyUrl: "https://vercel.com/dashboard",
  },
  {
    platform: { en: "Vercel Cron", es: "Vercel Cron" },
    name: { en: "Account inactivity retention", es: "Conservación por inactividad de cuentas" },
    schedule: { en: "Daily at 10:00 UTC", es: "Todos los días a las 10:00 UTC" },
    purpose: {
      en: "Sends the 12-month inactivity warning and processes account deletions after the 30-day notice period, including failed-deletion retries.",
      es: "Envía el aviso tras 12 meses de inactividad y procesa la eliminación de cuentas al terminar el aviso de 30 días, incluidos los reintentos de eliminaciones fallidas.",
    },
    scheduleSource: { label: { en: "Schedule", es: "Calendario" }, path: "vercel.json" },
    logicSources: [
      { label: { en: "Email and deletion logic", es: "Lógica de correo y eliminación" }, path: "app/api/cron/account-retention/route.ts" },
      { label: { en: "Eligibility rules", es: "Reglas de elegibilidad" }, path: "supabase/migrations/20261004220558_account_retention_lifecycle.sql" },
    ],
    historyUrl: "https://vercel.com/dashboard",
  },
  {
    platform: { en: "Supabase Cron", es: "Supabase Cron" },
    name: { en: "Operations and retry worker", es: "Procesos operativos y reintentos" },
    schedule: { en: "Every 5 minutes", es: "Cada 5 minutos" },
    purpose: {
      en: "Calls the notification retry, Stripe webhook retry, and operations-check endpoints. This is an independent retry path alongside the GitHub availability workflow.",
      es: "Llama a los endpoints de reintentos de notificaciones y webhooks de Stripe, y a la comprobación operativa. Es una vía de reintento independiente del flujo de disponibilidad de GitHub.",
    },
    scheduleSource: { label: { en: "SQL schedule", es: "Calendario SQL" }, path: "supabase/migrations/20261013140255_durable_stripe_webhook_queue.sql" },
    logicSources: [
      { label: { en: "Notifications", es: "Notificaciones" }, path: "app/api/cron/notifications/route.ts" },
      { label: { en: "Stripe webhooks", es: "Webhooks de Stripe" }, path: "app/api/cron/stripe-webhooks/route.ts" },
      { label: { en: "Operations check", es: "Comprobación operativa" }, path: "app/api/cron/operations-check/route.ts" },
    ],
    historyUrl: `https://supabase.com/dashboard/project/${productionProject}/integrations/cron/jobs`,
  },
  {
    platform: { en: "Supabase Cron", es: "Supabase Cron" },
    name: { en: "Prune API failure metrics", es: "Depurar métricas de errores de API" },
    schedule: { en: "Daily at 04:25 UTC", es: "Todos los días a las 04:25 UTC" },
    purpose: {
      en: "Deletes operational HTTP failure metrics older than 14 days.",
      es: "Elimina métricas de fallos HTTP operativos con más de 14 días.",
    },
    scheduleSource: { label: { en: "SQL schedule and job", es: "Calendario y trabajo SQL" }, path: "supabase/migrations/20261013160000_pipeline_and_ops_observability.sql" },
    logicSources: [],
    historyUrl: `https://supabase.com/dashboard/project/${productionProject}/integrations/cron/jobs`,
  },
  {
    platform: { en: "GitHub Actions", es: "GitHub Actions" },
    name: { en: "Availability monitor", es: "Monitor de disponibilidad" },
    schedule: { en: "Every 15 minutes at :07, :22, :37, and :52 UTC", es: "Cada 15 minutos a los :07, :22, :37 y :52 UTC" },
    purpose: {
      en: "Checks the public website and app/Auth health, records the scheduler heartbeat, retries queued notifications and Stripe events, and checks operational alerts.",
      es: "Comprueba el sitio público y la salud de la aplicación y Auth, registra el latido del programador, reintenta notificaciones y eventos de Stripe en cola, y revisa alertas operativas.",
    },
    scheduleSource: { label: { en: "Schedule and workflow", es: "Calendario y flujo" }, path: ".github/workflows/availability.yml" },
    logicSources: [],
    historyUrl: `${repository}/actions/workflows/availability.yml`,
  },
  {
    platform: { en: "GitHub Actions", es: "GitHub Actions" },
    name: { en: "Daily operations audit", es: "Auditoría operativa diaria" },
    schedule: { en: "Daily at 07:15 UTC", es: "Todos los días a las 07:15 UTC" },
    purpose: {
      en: "Checks the latest encrypted backup age, production health and provider-admission budgets using strict usage checks.",
      es: "Comprueba la antigüedad de la copia cifrada más reciente, la salud de producción y los límites de admisión del proveedor con validaciones estrictas de uso.",
    },
    scheduleSource: { label: { en: "Schedule and workflow", es: "Calendario y flujo" }, path: ".github/workflows/daily-operations-audit.yml" },
    logicSources: [],
    historyUrl: `${repository}/actions/workflows/daily-operations-audit.yml`,
  },
  {
    platform: { en: "GitHub Actions", es: "GitHub Actions" },
    name: { en: "Encrypted off-site backup", es: "Copia de seguridad cifrada externa" },
    schedule: { en: "Daily at 04:00 UTC", es: "Todos los días a las 04:00 UTC" },
    purpose: {
      en: "Creates encrypted database and Auth snapshots. Private estimate media is included weekly on Sundays; a full storage snapshot and isolated restore drill can also be started manually.",
      es: "Crea copias cifradas de la base de datos y Auth. Los archivos privados de cotizaciones se incluyen los domingos; también se puede iniciar manualmente una copia completa de Storage y una prueba de restauración aislada.",
    },
    scheduleSource: { label: { en: "Schedule and workflow", es: "Calendario y flujo" }, path: ".github/workflows/daily-backup.yml" },
    logicSources: [],
    historyUrl: `${repository}/actions/workflows/daily-backup.yml`,
  },
];

function githubFile(path: string) {
  return `${repository}/blob/main/${path}`;
}

export default function CronJobsPanel({ language }: { language: Language }) {
  const es = language === "es";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="cron-jobs-heading">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-800">{es ? "Programación de tareas" : "Scheduled work"}</p>
        <h2 id="cron-jobs-heading" className="mt-1 text-xl font-bold text-slate-950">{es ? "Tareas programadas" : "Cron jobs"}</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
          {es
            ? "Inventario de las tareas encontradas en Vercel, Supabase y GitHub Actions. Los horarios están en UTC. Usa los enlaces para revisar el historial y editar el calendario o la lógica en su fuente."
            : "Inventory of scheduled tasks found in Vercel, Supabase, and GitHub Actions. Schedules are in UTC. Use the links to inspect run history and edit the schedule or behavior at its source."}
        </p>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {cronJobs.map((job) => (
          <article key={`${job.platform.en}-${job.name.en}`} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-orange-800">{job.platform[language]}</p>
                <h3 className="mt-1 text-base font-bold text-slate-950">{job.name[language]}</h3>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{es ? "Definido en código" : "Defined in code"}</span>
            </div>

            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-slate-700">{es ? "Horario" : "Schedule"}</dt>
                <dd className="mt-0.5 text-slate-600">{job.schedule[language]}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-700">{es ? "Qué hace" : "What it does"}</dt>
                <dd className="mt-0.5 leading-6 text-slate-600">{job.purpose[language]}</dd>
              </div>
            </dl>

            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{es ? "Dónde editar" : "Where to edit"}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                <a href={githubFile(job.scheduleSource.path)} target="_blank" rel="noopener noreferrer" className="font-semibold text-orange-800 underline underline-offset-2">
                  {job.scheduleSource.label[language]} <code className="break-all font-normal">{job.scheduleSource.path}</code>
                </a>
                {job.logicSources.map((source) => (
                  <a key={source.path} href={githubFile(source.path)} target="_blank" rel="noopener noreferrer" className="font-semibold text-orange-800 underline underline-offset-2">
                    {source.label[language]} <code className="break-all font-normal">{source.path}</code>
                  </a>
                ))}
              </div>
            </div>

            <a href={job.historyUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              {es ? `Ver historial en ${job.platform[language]}` : `View ${job.platform[language]} run history`}
              <span aria-hidden="true" className="ml-2">↗</span>
            </a>
          </article>
        ))}
      </div>

      <p className="mt-5 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">
        {es
          ? "Esta página documenta las definiciones del repositorio; el estado activo y las ejecuciones recientes se confirman en cada plataforma. La lógica del trabajo está en los archivos enlazados."
          : "This page documents repository definitions; active status and recent runs must be confirmed in each platform. The job behavior lives in the linked files."}
      </p>
    </section>
  );
}
