import fs from "fs";
import csv from "csv-parser";
import { createRunLogger } from "./logger";
import {
  fetchMilestoneMap,
  fetchIssueDetail,
  patchIssueMilestones,
} from "./backlogApi";
import { config } from "dotenv";
import { parseBoolean, uniq, sleep, fetchWithRetry } from "./utils";

config();

const SPACE_URL = process.env.BACKLOG_SPACE_URL!;
const PROJECT_KEY = process.env.BACKLOG_PROJECT_KEY!;
const CSV_FILE = process.env.CSV_FILE!;
const ENV_DRY_RUN = process.env.DRY_RUN || process.env.BACKLOG_DRY_RUN;
const LOG_DIR = process.env.LOG_DIR!;
const SKIP_IF_MILESTONE_EXISTS = (
  process.env.SKIP_IF_MILESTONE_EXISTS || ""
).trim();
const ISSUE_KEY_COLUMN = process.env.ISSUE_KEY_COLUMN!;
const MILESTONE_COLUMN = process.env.MILESTONE_COLUMN!;
const DELAY_MS = parseInt(process.env.DELAY_MS || "800");

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
  const issue = await fetchWithRetry({
    apiCall: () => fetchIssueDetail(issueKey),
    baseDelay: 0,
  });
  const { milestone: milestonesBefore = [] } = issue;
  const beforeMilestoneNames = milestonesBefore.map((m) => m.name);

  // スキップ対象のマイルストーンが設定されているかチェック
  if (SKIP_IF_MILESTONE_EXISTS) {
    const skipMilestones = SKIP_IF_MILESTONE_EXISTS.split(",").map((m) =>
      m.trim()
    );
    const hasSkipMilestone = skipMilestones.some((skipMilestone) =>
      beforeMilestoneNames.includes(skipMilestone)
    );

    if (hasSkipMilestone) {
      logger.group(`[SKIP] ${issueKey} ${issue.summary ?? ""}`);
      logger.logDiff(beforeMilestoneNames, [], false);
      logger.groupEnd();
      return;
    }
  }

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
    await fetchWithRetry({
      apiCall: () => patchIssueMilestones(issueKey, milestoneIds),
      baseDelay: DELAY_MS,
    });
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

  const rows: CsvRow[] = [];
  let rowCount = 0;
  let processedCount = 0;
  let skippedCount = 0;

  // CSVファイルを読み込んで配列に格納
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(CSV_FILE)
      .pipe(
        csv({
          mapHeaders: ({ header }) => (header ? header.trim() : header),
          mapValues: ({ value }) =>
            typeof value === "string" ? value.trim() : value,
        })
      )
      .on("data", (row: CsvRow) => {
        rows.push(row);
      })
      .on("end", resolve)
      .on("error", reject);
  });

  // 順次実行でレート制限を回避
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
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
      continue;
    }

    processedCount += 1;
    logger.log(`\n[${processedCount}/${rows.length}] 処理中: ${issueKey}`);

    try {
      await updateIssue(issueKey, milestoneNames, milestoneMap);

      // レート制限回避のため、API呼び出し間に待機
      // Backlog APIは1分間に60リクエストまでなので、DELAY_MS間隔で安全
      if (i < rows.length - 1) {
        await sleep(DELAY_MS);
      }
    } catch (error: any) {
      logger.error(`課題 ${issueKey} の処理でエラー:`, error?.message || error);
    }
  }

  logger.log(
    `\n🎉 全課題の処理が完了しました (rows=${rowCount}, processed=${processedCount}, skipped=${skippedCount})`
  );
  logger.close();
}

// 実行開始ヘッダ（run前に出力してファイルへ確実に書かれるよう先出し）
logger.log(`Log file: ${LOG_FILE}`);
logger.log(`Space: ${SPACE_URL}, Project: ${PROJECT_KEY}`);
logger.log(`CSV: ${CSV_FILE}`);
logger.log(`Mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);
logger.log(`Skip if milestone exists: ${SKIP_IF_MILESTONE_EXISTS || "(none)"}`);
logger.log(`Delay: ${DELAY_MS}ms`);

run();
