import { config } from "dotenv";

config();

const DELAY_MS = parseInt(process.env.DELAY_MS || "800");

export function parseBoolean(input: string | undefined): boolean {
  if (!input) return false;
  return ["1", "true", "t", "yes", "y", "on"].includes(input.toLowerCase());
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// レート制限対応のための待機関数
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 429エラー時のリトライ機能付きAPI呼び出し
export async function fetchWithRetry<T>({
  apiCall,
  maxRetries = 3, // デフォルト: 3回 (Backlog APIのレート制限は一時的なため、3回で十分)
  baseDelay = DELAY_MS, // デフォルト: 800ms (Backlog APIの書き込み系は60req/min制限のため、理論値1秒から20%安全マージンを引いた値)
  logger,
}: {
  apiCall: () => Promise<T>;
  maxRetries?: number;
  baseDelay?: number;
  logger?: { log: (...args: unknown[]) => void };
}): Promise<T> {
  const retries = maxRetries; // 3回: レート制限は通常一時的で、3回のリトライで十分
  const delay = baseDelay; // 800ms: Backlog APIの制限(60req/min)に対応するため理論値1000msから20%安全マージンを引いた値
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await apiCall();
    } catch (error: any) {
      if (error.response?.status === 429 && attempt < retries) {
        const backoffDelay = delay * Math.pow(2, attempt - 1); // 指数バックオフ: 1秒→2秒→4秒で段階的に待機時間を増加
        logger?.log(
          `429エラー検出。${backoffDelay}ms待機後にリトライ (${attempt}/${retries})`
        );
        await sleep(backoffDelay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("最大リトライ回数に達しました");
}
