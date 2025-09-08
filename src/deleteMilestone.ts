import fs from "fs";
import csv from "csv-parser";
import { config } from "dotenv";
import { createRunLogger } from "./logger";
import { parseBoolean, sleep, fetchWithRetry } from "./utils";
import {
  fetchIssueDetail,
  fetchMilestoneMap,
  patchIssueMilestones,
} from "./backlogApi";

config();

const SPACE_URL = process.env.BACKLOG_SPACE_URL!;
const PROJECT_KEY = process.env.BACKLOG_PROJECT_KEY!;
const CSV_FILE = process.env.CSV_FILE!;
const ENV_DRY_RUN = process.env.DRY_RUN || process.env.BACKLOG_DRY_RUN;
const LOG_DIR = process.env.LOG_DIR!;
const TARGET_MILESTONE = (process.env.MILESTONE || "").trim();
const ISSUE_KEY_COLUMN = process.env.ISSUE_KEY_COLUMN!;

interface CsvRow {
  [key: string]: string;
}

const CLI_DRY_RUN =
  process.argv.includes("--dry-run") && !process.argv.includes("--no-dry-run");
const DRY_RUN = CLI_DRY_RUN || parseBoolean(ENV_DRY_RUN);

const logFilePath = DRY_RUN ? `delete-milestone-dry-run` : `delete-milestone`;
const { logger, filePath: LOG_FILE } = createRunLogger(LOG_DIR, logFilePath);

async function deleteMilestoneFromIssue(
  issueKey: string,
  milestoneName: string,
  milestoneMap: Record<string, number>
): Promise<void> {
  const issue = await fetchWithRetry({
    apiCall: () => fetchIssueDetail(issueKey),
  });
  const { milestone: beforeMilestones = [] } = issue;
  const beforeNames = beforeMilestones.map((m) => m.name);

  if (!milestoneMap[milestoneName]) {
    logger.log(
      `注: プロジェクトに存在しないマイルストーン \"${milestoneName}\" を除去対象とします`
    );
  }

  const afterMilestones = beforeMilestones.filter(
    (m) => m.name !== milestoneName
  );
  const afterNames = afterMilestones.map((m) => m.name);
  const noChange = beforeMilestones.length === afterMilestones.length;

  const label = DRY_RUN ? "DRY-RUN" : "APPLY";
  logger.group(`[${label}] ${issueKey} ${issue.summary ?? ""}`);
  logger.logDiff(beforeNames, afterNames, !noChange);

  if (noChange || DRY_RUN) {
    logger.groupEnd();
    return;
  }

  // 課題詳細に含まれるマイルストーンの id をそのまま使う。
  // これにより、プロジェクト側で非表示/削除済みなどで取得できない名前でも、
  // 既存に付与されている他のマイルストーンIDを落とさずに維持できる。
  const milestoneIds = afterMilestones.map((m) => m.id);

  try {
    await fetchWithRetry({
      apiCall: () => patchIssueMilestones(issueKey, milestoneIds),
    });
    logger.log("");
    logger.log("✅ 更新完了");
  } catch (err: any) {
    logger.log("");
    logger.error("❌ 更新失敗:", err.response?.data || err.message);
  } finally {
    logger.groupEnd();
  }
}

async function run() {
  if (!TARGET_MILESTONE) {
    logger.error(
      "MILESTONE 環境変数が未指定です。例: MILESTONE=v1.0 pnpm run delete-milestone"
    );
    logger.close();
    process.exit(1);
  }

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
      await deleteMilestoneFromIssue(issueKey, TARGET_MILESTONE, milestoneMap);

      // レート制限回避のため、API呼び出し間に800ms待機
      // Backlog APIは1分間に60リクエストまでなので、800ms間隔で安全（理論値1000msから20%安全マージンを引いた値）
      if (i < rows.length - 1) {
        await sleep(800);
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

logger.log(`Log file: ${LOG_FILE}`);
logger.log(`Space: ${SPACE_URL}, Project: ${PROJECT_KEY}`);
logger.log(`CSV: ${CSV_FILE}`);
logger.log(`Mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);
logger.log(`Target Milestone: ${TARGET_MILESTONE || "(none)"}`);

run();
