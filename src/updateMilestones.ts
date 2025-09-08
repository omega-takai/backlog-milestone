import fs from "fs";
import csv from "csv-parser";
import { createRunLogger } from "./logger";
import {
  fetchMilestoneMap,
  fetchIssueDetail,
  patchIssueMilestones,
} from "./backlogApi";
import { config } from "dotenv";
import { parseBoolean, uniq } from "./utils";

config();

const SPACE_URL = process.env.BACKLOG_SPACE_URL!;
const PROJECT_KEY = process.env.BACKLOG_PROJECT_KEY!;
const CSV_FILE = process.env.CSV_FILE!;
const ENV_DRY_RUN = process.env.DRY_RUN || process.env.BACKLOG_DRY_RUN;
const LOG_DIR = process.env.LOG_DIR || "logs";

// CSVの列名（Backlogのエクスポートに合わせて調整）
const ISSUE_KEY_COLUMN = "キー";
const MILESTONE_COLUMN = "マイルストーン";

interface CsvRow {
  [key: string]: string;
}

const CLI_DRY_RUN =
  process.argv.includes("--dry-run") && !process.argv.includes("--no-dry-run");
const DRY_RUN = CLI_DRY_RUN || parseBoolean(ENV_DRY_RUN);

const logFilePath = DRY_RUN ? `update-dry-run` : `update`;
const { logger, filePath: LOG_FILE } = createRunLogger(LOG_DIR, logFilePath);

// 1. 課題を更新（DryRun対応＆Before/Afterログ）
async function updateIssue(
  issueKey: string,
  desiredMilestoneNames: string[],
  milestoneMap: Record<string, number>
): Promise<void> {
  const issue = await fetchIssueDetail(issueKey);
  const { milestone: milestonesBefore = [] } = issue;
  const beforeMilestoneNames = milestonesBefore.map((m) => m.name);

  // CSV＋自動付与からAfterを作る（有効なマイルストーン名のみ、重複排除、trim）
  const normalizedDesired = desiredMilestoneNames
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  const validDesired = normalizedDesired.filter((name) =>
    Boolean(milestoneMap[name])
  );
  const afterNames = uniq(validDesired);

  const noChange =
    uniq(beforeMilestoneNames).sort().join("|") ===
    afterNames.slice().sort().join("|");

  const label = DRY_RUN ? "DRY-RUN" : "APPLY";
  logger.group(`[${label}] ${issueKey} ${issue.summary ?? ""}`);
  logger.logDiff(beforeMilestoneNames, afterNames, !noChange);

  if (noChange || DRY_RUN) {
    logger.groupEnd();
    return;
  }

  const milestoneIds = afterNames
    .map((name) => milestoneMap[name])
    .filter((id): id is number => Boolean(id));

  try {
    await patchIssueMilestones(issueKey, milestoneIds);
    logger.log("");
    logger.log("✅ 更新完了");
  } catch (err: any) {
    logger.log("");
    logger.error("❌ 更新失敗:", err.response?.data || err.message);
  } finally {
    logger.groupEnd();
  }
}

// 2. CSVを読み込んで処理
async function run() {
  const milestoneMap = await fetchMilestoneMap();

  const tasks: Promise<void>[] = [];
  let rowCount = 0;
  let processedCount = 0;
  let skippedCount = 0;

  fs.createReadStream(CSV_FILE)
    .pipe(
      csv({
        mapHeaders: ({ header }) => (header ? header.trim() : header),
        mapValues: ({ value }) =>
          typeof value === "string" ? value.trim() : value,
      })
    )
    .on("data", (row: CsvRow) => {
      rowCount += 1;
      const issueKey = row[ISSUE_KEY_COLUMN];
      const rawMilestone = row[MILESTONE_COLUMN] || "";
      const milestoneNames = rawMilestone
        ? rawMilestone.split(",").map((s) => s.trim())
        : [];

      if (!issueKey) {
        skippedCount += 1;
        logger.log(
          `row#${rowCount}: スキップ（${ISSUE_KEY_COLUMN} 欄が空） issueIdOrKey=(none)`
        );
        return;
      }

      // CSV の内容のみで更新する（自動付与は廃止）
      processedCount += 1;
      tasks.push(updateIssue(issueKey, milestoneNames, milestoneMap));
    })
    .on("end", () => {
      Promise.all(tasks)
        .then(() => {
          logger.log(
            `\n🎉 全課題の処理が完了しました (rows=${rowCount}, processed=${processedCount}, skipped=${skippedCount})`
          );
        })
        .catch((e) => {
          logger.error("処理中にエラーが発生しました:", e?.message || e);
        })
        .finally(() => {
          logger.close();
        });
    });
}

// 実行開始ヘッダ（run前に出力してファイルへ確実に書かれるよう先出し）
logger.log(`Log file: ${LOG_FILE}`);
logger.log(`Space: ${SPACE_URL}, Project: ${PROJECT_KEY}`);
logger.log(`CSV: ${CSV_FILE}`);
logger.log(`Mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);

run();
