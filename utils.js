import { spawnSync } from "child_process";

/**
 * gh CLI を使ってプルリクエスト一覧を取得します。
 */
export function getPullRequests() {
  const result = spawnSync(
    "gh",
    ["pr", "list", "--json", "number,baseRefName,headRefName,title,url"],
    { encoding: "utf-8" }
  );
  console.log("[DEBUG] gh コマンドの実行結果:", result);

  // コマンド実行時のエラー処理
  if (result.error) {
    console.error("gh コマンドの実行に失敗しました:", result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("gh コマンドがエラーを返しました:\n", result.stderr);
    process.exit(result.status ?? 1);
  }

  // JSON をパースして配列として返す
  const prList = JSON.parse(result.stdout);
  return prList;
}

/**
 * プルリクエスト一覧から Mermaid.js 用のコードを生成します。
 */
export function buildMermaidCode(prList) {
  let mermaid = "graph RL\n";

  for (const pr of prList) {
    // Mermaid で使えない文字を空白に置換
    const label = pr.title.replace(/\n|\[|\]|\(|\)|:/g, " ");
    const node = `PR#${pr.number} ${label}`;
    // headRefName から baseRefName へ矢印を描画
    mermaid += `  ${pr.headRefName} --> |${node}| ${pr.baseRefName}\n`;
    // クリック時に PR URL を開く
    mermaid += `  click ${pr.headRefName} href "${pr.url}"\n`;
  }

  return mermaid;
}

/**
 * Mermaid.js を埋め込んだ HTML を生成します。
 */
export function buildIndexHtml(mermaidCode) {
  const htmlContent = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>PullRequest Visualization</title>
  <!-- Mermaid.js を読み込み -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
</head>
<body>
  <h1>Pull Request Visualization</h1>
  <div class="mermaid">
${mermaidCode}
  </div>

  <script>
    // ページ読み込み時に自動で Mermaid グラフを描画
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default'
    });
  </script>
</body>
</html>
`;
  return htmlContent;
}

/**
 * 指定した URL をデフォルトブラウザで開きます。
 * `open` は動的 import により読み込まれます。
 */
export async function openBrowser(url) {
  const openModule = await import("open");
  return openModule.default(url);
}
