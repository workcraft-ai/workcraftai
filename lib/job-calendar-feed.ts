export type CalendarJob = {
  id: string;
  title: string;
  client_name: string;
  job_address: string;
  estimate_id: string | null;
  scheduled_at: string | null;
  scheduled_end_at: string | null;
  schedule_timezone: string | null;
  status: string;
  updated_at: string;
};

export type CalendarFeedPreferences = {
  include_estimate_jobs: boolean;
  include_standalone_jobs: boolean;
  include_completed_jobs: boolean;
  show_customer_name: boolean;
};

function calendarDate(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeCalendarText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;").replace(/,/g, "\\,");
}

// RFC 5545 content lines are limited to 75 UTF-8 octets. Continuation lines
// begin with one space, which counts toward their limit.
function foldCalendarLine(line: string): string {
  const lines: string[] = [];
  let current = "";
  let length = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (length + bytes > 75) {
      lines.push(current);
      current = " ";
      length = 1;
    }
    current += char;
    length += bytes;
  }
  lines.push(current);
  return lines.join("\r\n");
}

export function renderJobCalendar(
  jobs: CalendarJob[], preferences: CalendarFeedPreferences, appOrigin: string,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkCraft AI//Job Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:WorkCraft AI Jobs",
  ];
  for (const job of jobs) {
    if (!job.scheduled_at || job.status === "cancelled") continue;
    if (job.status === "completed" && !preferences.include_completed_jobs) continue;
    if (job.estimate_id && !preferences.include_estimate_jobs) continue;
    if (!job.estimate_id && !preferences.include_standalone_jobs) continue;
    const start = new Date(job.scheduled_at);
    if (!Number.isFinite(start.getTime())) continue;
    const savedEnd = job.scheduled_end_at ? new Date(job.scheduled_end_at) : null;
    const end = savedEnd && Number.isFinite(savedEnd.getTime()) && savedEnd > start
      ? savedEnd : new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const updated = Number.isFinite(new Date(job.updated_at).getTime())
      ? job.updated_at : job.scheduled_at;
    const title = preferences.show_customer_name
      ? `${job.title || "Job"}${job.client_name && !job.title.includes(job.client_name) ? ` — ${job.client_name}` : ""}`
      : "WorkCraft AI job";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${job.id}@workcraftai.com`,
      `DTSTAMP:${calendarDate(updated)}`,
      `LAST-MODIFIED:${calendarDate(updated)}`,
      `DTSTART:${calendarDate(start.toISOString())}`,
      `DTEND:${calendarDate(end.toISOString())}`,
      `SUMMARY:${escapeCalendarText(title)}`,
      `DESCRIPTION:${escapeCalendarText(`View job details in WorkCraft AI: ${appOrigin}/schedule`)}`,
    );
    if (job.job_address.trim()) lines.push(`LOCATION:${escapeCalendarText(job.job_address.trim())}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldCalendarLine).join("\r\n")}\r\n`;
}
