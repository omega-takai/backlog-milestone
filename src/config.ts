import { config } from "dotenv";
import { parseBoolean } from "./utils";

// dotenvの設定
config();

// 環境変数の読み込みと型安全な変換
export const env = {
  // 必須の環境変数
  BACKLOG_API_KEY: process.env.BACKLOG_API_KEY!,
  BACKLOG_SPACE_URL: process.env.BACKLOG_SPACE_URL!,
  BACKLOG_PROJECT_KEY: process.env.BACKLOG_PROJECT_KEY!,
  CSV_FILE: process.env.CSV_FILE!,
  LOG_DIR: process.env.LOG_DIR!,
  ISSUE_KEY_COLUMN: process.env.ISSUE_KEY_COLUMN!,

  // オプションの環境変数
  DRY_RUN: process.env.DRY_RUN,
  TARGET_MILESTONE: (process.env.TARGET_MILESTONE || "").trim(),
  SKIP_IF_MILESTONE_EXISTS: (process.env.SKIP_IF_MILESTONE_EXISTS || "").trim(),
  MILESTONE_COLUMN: process.env.MILESTONE_COLUMN!,
} as const;

// CLI引数と環境変数を組み合わせたDRY_RUN判定
export const isDryRun = (): boolean => {
  const CLI_DRY_RUN =
    process.argv.includes("--dry-run") &&
    !process.argv.includes("--no-dry-run");
  return CLI_DRY_RUN || parseBoolean(env.DRY_RUN);
};

// 環境変数の検証
export const validateRequiredEnvVars = (): void => {
  const required = [
    "BACKLOG_API_KEY",
    "BACKLOG_SPACE_URL",
    "BACKLOG_PROJECT_KEY",
    "CSV_FILE",
    "LOG_DIR",
    "ISSUE_KEY_COLUMN",
  ] as const;

  const missing = required.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `必須の環境変数が設定されていません: ${missing.join(", ")}`
    );
  }
};
