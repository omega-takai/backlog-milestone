import fs from "fs";
import csv from "csv-parser";
import { uniq, fetchWithRetry } from "./utils";
import { createRunLogger } from "./logger";
import {
  fetchIssueDetail,
  fetchMilestoneMap,
  patchIssueMilestones,
} from "./backlogApi";
import { env, isDryRun, validateRequiredEnvVars } from "./config";

validateRequiredEnvVars();

const {
  BACKLOG_SPACE_URL,
  BACKLOG_PROJECT_KEY,
  CSV_FILE,
  LOG_DIR,
  TARGET_MILESTONE,
  SKIP_IF_MILESTONE_EXISTS,
  ISSUE_KEY_COLUMN,
} = env;

interface CsvRow {
  [key: string]: string;
}

const DRY_RUN = isDryRun();

const logFilePath = DRY_RUN ? `add-milestone-dry-run` : `add-milestone`;
const { logger, filePath: LOG_FILE } = createRunLogger(LOG_DIR, logFilePath);

type AddMilestoneToIssueParams = {
  issueKey: string;
  milestoneName: string;
  milestoneMap: Record<string, number>;
  processedCount: number;
  totalCount: number;
};

async function addMilestoneToIssue({
  issueKey,
  milestoneName,
  milestoneMap,
  processedCount,
  totalCount,
}: AddMilestoneToIssueParams): Promise<void> {
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

  if (!milestoneMap[milestoneName]) {
    logger.error(
      `指定のマイルストーンが存在しません: \"${milestoneName}\"`,
      `プロジェクト=${BACKLOG_PROJECT_KEY}`
    );
    logger.groupEnd();
    return;
  }

  const afterNames = uniq([...beforeMilestoneNames, milestoneName]);
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

async function run() {
  if (!TARGET_MILESTONE) {
    logger.error(
      "TARGET_MILESTONE 環境変数が未指定です。例: TARGET_MILESTONE=v1.0 pnpm run add-milestone"
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

    try {
      await addMilestoneToIssue({
        issueKey,
        milestoneName: TARGET_MILESTONE,
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
logger.log(`Target Milestone: ${TARGET_MILESTONE || "(none)"}`);
logger.log(`Skip if milestone exists: ${SKIP_IF_MILESTONE_EXISTS || "(none)"}`);

logger.group("run addMilestone");
run();
logger.groupEnd();
