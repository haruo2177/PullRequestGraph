#!/usr/bin/env node
import fs from "fs";
import {
  getPullRequests,
  buildMermaidCode,
  buildIndexHtml,
  openBrowser,
} from "./utils.js";
import { OUT_FILE_PATH } from "./constants.js";

// プルリクエスト一覧を取得
const pullRequests = getPullRequests();
console.log("[INFO] プルリクエスト一覧を取得しました:", pullRequests);

// Mermaid コードを生成
const mermaidCode = buildMermaidCode(pullRequests);

// index.html を生成
const html = buildIndexHtml(mermaidCode);

// ファイルに書き出し
fs.writeFileSync(OUT_FILE_PATH, html, "utf8");

// ブラウザで開くためのファイル URL を作成
const fileUrl = `file://${OUT_FILE_PATH}`;
console.log(`[INFO] index.html を生成しました: ${OUT_FILE_PATH}`);
console.log("[INFO] ブラウザで自動オープンを試みます...");

// ブラウザを自動で開く
openBrowser(fileUrl).then(() => {
  console.log(
    "[INFO] ブラウザが開かない場合は、上記パスを手動で開いてください。"
  );
});
