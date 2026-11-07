# 自动更新发布说明

当前使用 Tauri 2 Updater、GitHub Releases 和 GitHub Actions。

## 一次性配置

更新签名密钥已经在本机生成：

- 私钥：`.tauri/updater.key`
- 密码：`.tauri/updater-password.txt`
- 公钥：已写入 `src-tauri/tauri.conf.json`

把私钥和密码写入 GitHub Actions Secrets：

```powershell
gh secret set TAURI_SIGNING_PRIVATE_KEY --body (Get-Content .tauri/updater.key -Raw)
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body (Get-Content .tauri/updater-password.txt -Raw)
```

如果使用 GitHub 网页，也可以手动添加同名 Secret。

私钥和密码不能提交到仓库；`.tauri/` 已在 `.gitignore` 中忽略。

## 发布新版本

1. 修改三处版本号：
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. 更新 `src/app/AboutDialog.tsx`、`src/app/AppShell.tsx`、`src/pages/HomePage.tsx` 中的版本显示。
3. 提交改动。
4. 创建并推送版本标签：

```powershell
git tag v0.8.0
git push origin v0.8.0
```

5. GitHub Actions 会构建 MSI 和 NSIS，并发布 Release 及 `latest.json`。
6. 已安装 NSIS 版本的用户会自动收到更新提示。

本地验证构建可以使用：

```powershell
pnpm build:release
```

该脚本会自动读取 `.tauri/updater.key` 和 `.tauri/updater-password.txt`，不需要手动设置环境变量。

## 重要说明

- 0.7.0 的 MSI 版本还没有内置 updater，需要手动安装一次 0.8.0。
- 自动更新针对 NSIS 安装版；便携 zip 不适合原地自动更新。
- 发布前需要确保两个签名 Secret 已设置，否则 GitHub Actions 无法生成可验证的更新包。
- Windows 代码签名证书是可选项；没有它仍会有 SmartScreen 提示。
- 丢失 `.tauri/updater.key` 或密码后，已有安装无法验证后续更新，需要重新分发安装包。
