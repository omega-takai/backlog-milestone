import fs from "fs";

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
  // 例: (変更あり) a, b → a
  logDiff(
    before: string[] | string,
    after: string[] | string,
    changed: boolean,
    noneText = "(none)"
  ): void {
    const toLine = (v: string[] | string) =>
      Array.isArray(v)
        ? v.length > 0
          ? v.join(", ")
          : noneText
        : v || noneText;
    const status = changed ? "✅ 変更あり" : "⏩ 変更なし";
    const desc = changed
      ? `${toLine(before)} → ${toLine(after)}`
      : toLine(before);
    this.log(`${status}: ${desc}`);
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
