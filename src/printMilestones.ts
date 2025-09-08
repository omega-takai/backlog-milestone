import { config } from "dotenv";
import { createRunLogger } from "./logger";
import { fetchMilestoneMap } from "./backlogApi";

config();

const LOG_DIR = process.env.LOG_DIR || "logs";
const SPACE_URL = process.env.BACKLOG_SPACE_URL!;
const PROJECT_KEY = process.env.BACKLOG_PROJECT_KEY!;

async function main() {
  const { logger, filePath } = createRunLogger(LOG_DIR, "milestones-list");
  logger.log(`Log file: ${filePath}`);
  logger.log(`Space: ${SPACE_URL}, Project: ${PROJECT_KEY}`);
  await fetchMilestoneMap(logger);
  logger.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
