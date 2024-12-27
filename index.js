#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// `open` モジュールを動的インポートに変更
const openBrowser = async (url) => {
  const open = await import("open");
  return open.default(url);
};

// Node.js v18以上でも、これを使うと簡単
// Node.js v18 以上ならグローバル fetch が使える（実験的）。v18未満なら:
// const fetch = require('node-fetch');

////////////////////////////////////////////////////////////////////////

// ここをご自分のOAuth Appのclient_idに置き換える
const GITHUB_CLIENT_ID = "Iv23lisQN8lbBUcUl7yL";

////////////////////////////////////////////////////////////////////////

/**
 * 1. ローカルGitリポジトリの origin URLを取得し、owner/repo を解析
 */
function getOriginUrl() {
  try {
    return execSync("git remote get-url origin", { stdio: "pipe" })
      .toString()
      .trim();
  } catch (err) {
    console.error("[ERROR] git remote get-url origin に失敗しました。");
    process.exit(1);
  }
}

function parseGitHubRepo(originUrl) {
  const cleaned = originUrl.replace(/\.git$/, "");
  const sshMatch = cleaned.match(/^git@github\.com:([^/]+)\/(.+)$/);
  const httpsMatch = cleaned.match(/^https?:\/\/github\.com\/([^/]+)\/(.+)$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  } else if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  } else {
    console.error(`[ERROR] GitHubリポジトリ形式が想定外: ${originUrl}`);
    process.exit(1);
  }
}

/**
 * 2. GitHub Device Flow でユーザにログインしてもらい、アクセストークンを取得
 */
async function getAccessTokenByDeviceFlow(clientId, scope = "repo") {
  // Device Flow開始
  const deviceCodeRes = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: scope }),
  });
  if (!deviceCodeRes.ok) {
    throw new Error(`Device code request failed: ${deviceCodeRes.status}`);
  }

  // レスポンスをテキストとして取得し、URLSearchParams でパース
  const deviceCodeText = await deviceCodeRes.text();
  const deviceCodeData = Object.fromEntries(
    new URLSearchParams(deviceCodeText)
  );

  console.log("-----------------------------------------------------");
  console.log(
    " 以下のURLにブラウザでアクセスし、指示に従ってログインしてください:"
  );
  console.log("   ", deviceCodeData.verification_uri);
  console.log(" User Code:", deviceCodeData.user_code);
  console.log("-----------------------------------------------------");

  const deviceCode = deviceCodeData.device_code;
  const interval = deviceCodeData.interval || 5; // 秒
  const expiresIn = deviceCodeData.expires_in || 900; // 秒

  // ユーザのログインが完了するまでポーリング
  const start = Date.now();
  while (true) {
    const elapsed = (Date.now() - start) / 1000; //秒
    if (elapsed > expiresIn) {
      throw new Error("認証がタイムアウトしました。再実行してください。");
    }
    // interval秒待つ
    await new Promise((r) => setTimeout(r, interval * 1000));

    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      }
    );
    if (!tokenRes.ok) {
      throw new Error(`Token request failed: ${tokenRes.status}`);
    }
    const tokenData = await tokenRes.json();

    if (tokenData.error === "authorization_pending") {
      continue; // まだ認可されていない
    } else if (tokenData.error === "slow_down") {
      console.log("[INFO] slow_down: 待ち時間を増やします。");
      // interval += 5; などしてもOK
      continue;
    } else if (tokenData.error) {
      throw new Error(`Device flow error: ${tokenData.error}`);
    } else if (tokenData.access_token) {
      return tokenData.access_token; // トークン取得完了
    }
  }
}

/**
 * 3. Pull Requests 一覧を取得
 */
async function fetchPullRequests(owner, repo, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API failed: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

/**
 * 4. Mermaid グラフを生成
 */
function buildMermaidCode(prList) {
  let mermaid = "graph LR\n";
  for (const pr of prList) {
    mermaid += `  ${pr.head.ref} --> |PR#${pr.number}| ${pr.base.ref}\n`;
  }
  return mermaid;
}

/**
 * 5. index.html を生成
 */
function buildIndexHtml(mermaidCode) {
  return `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>PullRequest Visualization (Device Flow)</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
</head>
<body>
  <h1>Pull Request Visualization (Private Repo via Device Flow)</h1>
  <div class="mermaid">
${mermaidCode}
  </div>
  <script>
    mermaid.initialize({ startOnLoad: true });
  </script>
</body>
</html>
`;
}

/**
 * 6. メイン処理
 */
(async function main() {
  try {
    // 事前チェック
    if (
      !GITHUB_CLIENT_ID ||
      GITHUB_CLIENT_ID.includes("YOUR_OAUTH_CLIENT_ID_HERE")
    ) {
      throw new Error(
        "GITHUB_CLIENT_ID が未設定です。コード内を編集してください。"
      );
    }

    // 1. origin URLからオーナー/リポジトリを取得
    const originUrl = getOriginUrl();
    const { owner, repo } = parseGitHubRepo(originUrl);

    // 2. Device Flow でログインしてアクセストークンを取得
    console.log("[INFO] Device Flow を開始します...");
    const token = await getAccessTokenByDeviceFlow(GITHUB_CLIENT_ID, "repo");

    // 3. Pull Request 一覧を取得
    console.log(`[INFO] Fetching Pull Requests for ${owner}/${repo} ...`);
    const prList = await fetchPullRequests(owner, repo, token);
    console.log(`[INFO] Found ${prList.length} PR(s).`);

    // 4. Mermaid コードを生成
    const mermaidCode = buildMermaidCode(prList);

    // 5. index.html を生成
    const html = buildIndexHtml(mermaidCode);
    const outPath = path.join(process.cwd(), "dist/index.html");
    fs.writeFileSync(outPath, html, "utf8");

    // 6. 自動的にブラウザで開く
    const fileUrl = `file://${outPath}`;
    console.log(`[INFO] index.html を生成しました: ${outPath}`);
    console.log("[INFO] ブラウザで自動オープンを試みます...");
    await openBrowser(fileUrl);
    console.log(
      "[INFO] ブラウザが開かない場合は、上記パスを手動で開いてください。"
    );
  } catch (err) {
    console.error("[ERROR]", err);
    process.exit(1);
  }
})();
