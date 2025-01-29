import { spawnSync } from "child_process";

/**
 * gh CLI を使ってプルリクエスト一覧を取得します。
 */
export function getPullRequests() {
  const result = spawnSync(
    "gh",
    [
      "pr",
      "list",
      "--json",
      "number,baseRefName,headRefName,title,isDraft,url",
    ],
    { encoding: "utf-8" }
  );

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
    const title = pr.title.replace(/"/g, "#quot;"); // ダブルクォーテーションをエスケープする

    // node
    const baseNode = pr.baseRefName;
    const headNode = pr.headRefName;
    const headNodeLabel = title;

    // link
    const link = pr.isDraft ? "Draft" : "Open";

    // append code
    mermaid += `  ${headNode}("${headNodeLabel}") --> |${link}| ${baseNode}\n`;
    mermaid += `  click ${headNode} href "${pr.url}" _blank\n`;
  }

  return mermaid;
}

export function getRepositoryName() {
  const result = spawnSync("gh", ["repo", "view", "--json", "name"], {
    encoding: "utf-8",
  });

  // コマンド実行時のエラー処理
  if (result.error) {
    console.error("gh コマンドの実行に失敗しました:", result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("gh コマンドがエラーを返しました:\n", result.stderr);
    process.exit(result.status ?? 1);
  }

  // JSON をパースしてリポジトリ名を返す
  const repositoryName = JSON.parse(result.stdout).name;
  return repositoryName;
}

/**
 * Mermaid.js を埋め込んだ HTML を生成します。
 */
export function buildIndexHtml(repositoryName, mermaidCode) {
  const htmlContent = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Pull Request Graph ( ${repositoryName} )</title>
  <!-- Mermaid.js を読み込み -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <!-- D3.js を読み込み -->
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
</head>
<body>
  <h1>Pull Request Graph ( ${repositoryName} )</h1>
  <div class="mermaid">
${mermaidCode}
  </div>

  <script>
    // ページ読み込み時に自動で Mermaid グラフを描画
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose'
    });
    // SVG にズーム機能を追加
    window.addEventListener('load', function () {
      var svgs = d3.selectAll(".mermaid svg");
      svgs.each(function() {
        var svg = d3.select(this);
        svg.html("<g>" + svg.html() + "</g>");
        var inner = svg.select("g");
        var zoom = d3.zoom().on("zoom", function(event) {
          inner.attr("transform", event.transform);
        });
        svg.call(zoom);
      });
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
