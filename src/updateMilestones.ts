import fs from "fs";
import csv from "csv-parser";
import { createRunLogger } from "./logger";
import {
  fetchMilestoneMap,
  fetchIssueDetail,
  patchIssueMilestones,
} from "./backlogApi";
import { env, isDryRun, validateRequiredEnvVars } from "./config";
import { uniq, fetchWithRetry } from "./utils";

validateRequiredEnvVars();

const {
  BACKLOG_SPACE_URL,
  BACKLOG_PROJECT_KEY,
  CSV_FILE,
  LOG_DIR,
  SKIP_IF_MILESTONE_EXISTS,
  ISSUE_KEY_COLUMN,
  MILESTONE_COLUMN,
} = env;

interface CsvRow {
  [key: string]: string;
}

const DRY_RUN = isDryRun();

const logFilePath = DRY_RUN ? `update-dry-run` : `update`;
const { logger, filePath: LOG_FILE } = createRunLogger(LOG_DIR, logFilePath);

type UpdateIssueParams = {
  issueKey: string;
  desiredMilestoneNames: string[];
  milestoneMap: Record<string, number>;
  processedCount: number;
  totalCount: number;
};

// 1. 課題を更新（DryRun対応＆Before/Afterログ）
async function updateIssue({
  issueKey,
  desiredMilestoneNames,
  milestoneMap,
  processedCount,
  totalCount,
}: UpdateIssueParams): Promise<void> {
  const issue = await fetchIssueDetail(issueKey);
  const { milestone: milestonesBefore = [] } = issue;
  const beforeMilestoneNames = milestonesBefore.map((m) => m.name);

  logger.group(
    `[${processedCount}/${totalCount}] ${issueKey} ${issue.summary}`
  );

  // スキップ対象のマイルストーンが設定されているかチェック
  if (SKIP_IF_MILESTONE_EXISTS) {
    const skipMilestones = SKIP_IF_MILESTONE_EXISTS.split(",").map((m) =>
      m.trim()
    );
    const hasSkipMilestone = skipMilestones.some((skipMilestone) =>
      beforeMilestoneNames.includes(skipMilestone)
    );

    if (hasSkipMilestone) {
      logger.logDiff({
        before: beforeMilestoneNames,
        after: beforeMilestoneNames,
        status: "has-skip-milestone",
        isDryRun: DRY_RUN,
      });
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

  logger.logDiff({
    before: beforeMilestoneNames,
    after: afterNames,
    status: noChange ? "no-change" : "apply",
    isDryRun: DRY_RUN,
  });

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
    });
  } catch (err: any) {
    logger.log("");
    logger.error("❌ 更新失敗:", err.response?.data || err.message);
  } finally {
    logger.log("");
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

    try {
      await updateIssue({
        issueKey,
        desiredMilestoneNames: milestoneNames,
        milestoneMap,
        processedCount,
        totalCount: rows.length,
      });
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
logger.log(`Space: ${BACKLOG_SPACE_URL}, Project: ${BACKLOG_PROJECT_KEY}`);
logger.log(`CSV: ${CSV_FILE}`);
logger.log(`Mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);
logger.log(`Skip if milestone exists: ${SKIP_IF_MILESTONE_EXISTS || "(none)"}`);

logger.group("run updateMilestones");
run();
logger.groupEnd();
