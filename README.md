# 🎓 AI 智慧批改助手 (Google Docs Sidebar + Vercel 手機語音端)

專為高中與大專院校教師設計的 AI 作業批改與教學輔助系統，結合 **Google Docs 側邊欄**、**Google Classroom**、**Google Sheets**，以及部署於 **Vercel** 的 **手機語音口述遙控端** 與 **Gemini 3.8 Flash AI**。

---

## 🌟 核心架構與三大優勢

1. **Google Docs 原生側邊欄（方案 A，免外掛審查）**：
   * 在「教師批改主控台」Google 文件中，點選選單 `🎓 AI 智慧批改助手 ➜ 開啟批改側邊欄 (Sidebar)`。
   * 自動載入 Classroom 課程、作業項目與學生作業檔案，滑鼠點擊學生即可開啟學生報告連結。
2. **手機無線語音標註（Vercel 頂層 HTTPS）**：
   * 點擊 Sidebar 的手機圖示顯示配對 QR Code，手機相機掃碼立即開啟 Vercel 手機錄音網頁。
   * 頂層 HTTPS 完美支援 iOS Safari 與 Android 麥克風錄音，口述完成自動透過 Gemini 3.8 Flash 生成重點摘要與優化重寫範例，**自動寫入學生 Google Doc 最末端**。
3. **純粹 BYOK（金鑰零落地）**：
   * 老師自行在 Google AI Studio 申請個人 Gemini API Key（支援免費額度）。
   * 金鑰僅儲存在教師本機與瀏覽器，每次透過 HTTPS Header 直送 Gemini API，Vercel 伺服器與 Redis 完全不儲存金鑰，**即便學校帳號封鎖 Gemini API 也能正常使用，且分享給其他老師也不會消耗您的額度**。

---

## 🚀 部署指南

### 第一部分：Vercel 網站部署（已完成連動）

本專案已連結至您的 Vercel 專案 `gasgradingsystem`，並已完成 **Upstash for Redis** 免費版整合。
每當代碼推送到 GitHub `main` 分支時，Vercel 會自動觸發構建與部署：

* **Vercel Production URL**: `https://gasgradingsystem.vercel.app`
* **API 端點**:
  * `POST /api/voice`: 接收手機口述錄音，呼叫 Gemini 3.8 Flash 回傳轉寫與示範重寫。
  * `POST /api/assess`: 接收學生作業文字/圖片，依規準 (Rubrics) 回傳 AI 評分與綜合講評。
  * `GET/POST /api/session`: 透過 Upstash Redis 進行雙裝置目前選定學生與語音回饋隊列同步。

---

### 第二部分：Google Docs 側邊欄安裝（方案 A）

1. **建立教師批改主控台文件**：
   * 使用您的學校/Classroom 帳號登入 Google Drive。
   * 建立一份新的 Google 文件，命名為：`【AI智慧批改主控台】`。
2. **複製 Apps Script 檔案**：
   * 在該 Google 文件上方選單點選 **「擴充功能」➜「Apps Script」**。
   * 專案名稱改為：`AI智慧批改助手`。
   * 將本專案 `gas/` 資料夾中的檔案內容複製貼上至 Apps Script 編輯器：
     * `Code.gs` ➜ 複製 [`gas/Code.gs`](gas/Code.gs) 內容。
     * 點選「＋ ➜ HTML」，檔名為 `Sidebar` ➜ 複製 [`gas/Sidebar.html`](gas/Sidebar.html) 內容。
     * 點選「專案設定」➜ 勾選「顯示 appsscript.json」，將 [`gas/appsscript.json`](gas/appsscript.json) 內容貼上覆蓋。
3. **啟用進階服務 (Advanced Services)**：
   * 點選左側「服務」旁的 **「＋」** 號。
   * 新增 **Google Classroom API**（版本 `v1`，識別碼 `Classroom`）。
   * 再次點選 **「＋」** 號，新增 **Drive API**（版本 `v2`，識別碼 `Drive`）。
4. **重新整理 Google 文件**：
   * 回到 Google 文件頁面按 `F5` 重新整理。
   * 上方工具列會出現 **「🎓 AI 智慧批改助手」** 選單。
   * 點選 **「開啟批改側邊欄 (Sidebar)」**，首次執行依提示同意授權即可。

---

## 🔑 首次使用設定

1. **在 Sidebar 點選齒輪設定**：
   * **Gemini API Key**: 貼上您個人在 [Google AI Studio](https://aistudio.google.com/app/apikey) 申請的 API Key。
   * **Google Sheets 成績總表 ID**: 建立或上傳試算表總表，貼上網址中的 ID。
   * **Vercel 網址**: 預設為 `https://gasgradingsystem.vercel.app`。
2. **手機端配對**：
   * 點選 Sidebar 手機圖示開啟 QR Code。
   * 手機掃描開啟網頁，於手機設定視窗中貼上您的 Gemini API Key（純粹 BYOK，儲存於手機瀏覽器 LocalStorage）。
   * 電腦點選任一位學生，手機即時顯示該生姓名，點擊麥克風即可隨時口述批註！

