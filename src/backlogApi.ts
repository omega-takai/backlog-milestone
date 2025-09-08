import axios from "axios";
import { config } from "dotenv";

config();

const API_KEY = process.env.BACKLOG_API_KEY!;
const SPACE_URL = process.env.BACKLOG_SPACE_URL!;
const PROJECT_KEY = process.env.BACKLOG_PROJECT_KEY!;

export type LoggerLike = {
  log: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

export interface Milestone {
  id: number;
  name: string;
}

export interface IssueDetail {
  id: number;
  issueKey: string;
  summary: string;
  milestone?: { id: number; name: string }[];
}

/**
 * バージョン(マイルストーン)一覧の取得
 * GET /api/v2/projects/:projectIdOrKey/versions
 *
 * refs: https://developer.nulab.com/ja/docs/backlog/api/2/get-versions/
 */
export async function fetchMilestoneMap(
  logger?: LoggerLike
): Promise<Record<string, number>> {
  logger?.log(
    "→ fetchMilestoneMap",
    `${SPACE_URL}/api/v2/projects/${PROJECT_KEY}/versions`
  );
  const res = await axios.get<Milestone[]>(
    `${SPACE_URL}/api/v2/projects/${PROJECT_KEY}/versions`,
    { params: { apiKey: API_KEY } }
  );
  const map: Record<string, number> = {};
  res.data.forEach((m) => {
    map[m.name] = m.id;
  });
  if (logger) {
    logger.log("← fetchMilestoneMap ok (id, name)");
    for (const m of res.data) {
      logger.log(`  ${m.id}\t${m.name}`);
    }
  }
  return map;
}

/**
 * 課題情報の取得
 * GET /api/v2/issues/:issueIdOrKey
 *
 * refs: https://developer.nulab.com/ja/docs/backlog/api/2/get-issue/
 */
export async function fetchIssueDetail(
  issueIdOrKey: string,
  logger?: LoggerLike
): Promise<IssueDetail> {
  logger?.log("→ fetchIssueDetail", issueIdOrKey);
  const res = await axios.get<IssueDetail>(
    `${SPACE_URL}/api/v2/issues/${issueIdOrKey}`,
    { params: { apiKey: API_KEY } }
  );
  const milestones = (res.data.milestone || []).map((m) => m.name);
  logger?.log(
    "← fetchIssueDetail ok",
    issueIdOrKey,
    milestones.length
      ? `milestones=${milestones.join(",")}`
      : "milestones=(none)"
  );
  return res.data;
}

/**
 * 課題情報の更新（マイルストーン設定）
 * PATCH /api/v2/issues/:issueIdOrKey
 * params:
 * - milestoneId[]: number[] (複数可)
 *
 * refs: https://developer.nulab.com/ja/docs/backlog/api/2/update-issue/
 */
export async function patchIssueMilestones(
  issueIdOrKey: string,
  milestoneId: number[],
  logger?: LoggerLike
): Promise<void> {
  logger?.log(
    "→ patchIssueMilestones",
    issueIdOrKey,
    `milestoneId=[${milestoneId.join(", ")}]`
  );
  const formBody = milestoneId
    .map((id) => `milestoneId[]=${encodeURIComponent(String(id))}`)
    .join("&");
  const res = await axios.patch(
    `${SPACE_URL}/api/v2/issues/${issueIdOrKey}`,
    formBody,
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      params: { apiKey: API_KEY },
    }
  );
  logger?.log(
    "← patchIssueMilestones ok",
    issueIdOrKey,
    `status=${res.status}`
  );
}
