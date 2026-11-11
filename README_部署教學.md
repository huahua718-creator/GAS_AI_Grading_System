# 🎓 AI 智慧批改與教學助手系統 - 部署與操作手冊

本系統為專為 K-12 與大專院校教師設計的自動化作業批改與教學輔助平台，深度整合 **Google Classroom**、**Google Drive**、**Google Docs**、**Google Sheets** 與 **Gemini 2.5 Flash AI**，並支援 **電腦主控台與手機無線語音雙裝置無縫聯動**。

---

## 📁 交付檔案目錄結構

桌面資料夾 `GAS_AI_Grading_System` 包含以下完整交付檔案：

| 檔案名稱 | 類型 | 說明 |
| :--- | :--- | :--- |
| **`Code.gs`** | Apps Script 後端代碼 | 包含 Classroom/Drive API 整合、3-Gram 相似度演算法、Gemini 2.5 多模態評分、雙裝置快取與總表寫入 |
| **`WebAppPC.html`** | 前端主控台 (PC) | 電腦端作業檢視、動態規準編輯、全班批次批改、即時預覽與成績同步 |
| **`WebAppMobile.html`** | 前端遙控端 (手機) | 手機 WebRTC 語音即時口述批註、AI 示範重寫與學生狀態輪詢 |
| **`appsscript.json`** | GAS 專案資訊清單 | 宣告 OAuth 授權範圍 (Classroom, Drive, Docs, Sheets) 與進階服務依賴 |
| **`學生作業與成績總表範本.xlsx`** | Excel / 試算表範本 | 提供完整表頭與樣式（含《成績總表》、《全班作業分析與重複辨識表》、《評分規準範本》三個分頁） |
| **`README_部署教學.md`** | 部署指引 | 本份完整圖文部署與維運說明書 |

---

## 🚀 步驟一：建立 Google Apps Script 專案

