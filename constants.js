import path from "path";

export const OUT_FILE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".config/pr-graph/index.html"
);
