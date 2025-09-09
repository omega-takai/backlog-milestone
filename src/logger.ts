import fs from "fs";

type LogDiffParams = {
  before: string[] | string;
  after: string[] | string;
  status: "apply" | "skip" | "no-change" | "has-skip-milestone";
  isDryRun?: boolean;
  noneText?: string;
};

export class Logger {
  private stream: fs.WriteStream;
  private indentLevel = 0;

  constructor(filePath: string) {
    this.stream = fs.createWriteStream(filePath, { flags: "a" });
  }

  private indent(): string {
    return "  ".repeat(this.indentLevel);
  }

  log(...args: unknown[]): void {
    console.log(...args);

    // NOTE:オブジェクトだった場合にJSON.stringifyする
    const json = args.map((arg) =>
      typeof arg === "object" ? JSON.stringify(arg) : String(arg)
    );
    this.stream.write(this.indent() + json.join(" ") + "\n");
  }

  // 差分行を統一フォーマットで出力する
  logDiff({
    before,
    after,
    status,
    isDryRun = false,
    noneText = "(none)",
  }: LogDiffParams): void {
    const toLine = (v: string[] | string) =>
      Array.isArray(v)
        ? v.length > 0
          ? v.join(", ")
          : noneText
        : v || noneText;

    const desc =
      status === "apply"
        ? `${toLine(before)} → ${toLine(after)}`
        : toLine(before);

    const isDryRunLabel = isDryRun ? "[DRY-RUN]" : undefined;

    switch (status) {
      case "apply":
        this.log(`✅ ${isDryRunLabel}[APPLY] ${desc}`);
        break;
      case "skip":
      case "has-skip-milestone":
        this.log(`⏩ ${isDryRunLabel}[SKIP] ${desc}`);
        break;
      case "no-change":
        this.log(`⏩ ${isDryRunLabel}[NO-CHANGE] ${desc}`);
        break;
    }
  }

  error(...args: unknown[]): void {
    console.error(...args);
    this.stream.write(
      this.indent() + "ERROR: " + args.map(String).join(" ") + "\n"
    );
  }

  group(label: string): void {
    console.log("");
    console.group(label);
    this.stream.write("\n" + this.indent() + label + "\n");
    this.indentLevel++;
  }

  groupEnd(): void {
    console.groupEnd();
    if (this.indentLevel > 0) this.indentLevel--;
  }

  close(): void {
    this.stream.end();
  }
}

function formatNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export function createRunLogger(
  logDir: string,
  filePrefix = "run"
): { logger: Logger; filePath: string } {
  fs.mkdirSync(logDir, { recursive: true });
  const filePath = `${logDir}/${filePrefix}-${formatNow()}.log`;
  const logger = new Logger(filePath);
  return { logger, filePath };
}