1. 開啟瀏覽器，登入您的 Google 教育或個人帳號，前往 [Google Apps Script 控制台](https://script.google.com/)。
2. 點選左上方 **「＋ 新專案」**。
3. 將專案名稱重新命名為：`AI智慧批改與教學助手系統`。

---

## ⚙️ 步驟二：設定 `appsscript.json` 專案清單與權限

1. 在 GAS 編輯器左側導覽列中，點選齒輪圖示 **「專案設定」**。
2. 勾選 **「在編輯器中顯示『appsscript.json』資訊清單檔案」**。
3. 切換回左側 **「編輯器」**（代碼圖示 `<>`），此時會看到 `appsscript.json`。
4. 點開 `appsscript.json`，將交付的 `appsscript.json` 完整內容複製並覆蓋貼上，然後按 `Ctrl + S` 存檔。

---

## 📝 步驟三：匯入後端代碼與前端網頁

在編輯器中建立以下 3 個檔案（**名稱請務必完全一致，區分大小寫**）：

### 1. 後端主腳本：`Code.gs`
* 點選預設的 `程式碼.gs`（或重新命名為 `Code.gs`）。
* 將桌面交付資料夾中的 `Code.gs` 內容全部複製並貼上，按 `Ctrl + S` 存檔。

### 2. 電腦端主控台網頁：`WebAppPC.html`
* 點選檔案清單上方的 **「＋」** ➜ 選擇 **「HTML」**。
* 檔名輸入：`WebAppPC`（系統會自動加上 `.html`）。
* 將 `WebAppPC.html` 內容全部複製並貼上，按 `Ctrl + S` 存檔。

### 3. 手機端遙控網頁：`WebAppMobile.html`
* 再次點選 **「＋」** ➜ 選擇 **「HTML」**。
* 檔名輸入：`WebAppMobile`。
* 將 `WebAppMobile.html` 內容全部複製並貼上，按 `Ctrl + S` 存檔。

---

## 🔌 步驟四：啟用 Google Apps Script 進階服務 (Advanced Services)

本系統需存取 Classroom 與 Drive 進階 API：

1. 在 GAS 編輯器左側選單中，找到 **「服務」** (Services) 旁的 **「＋」** 號。
2. 新增第一項服務：
   * 搜尋並選擇 **`Google Classroom API`**。
   * 版本選擇：`v1`。
   * 識別碼維持預設：`Classroom`。
   * 點選 **「新增」**。
3. 新增第二項服務：
   * 再次點選 **「＋」** 號。
   * 搜尋並選擇 **`Drive API`**。
   * 版本選擇：`v2`。
   * 識別碼維持預設：`Drive`。
   * 點選 **「新增」**。

---

## 🌐 步驟五：部署為網頁應用程式 (Web App)

1. 點選右上角藍色按鈕 **「部署」** ➜ **「新增部署作業」**。
2. 點選齒輪圖示「選取類型」➜ 選擇 **「網頁應用程式」**。
3. 填寫部署設定（**極重要，請依規格設定**）：
   * **說明**：`AI 智慧批改系統正式版 v1.0`
   * **以誰的身分執行 (Execute as)**：選擇 **`存取網頁應用程式的使用者 (User accessing the web app)`**（確保每位教師資料獨立隔離）
   * **誰可以存取 (Who has access)**：選擇 **`任何擁有 Google 帳戶的使用者`**（或學校網域內部）
4. 點選 **「部署」**。
5. 首次部署時，Google 會跳出「需要授權」對話框：
   * 選擇您的 Google 帳戶。
   * 若出現「Google 尚未驗證這個應用程式」，點選左下角「進階」➜ 點選「前往『AI智慧批改與教學助手系統』(不安全)」。
   * 勾選允許所有權限（Classroom、Drive、Docs、Sheets 等）。
6. 部署完成後，複製產生的 **網頁應用程式網址 (Web App URL)**。

---

## 📊 步驟六：準備 Google Sheets 成績總表

1. 將桌面資料夾中的 **`學生作業與成績總表範本.xlsx`** 上傳至您的 Google 雲端硬碟 (Google Drive)。
2. 在 Google Drive 中對該 Excel 檔按右鍵 ➜ 選擇 **「以 Google 試算表開啟」**。
3. 點選功能表 **「檔案」➜「另存為 Google 試算表」**。
4. 複製網址列中的 **試算表 ID**（即 `/d/` 與 `/edit` 之間的那串英數代碼）：
   ```text
   https://docs.google.com/spreadsheets/d/【這段英數代碼即為試算表ID】/edit
   ```
5. 試算表內建三大專業工作表：
   * **`成績總表`**：系統自動以「學號」進行列對齊比對匯入作業分數與總評。
   * **`全班作業分析與重複辨識表`**：自動記錄 3-Gram Jaccard 重複率判定與同組/抄襲分析。
   * **`評分規準範本 (Rubric)`**：提供報告與手寫 STEM 學習單之評量指標參考。

---

## 🔑 步驟七：教師首次使用與雙裝置操作流程

### 1. 教師個人金鑰與試算表設定 (UserProperties)
* 用電腦開啟步驟五取得的 Web App 網址。
* 首次進入會自動彈出「教師設定」視窗：
  * **Gemini API Key**：貼上您從 [Google AI Studio](https://aistudio.google.com/app/apikey) 免費取得的 API 金鑰。
  * **Google Sheets 成績總表 ID**：貼上步驟六取得的試算表 ID。
  * 點選 **「儲存設定」**。
  *(系統會透過 UserProperties 將設定綁定於您本人的 Google 帳戶，不同教師共用同網址也不會互相覆蓋或外洩)*。

### 2. 電腦主控台批改作業
* 於上方選單下拉選擇您的 **Google Classroom 課程** 與 **作業項目**。
* 系統會自動撈取學生名單與繳交檔案，並進行格式分流轉檔：
  * **Google Docs**：直接讀取與評閱。
  * **Word (.docx)**：系統自動建立 `[AI批改]` Google Doc 副本並保留學生原始 Word 檔。
  * **手寫照片/PDF**：自動建立專用 Companion Google Doc，以利寫入講評。
* 點選 **「自訂規準 (Rubrics)」** 可自由新增、刪除或調整評分細項與配分。
* 點選 **「全班 AI 批改與相似度分析」**：
  * 自動執行 **3-Gram + Jaccard 演算法** 比對全班文字重疊率，高於 80% 自動標記 `⚠️【高度相似/同組】`。
  * 呼叫 **Gemini 2.5 Flash** 生成評分表格與建議，並自動格式化附加於學生文件的**最末端**。
* 點選 **「同步至總表」**：以「學號」為唯一 Key 精準寫入 Google Sheets 成績總表！

### 3. 手機無線語音遙控器 (WebRTC 口述批註)
* 在電腦主控台右上角點選 **「手機遙控端」**，螢幕會顯示專屬 QR Code。
* 拿手機開啟相機掃描 QR Code 開啟網頁（無須安裝任何 App）。
* 在電腦上點選任一位學生，手機螢幕 **每 2 秒自動同步** 顯示當前學生姓名與學號！
* 點擊手機螢幕中央的大麥克風按鈕開始說話口述批語，說完再次點擊送出。
* Gemini 2.5 Flash 會自動辨識口述、整理重點摘要並提供一段精美的示範重寫，**即時插入至電腦端該學生的 Google Doc 文末**！

