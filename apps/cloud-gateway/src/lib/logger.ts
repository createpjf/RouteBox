// ---------------------------------------------------------------------------
// Structured JSON logger — zero dependencies, JSON to stdout/stderr
// ---------------------------------------------------------------------------

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const MIN_LEVEL =
  LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) ?? "info"] ?? 1;

function emit(
  level: LogLevel,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  if (LOG_LEVELS[level] < MIN_LEVEL) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };

  // Errors/fatals go to stderr, everything else to stdout
  const out =
    level === "error" || level === "fatal" ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + "\n");
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) =>
    emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) =>
    emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) =>
    emit("error", msg, fields),
  fatal: (msg: string, fields?: Record<string, unknown>) =>
    emit("fatal", msg, fields),
};
