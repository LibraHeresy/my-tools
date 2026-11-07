import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const bundles = process.argv[2] ?? "msi,nsis";
const keyPath = ".tauri/updater.key";
const passwordPath = ".tauri/updater-password.txt";

if (!existsSync(keyPath) || !existsSync(passwordPath)) {
  console.error(
    "缺少更新签名密钥。请确认 .tauri/updater.key 和 .tauri/updater-password.txt 存在。",
  );
  process.exit(1);
}

const privateKey = readFileSync(keyPath, "utf8").trim();
const password = readFileSync(passwordPath, "utf8").trim();
if (!privateKey || !password) {
  console.error("更新签名密钥或密码为空。");
  process.exit(1);
}

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(
  command,
  ["tauri", "build", "--bundles", bundles],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: privateKey,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
    },
  },
);

process.exit(result.status ?? 1);
