#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// `open` モジュールを動的インポートに変更
const openBrowser = async (url) => {
  const open = await import("open");
  return open.default(url);
};

////////////////////////////////////////////////////////////////////////

const GITHUB_CLIENT_ID = "Ov23lil4jJ8g3BqALGwz";
const TOKEN_FILE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".config/pr-graph/token.json"
);
const OUT_FILE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".config/pr-graph/index.html"
);
////////////////////////////////////////////////////////////////////////

/**
 * 1. 既存のトークンファイルを読み込み
 *    - 存在しなければ null を返す
 */
function loadCachedToken() {
  try {
    if (fs.existsSync(TOKEN_FILE_PATH)) {
      const raw = fs.readFileSync(TOKEN_FILE_PATH, "utf-8");
      const data = JSON.parse(raw);
      // data.access_token, data.created_at などを想定
      return data;
    }
  } catch (err) {
    console.error("[WARN] トークンファイル読み込みエラー:", err);
  }
  return null;
}

/**
 * 2. トークンをファイルに保存
 */
function saveToken(data) {
  try {
    // ディレクトリが無い場合に備え、~/.config/pr-graph を作成
    fs.mkdirSync(path.dirname(TOKEN_FILE_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
    console.log(`[INFO] 新しいトークンを保存しました: ${TOKEN_FILE_PATH}`);
  } catch (err) {
    console.error("[ERROR] トークンファイル保存エラー:", err);
  }
}

/**
 * 3. トークンの有効性を簡易チェック (/user API)
 *    - 200 が返れば有効、401などなら無効
 */
async function checkTokenValidity(token) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.ok) {
    // 有効 → ユーザー情報を返す
    const user = await res.json();
    return user;
  } else {
    // 無効 (401,403など)
    return null;
  }
}

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
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 404) {
    throw new Error(`リポジトリ ${owner}/${repo} が見つかりませんでした。`);
  }
  if (!res.ok) {
    throw new Error(`GitHub API failed: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

/**
 * 4. Mermaid グラフを生成
 */
function buildMermaidCode(prList) {
  let mermaid = "graph RL\n";
  for (const pr of prList) {
    // タイトルに mermaid で使えない文字がある場合は空白で置換する
    const label = pr.title.replace(/\n|\[|\]|\(|\)|:/g, " ");
    const node = `PR#${pr.number} ${label}`;
    mermaid += `  ${pr.head.ref} --> |${node}| ${pr.base.ref}\n`;
    mermaid += `  click ${pr.head.ref} href "${pr.html_url}"\n`;
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
  <title>Pull Request Graph</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
</head>
<body>
  <h1>Pull Request Graph</h1>
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
    if (!GITHUB_CLIENT_ID) {
      throw new Error(
        "GITHUB_CLIENT_ID が未設定です。コード内を編集してください。"
      );
    }
    // 1 キャッシュからトークン読み込み
    let tokenData = loadCachedToken();
    let token = tokenData?.access_token;

    // 2 トークンがある場合は有効か確認
    if (token) {
      console.log(
        "[INFO] キャッシュ済みトークンが見つかりました。有効性をチェックします..."
      );
      const user = await checkTokenValidity(token);
      if (!user) {
        console.log(
          "[INFO] トークンが無効または期限切れです。再ログインします..."
        );
        token = null;
      } else {
        console.log(`[INFO] 有効なトークンです。ユーザー: ${user.login}`);
      }
    }

    // 3 トークンが無い or 無効なら Device Flow で認証
    if (!token) {
      token = await getAccessTokenByDeviceFlow(GITHUB_CLIENT_ID, "repo");
      // 保存
      const newTokenData = {
        access_token: token,
        created_at: new Date().toISOString(),
      };
      saveToken(newTokenData);
    }

    // 4. origin URLからオーナー/リポジトリを取得
    const originUrl = getOriginUrl();
    const { owner, repo } = parseGitHubRepo(originUrl);

    // 5. Pull Request 一覧を取得
    console.log(`[INFO] Fetching Pull Requests for ${owner}/${repo} ...`);
    const prList = await fetchPullRequests(owner, repo, token);
    console.log(`[INFO] Found ${prList.length} PR(s).`);

    // 6. Mermaid コードを生成
    const mermaidCode = buildMermaidCode(prList);

    // 7. index.html を生成
    const html = buildIndexHtml(mermaidCode);
    fs.writeFileSync(OUT_FILE_PATH, html, "utf8");

    // 8. 自動的にブラウザで開く
    const fileUrl = `file://${OUT_FILE_PATH}`;
    console.log(`[INFO] index.html を生成しました: ${OUT_FILE_PATH}`);
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
