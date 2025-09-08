import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { decode } from "iconv-lite";
import { extname, join } from "path";

// 入力元と出力先のフォルダを指定
const inputDir: string = "./csv/input_shift_jis";
const outputDir: string = "./csv/input_utf_8";

try {
  // 出力フォルダが存在しない場合は作成する
  mkdirSync(outputDir, { recursive: true });

  // 入力フォルダ内のファイル一覧を取得
  const files: string[] = readdirSync(inputDir);

  for (const file of files) {
    // .csvファイルのみを対象にする (大文字小文字を区別しない)
    if (extname(file).toLowerCase() !== ".csv") {
      continue;
    }

    const inputPath = join(inputDir, file);
    const outputPath = join(outputDir, file);

    // ファイルをバイナリ(Buffer)として読み込む
    const buffer: Buffer = readFileSync(inputPath);

    // Shift_JISからUTF-8文字列にデコードする
    const utf8Text: string = decode(buffer, "shift_jis");

    // UTF-8として新しいファイルに書き出す
    writeFileSync(outputPath, utf8Text, { encoding: "utf8" });

    console.log(`✅ Converted: ${inputPath} -> ${outputPath}`);
  }
  console.log("\n✨ 全てのCSVファイルの変換が完了しました。");
} catch (error) {
  console.error("エラーが発生しました:", error);
}
