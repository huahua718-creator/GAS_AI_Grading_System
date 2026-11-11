/**
 * 🎓 AI 智慧批改與教學助手系統 (AI Teacher Assistant System)
 * 後端核心服務 Code.gs
 * 
 * 架構功能：
 * 1. doGet 路由 (PC主控台 / 手機遙控端)
 * 2. 多教師環境與權限隔離 (UserProperties)
 * 3. Google Classroom 與 Drive 檔案分流轉檔 (Word轉Doc、手寫Companion Doc)
 * 4. 3-Gram + Jaccard 全班作業相似度與分組辨識引擎
 * 5. Gemini 2.5 Flash 多模態評分引擎 (文字報告與手寫影像視覺OCR)
 * 6. 雙裝置 (PC + 手機) 無線語音遙控批註與範例重寫 (CacheService)
 * 7. 成績總表 (Master Sheet) 精準學號匹配匯入
 */

// ==========================================
// 1. 路由與 Web App 渲染
// ==========================================

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page.toLowerCase() : 'pc';
  
  if (page === 'mobile') {
    return HtmlService.createHtmlOutputFromFile('WebAppMobile')
      .setTitle('AI 智慧批改 - 手機無線語音遙控端')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  return HtmlService.createHtmlOutputFromFile('WebAppPC')
    .setTitle('🎓 AI 智慧批改與教學助手系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 取得當前 Web App 的公開 URL (供前端產生手機端 QR Code)
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

// ==========================================
// 2. 多教師環境與權限隔離模組 (UserProperties)
// ==========================================

function getTeacherSettings() {
  var userProps = PropertiesService.getUserProperties();
  return {
    apiKey: userProps.getProperty('GEMINI_API_KEY') || '',
    sheetId: userProps.getProperty('MASTER_SHEET_ID') || '',
    hasConfigured: !!(userProps.getProperty('GEMINI_API_KEY') && userProps.getProperty('MASTER_SHEET_ID'))
  };
}

function saveTeacherSettings(apiKey, sheetId) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('請輸入有效的 Gemini API Key');
  }
  if (!sheetId || !sheetId.trim()) {
    throw new Error('請輸入有效的 Google Sheets 成績總表 ID');
  }
  
  // 驗證試算表 ID 是否存在且具備存取權限
  try {
    var ss = SpreadsheetApp.openById(sheetId.trim());
    var name = ss.getName();
  } catch (err) {
    throw new Error('無法開啟成績總表，請確認 ID 正確且已開啟存取權限: ' + err.message);
  }
  
  var userProps = PropertiesService.getUserProperties();
  userProps.setProperty('GEMINI_API_KEY', apiKey.trim());
  userProps.setProperty('MASTER_SHEET_ID', sheetId.trim());
  
  return { success: true, message: '設定已安全儲存！已成功連線至試算表: ' + name };
}

// ==========================================
// 3. Google Classroom 與學生名單讀取
// ==========================================

function getClassroomCourses() {
  try {
    var response = Classroom.Courses.list({
      teacherId: 'me',
      courseStates: ['ACTIVE']
    });
    var courses = response.courses || [];
    return courses.map(function(c) {
      return { id: c.id, name: c.name, section: c.section || '' };
    });
  } catch (err) {
    throw new Error('讀取 Classroom 課程失敗: ' + err.message + ' (請確認進階服務已啟用 Classroom API)');
  }
}

function getCourseWorks(courseId) {
  try {
    var response = Classroom.Courses.CourseWork.list(courseId);
    var works = response.courseWork || [];
    return works.map(function(w) {
      return {
        id: w.id,
        title: w.title,
        maxPoints: w.maxPoints || 100,
        creationTime: w.creationTime
      };
    });
  } catch (err) {
    throw new Error('讀取作業項目失敗: ' + err.message);
  }
}

function getStudentList(courseId, courseWorkId) {
  try {
    var submissionsResponse = Classroom.Courses.CourseWork.StudentSubmissions.list(courseId, courseWorkId);
    var submissions = submissionsResponse.studentSubmissions || [];
    var resultList = [];
    
    // 預先抓取課程學生通訊錄以獲取姓名與 Email
    var rosterResponse = Classroom.Courses.Students.list(courseId);
    var studentMap = {};
    if (rosterResponse.students) {
      rosterResponse.students.forEach(function(s) {
        studentMap[s.userId] = {
          name: (s.profile && s.profile.name) ? s.profile.name.fullName : '未知學生',
          email: (s.profile && s.profile.emailAddress) ? s.profile.emailAddress : ''
        };
      });
    }

    submissions.forEach(function(sub) {
      var userId = sub.userId;
      var info = studentMap[userId] || { name: '學生 ' + userId, email: userId + '@classroom' };
      
      // 由 Email 前綴解析學號 (例如 110023@school.edu.tw -> 110023)
      var studentId = info.email ? info.email.split('@')[0] : userId;
      
      // 解析作業繳交檔案
      var fileData = resolveSubmissionFile(sub, info.name);
      
      resultList.push({
        submissionId: sub.id,
        userId: userId,
        studentId: studentId,
        studentName: info.name,
        email: info.email,
        state: sub.state, // TURNED_IN, CREATED, RETURNED
        assignedGrade: sub.assignedGrade || null,
        draftGrade: sub.draftGrade || null,
        fileId: fileData.fileId,
        fileName: fileData.fileName,
        fileType: fileData.fileType, // DOC, WORD, IMAGE, PDF, NONE
        viewUrl: fileData.viewUrl,
        companionDocId: fileData.companionDocId || null
      });
    });

    return resultList;
  } catch (err) {
    throw new Error('取得學生繳交名單失敗: ' + err.message);
  }
}

// ==========================================
// 4. 檔案自動相容與分流解析 (Word / Image / PDF)
// ==========================================

function resolveSubmissionFile(submission, studentName) {
  var emptyFile = { fileId: null, fileName: '未繳交檔案', fileType: 'NONE', viewUrl: '' };
  if (!submission.assignmentSubmission || !submission.assignmentSubmission.attachments) {
    return emptyFile;
  }
  
  var attachments = submission.assignmentSubmission.attachments;
  for (var i = 0; i < attachments.length; i++) {
    var att = attachments[i];
    if (att.driveFile) {
      var df = att.driveFile;
      var fileId = df.id;
      var title = df.title || '作業檔案';
      var lowerTitle = title.toLowerCase();
      var viewUrl = df.alternateLink || '';
      
      // 1. 原生 Google Doc
      if (lowerTitle.indexOf('.docx') === -1 && lowerTitle.indexOf('.doc') === -1 &&
          (att.driveFile.mimeType === 'application/vnd.google-apps.document' || !lowerTitle.match(/\.(jpg|jpeg|png|pdf)$/))) {
        return {
          fileId: fileId,
          fileName: title,
          fileType: 'DOC',
          viewUrl: viewUrl
        };
      }
      
      // 2. Word 檔 (.docx, .doc) -> 保持原檔並轉出 [AI批改] Google Doc 副本
      if (lowerTitle.indexOf('.docx') > -1 || lowerTitle.indexOf('.doc') > -1) {
        var docId = getOrCreateDocFromWord(fileId, title);
        return {
          fileId: docId,
          originalWordId: fileId,
          fileName: '[AI批改Doc] ' + title,
          fileType: 'WORD',
          viewUrl: 'https://docs.google.com/document/d/' + docId + '/edit'
        };
      }
      
      // 3. 圖片或 PDF (手寫作業)
      if (lowerTitle.match(/\.(jpg|jpeg|png)$/)) {
        var compDocId = getOrCreateCompanionDoc(fileId, title, studentName);
        return {
          fileId: fileId,
          fileName: title,
          fileType: 'IMAGE',
          viewUrl: viewUrl,
          companionDocId: compDocId
        };
      }
      
      if (lowerTitle.endsWith('.pdf')) {
        var compPdfDocId = getOrCreateCompanionDoc(fileId, title, studentName);
        return {
          fileId: fileId,
          fileName: title,
          fileType: 'PDF',
          viewUrl: viewUrl,
          companionDocId: compPdfDocId
        };
      }
    }
  }
  return emptyFile;
}

// Word 自動轉檔為 Google Doc (若已轉過則直接引用，保留 Word 原檔)
function getOrCreateDocFromWord(wordFileId, title) {
  try {
    var wordFile = DriveApp.getFileById(wordFileId);
    var parents = wordFile.getParents();
    var folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    var targetTitle = '[AI批改] ' + title.replace(/\.(docx|doc)$/i, '');
    
    // 檢查是否已存在轉檔複本
    var existingFiles = folder.getFilesByName(targetTitle);
    if (existingFiles.hasNext()) {
      return existingFiles.next().getId();
    }
    
    // 透過 Drive API (v2) 進行轉檔複製
    var copiedFile = Drive.Files.copy({
      title: targetTitle,
      parents: [{ id: folder.getId() }]
    }, wordFileId, { convert: true });
    
    return copiedFile.id;
  } catch (err) {
    Logger.log('Word 轉檔失敗，改用備用方式: ' + err.message);
    // 備用方案: 直接複製
    var copy = DriveApp.getFileById(wordFileId).makeCopy('[AI批改] ' + title);
    return copy.getId();
  }
}

// 為手寫照片 / PDF 建立專用 Companion Google Doc
function getOrCreateCompanionDoc(fileId, title, studentName) {
  try {
    var file = DriveApp.getFileById(fileId);
    var parents = file.getParents();
    var folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    var compTitle = '[AI批改-圖片] ' + studentName + '_' + title;
    
    var existingFiles = folder.getFilesByName(compTitle);
    if (existingFiles.hasNext()) {
      return existingFiles.next().getId();
    }
    
    var newDoc = DocumentApp.create(compTitle);
    var docFile = DriveApp.getFileById(newDoc.getId());
    folder.addFile(docFile);
    DriveApp.getRootFolder().removeFile(docFile);
    
    var body = newDoc.getBody();
    body.appendParagraph('【學生作業原始手寫檔案：' + title + '】').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph('檔案連結：' + file.getUrl());
    body.appendHorizontalRule();
    newDoc.saveAndClose();
    
    return newDoc.getId();
  } catch (err) {
    Logger.log('建立 Companion Doc 失敗: ' + err.message);
    var fallbackDoc = DocumentApp.create('[AI批改-圖片] ' + studentName + '_' + title);
    return fallbackDoc.getId();
  }
}

// ==========================================
// 5. 3-Gram + Jaccard 全班作業相似度演算法
// ==========================================

function extract3Grams(text) {
  if (!text) return new Set();
  // 濾除標點與多餘空白
  var cleaned = text.replace(/[\s\r\n\t\.,;:!?'"“”‘’()\[\]{}《》〈〉【】、。，！？；：]/g, '');
  var grams = new Set();
  var n = 3;
  if (cleaned.length < n) {
    if (cleaned.length > 0) grams.add(cleaned);
    return grams;
  }
  for (var i = 0; i <= cleaned.length - n; i++) {
    grams.add(cleaned.substring(i, i + n));
  }
  return grams;
}

function calculateJaccard(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
  var intersectionCount = 0;
  setA.forEach(function(item) {
    if (setB.has(item)) intersectionCount++;
  });
  var unionCount = setA.size + setB.size - intersectionCount;
  return unionCount === 0 ? 0 : (intersectionCount / unionCount);
}

function runClassSimilarityAnalysis(submissionsWithText) {
  // submissionsWithText: [{ studentId, studentName, text, fileId }]
  var n = submissionsWithText.length;
  var gramSets = [];
  
  for (var i = 0; i < n; i++) {
    gramSets.push(extract3Grams(submissionsWithText[i].text));
  }
  
  var results = [];
  for (var i = 0; i < n; i++) {
    var maxSim = 0;
    var matchTarget = '無顯著重疊';
    var matchTargetId = '';
    
    for (var j = 0; j < n; j++) {
      if (i === j) continue;
      var sim = calculateJaccard(gramSets[i], gramSets[j]);
      if (sim > maxSim) {
        maxSim = sim;
        matchTarget = submissionsWithText[j].studentName + ' (' + submissionsWithText[j].studentId + ')';
        matchTargetId = submissionsWithText[j].studentId;
      }
    }
    
    var simPercentage = Math.round(maxSim * 1000) / 10; // e.g. 86.5
    var isHighSimilarity = simPercentage >= 80.0;
    var statusLabel = isHighSimilarity 
      ? '⚠️【高度相似/同組】(與學號:' + matchTargetId + ' 重疊 ' + simPercentage + '%)'
      : '【獨立完成】';
      
    results.push({
      studentId: submissionsWithText[i].studentId,
      studentName: submissionsWithText[i].studentName,
      maxSimilarity: simPercentage,
      highestMatch: matchTarget,
      highestMatchId: matchTargetId,
      isHighSimilarity: isHighSimilarity,
      statusLabel: statusLabel
    });
  }
  
  return results;
}

// ==========================================
// 6. Gemini 2.5 Flash 多模態評分引擎
// ==========================================

function callGeminiApi(apiKey, payload) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  var statusCode = response.getResponseCode();
  var respText = response.getContentText();
  
  if (statusCode !== 200) {
    throw new Error('Gemini API 請求失敗 (狀態碼 ' + statusCode + '): ' + respText);
  }
  
  var data = JSON.parse(respText);
  if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content) {
    throw new Error('Gemini API 未回傳有效評分內容');
  }
  
  return data.candidates[0].content.parts[0].text;
}

function assessStudentSubmission(student, rubricConfig, apiKey) {
  var prompt = buildAssessmentPrompt(rubricConfig);
  var contentParts = [];
  var isVision = false;
  
  if (student.fileType === 'IMAGE') {
    // 手寫照片 -> Base64 多模態 Vision 呼叫
    isVision = true;
    var imageFile = DriveApp.getFileById(student.fileId);
    var blob = imageFile.getBlob();
    var mimeType = blob.getContentType();
    var base64Data = Utilities.base64Encode(blob.getBytes());
    
    contentParts.push({ text: prompt + '\n【注意】：此為學生手寫學習單照片，請透過視覺 OCR 辨識題號、算式、解題步驟與答案，檢查推導是否合理、觀念是否正確，並依據規準評分。' });
    contentParts.push({
      inlineData: {
        mimeType: mimeType,
        data: base64Data
      }
    });
  } else {
    // 文字 / Word (已轉 Doc) 讀取文本
    var docId = student.fileType === 'WORD' ? student.fileId : student.fileId;
    var docText = '';
    try {
      var doc = DocumentApp.openById(docId);
      docText = doc.getBody().getText();
    } catch (e) {
      docText = '（無法讀取文件內容或文件為空）';
    }
    
    contentParts.push({
      text: prompt + '\n\n【學生作業全文內容】：\n' + docText.substring(0, 8000) // 限制適當 token
    });
  }
  
  var payload = {
    contents: [{
      parts: contentParts
    }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };
  
  var rawJson = callGeminiApi(apiKey, payload);
  var assessment;
  try {
    assessment = JSON.parse(rawJson);
  } catch (e) {
    // 清理 markdown codeblock 標籤
    var cleaned = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
    assessment = JSON.parse(cleaned);
  }
  
  // 將評分表格與建議寫入學生 Google Doc 末端
  var targetDocId = (student.fileType === 'IMAGE' || student.fileType === 'PDF') ? student.companionDocId : student.fileId;
  if (targetDocId) {
    appendRubricToGoogleDoc(targetDocId, assessment, rubricConfig);
  }
  
  return assessment;
}

function buildAssessmentPrompt(rubricConfig) {
  var rubricDescription = JSON.stringify(rubricConfig, null, 2);
  return '你是一位專業的高中與大學資深教師，請根據以下提供的評分規準 (Rubrics)，客觀嚴謹地批改這份學生作業。\n' +
    '【評分規準清單 (Rubric)】:\n' + rubricDescription + '\n\n' +
    '請嚴格回傳符合以下 JSON 格式的結果，切勿輸出額外非 JSON 字串：\n' +
    '{\n' +
    '  "totalScore": 88,\n' +
    '  "rubricScores": [\n' +
    '    {\n' +
    '      "criterion": "規準名稱",\n' +
    '      "score": 26,\n' +
    '      "maxScore": 30,\n' +
    '      "comment": "針對該項目的具體講評細節"\n' +
    '    }\n' +
    '  ],\n' +
    '  "overallFeedback": "全篇作業的整體核心講評（150字內，包含亮點與值得肯定處）",\n' +
    '  "improvements": [\n' +
    '    "具體待改進項目1（例如：某觀念推導需補足定義）",\n' +
    '    "具體待改進項目2"\n' +
    '  ],\n' +
    '  "rewriteExample": "針對作業中最需改進的段落或解題步驟，提供示範性的專業重寫範例"\n' +
    '}';
}

// 格式化並附加 Rubric 表格至 Google Doc 最末端
function appendRubricToGoogleDoc(docId, assessment, rubricConfig) {
  try {
    var doc = DocumentApp.openById(docId);
    var body = doc.getBody();
    
    // 在最末端加入分隔線
    body.appendHorizontalRule();
    var heading = body.appendParagraph('🎓 AI 智慧批改與回饋報告 (Gemini 2.5 Flash)');
    heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    
    // 總分標籤
    var scorePara = body.appendParagraph('【評核總分】：' + assessment.totalScore + ' 分');
    scorePara.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    
    // 建立 Rubric 表格
    var tableData = [
      ['評分規準項目', '滿分', '實得分數', '分項講評與說明']
    ];
    
    if (assessment.rubricScores) {
      assessment.rubricScores.forEach(function(item) {
        tableData.push([
          item.criterion || '',
          String(item.maxScore || ''),
          String(item.score || ''),
          item.comment || ''
        ]);
      });
    }
    
    var table = body.appendTable(tableData);
    // 設定表格樣式
    table.setBorderWidth(1);
    table.setBorderColor('#CBD5E1');
    var headerRow = table.getRow(0);
    for (var c = 0; c < headerRow.getNumCells(); c++) {
      headerRow.getCell(c).setBackgroundColor('#1E3A8A');
      var p = headerRow.getCell(c).getChild(0).asParagraph();
      p.setForegroundColor('#FFFFFF');
      p.setBold(true);
    }
    
    // 附加核心講評
    body.appendParagraph('\n📝 【整體綜合回饋】：').setBold(true);
    body.appendParagraph(assessment.overallFeedback || '表現良好。');
    
    // 附加具體建議
    if (assessment.improvements && assessment.improvements.length > 0) {
      body.appendParagraph('\n💡 【建議改善重點】：').setBold(true);
      assessment.improvements.forEach(function(imp) {
        body.appendListItem(imp);
      });
    }
    
    // 附加重寫範例
    if (assessment.rewriteExample) {
      body.appendParagraph('\n✨ 【AI 示範專業重寫 / 優化範例】：').setBold(true);
      var quote = body.appendParagraph(assessment.rewriteExample);
      quote.setItalic(true);
      quote.setIndentStart(20);
    }
    
    doc.saveAndClose();
  } catch (err) {
    Logger.log('寫入 Google Doc 失敗: ' + err.message);
  }
}

// ==========================================
// 7. 雙裝置 (PC + 手機) 無線狀態同步與語音批註
// ==========================================

function setActiveStudent(studentData) {
  // studentData: { fileId, name, studentId, fileType, companionDocId }
  var cache = CacheService.getUserCache();
  // 保留 6 小時 (21600 秒)
  cache.put('ACTIVE_STUDENT', JSON.stringify(studentData), 21600);
  return { success: true };
}

function getActiveStudent() {
  var cache = CacheService.getUserCache();
  var raw = cache.get('ACTIVE_STUDENT');
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

// 接收手機 WebRTC 錄音檔並實時寫入學生 Doc
function processMobileVoiceComment(base64Audio, mimeType, selectedText) {
  var active = getActiveStudent();
  if (!active) {
    throw new Error('目前未選定批改學生，請於電腦端點選任一位學生');
  }
  
  var userProps = PropertiesService.getUserProperties();
  var apiKey = userProps.getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('未設定 Gemini API Key');
  }
  
  // 透過 Gemini 2.5 Flash 處理語音 (Audio Understanding & Rewrite)
  var prompt = '你是一位專業教師助手。以下是教師在手機上錄製的口述批註語音。\n' +
    '請執行以下任務：\n' +
    '1. 準確辨識口述語音內容。\n' +
    '2. 整理為 1~2 句重點摘要 (Bullet Points)。\n' +
    '3. 針對學生有問題的文字，提供一段專業、優雅、精準的重寫範例。\n' +
    (selectedText ? '【教師選定之學生原文段落】：\n' + selectedText + '\n' : '') +
    '請嚴格回傳 JSON 格式：\n' +
    '{\n' +
    '  "transcription": "教師原始語音逐字稿",\n' +
    '  "keyPoints": ["重點1", "重點2"],\n' +
    '  "rewriteExample": "專業示範重寫文字"\n' +
    '}';
    
  var payload = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: mimeType || 'audio/webm',
            data: base64Audio
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };
  
  var rawJson = callGeminiApi(apiKey, payload);
  var result = JSON.parse(rawJson);
  
  // 即時寫入當前學生的 Google Doc
  var targetDocId = (active.fileType === 'IMAGE' || active.fileType === 'PDF') ? active.companionDocId : active.fileId;
  if (targetDocId) {
    try {
      var doc = DocumentApp.openById(targetDocId);
      var body = doc.getBody();
      body.appendParagraph('\n🎙️ 【教師手機語音即時批註】 (' + Utilities.formatDate(new Date(), 'GMT+8', 'HH:mm:ss') + ')').setBold(true).setForegroundColor('#0F766E');
      body.appendParagraph('口述原音摘錄：' + result.transcription).setItalic(true);
      if (result.keyPoints) {
        result.keyPoints.forEach(function(pt) {
          body.appendListItem(pt);
        });
      }
      if (result.rewriteExample) {
        body.appendParagraph('示範修訂範例：' + result.rewriteExample).setForegroundColor('#2563EB');
      }
      doc.saveAndClose();
    } catch (e) {
      Logger.log('寫入語音批註至 Doc 失敗: ' + e.message);
    }
  }
  
  return {
    success: true,
    studentName: active.name,
    transcription: result.transcription,
    rewriteExample: result.rewriteExample
  };
}

// ==========================================
// 8. 成績總表 (Master Sheet) 精準學號匹配匯入
// ==========================================

function syncToMasterSheet(columnName, assessmentResults) {
  // assessmentResults: [{ studentId, score, comment, similarityStatus }]
  var userProps = PropertiesService.getUserProperties();
  var sheetId = userProps.getProperty('MASTER_SHEET_ID');
  if (!sheetId) {
    throw new Error('未設定 Master Sheet ID');
  }
  
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('成績總表') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  
  if (data.length < 4) {
    throw new Error('成績總表格式不符，至少需有標題與欄位列 (第4列為欄位名)');
  }
  
  // 搜尋第4列之表頭尋找「學號」欄與目標作業欄
  var headerRowIdx = -1;
  var studentIdColIdx = -1;
  var targetColIdx = -1;
  var commentColIdx = -1;
  var simColIdx = -1;
  var syncTimeColIdx = -1;
  
  for (var r = 0; r < Math.min(data.length, 6); r++) {
    for (var c = 0; c < data[r].length; c++) {
      var val = String(data[r][c]).trim();
      if (val === '學號') {
        headerRowIdx = r;
        studentIdColIdx = c;
        break;
      }
    }
    if (headerRowIdx !== -1) break;
  }
  
  if (studentIdColIdx === -1) {
    throw new Error('無法於試算表前 6 列找到包含「學號」的標題欄位！');
  }
  
  var headers = data[headerRowIdx];
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c]).trim();
    if (h.indexOf(columnName) > -1) targetColIdx = c;
    if (h.indexOf('評語') > -1 || h.indexOf('總評') > -1) commentColIdx = c;
    if (h.indexOf('相似度') > -1) simColIdx = c;
    if (h.indexOf('時間') > -1) syncTimeColIdx = c;
  }
  
  // 若目標作業欄位不存在，自動在右側新增欄位
  if (targetColIdx === -1) {
    targetColIdx = headers.length;
    sheet.getRange(headerRowIdx + 1, targetColIdx + 1).setValue(columnName + ' (100)');
  }
  
  // 建立學號與列號的映射 Map
  var studentRowMap = {};
  for (var r = headerRowIdx + 1; r < data.length; r++) {
    var sid = String(data[r][studentIdColIdx]).trim();
    if (sid) {
      studentRowMap[sid] = r + 1; // 試算表 1-based index
    }
  }
  
  var updatedCount = 0;
  var nowStr = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm');
  
  assessmentResults.forEach(function(item) {
    var sid = String(item.studentId).trim();
    var row = studentRowMap[sid];
    if (row) {
      if (item.score !== undefined && item.score !== null) {
        sheet.getRange(row, targetColIdx + 1).setValue(item.score);
      }
      if (commentColIdx !== -1 && item.comment) {
        sheet.getRange(row, commentColIdx + 1).setValue(item.comment);
      }
      if (simColIdx !== -1 && item.similarityStatus) {
        sheet.getRange(row, simColIdx + 1).setValue(item.similarityStatus);
      }
      if (syncTimeColIdx !== -1) {
        sheet.getRange(row, syncTimeColIdx + 1).setValue(nowStr);
      }
      updatedCount++;
    }
  });
  
  // 同步寫入《全班作業分析與重複辨識表》
  syncSimilaritySheet(ss, assessmentResults, columnName);
  
  return {
    success: true,
    updatedCount: updatedCount,
    message: '成功以學號精準匹配並同步 ' + updatedCount + ' 筆學生成績至總表！'
  };
}

// 同步寫入或建立《全班作業分析與重複辨識表》
function syncSimilaritySheet(spreadsheet, assessmentResults, assignmentName) {
  try {
    var sheetName = '全班作業分析與重複辨識表';
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
      sheet.appendRow(['🎓 全班作業文字相似度與分組辨識報告 (3-Gram + Jaccard 演算法)']);
      sheet.appendRow(['說明：相似度 >= 80% 標記為高度相似/疑似同組；< 80% 標記為獨立完成']);
      sheet.appendRow([]);
      sheet.appendRow(['學號', '姓名', '評估作業名稱', '文字相似度 (%)', '重複判定結果', '最高重疊學號/姓名', '組別/抄襲備註分析', '比對執行時間']);
      sheet.getRange('A4:H4').setBackground('#2563EB').setFontColor('#FFFFFF').setFontWeight('bold');
    }
    
    var nowStr = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm');
    assessmentResults.forEach(function(r) {
      if (r.similarityDetails) {
        var d = r.similarityDetails;
        sheet.appendRow([
          r.studentId,
          r.studentName,
          assignmentName,
          d.maxSimilarity + '%',
          d.statusLabel,
          d.highestMatch,
          d.isHighSimilarity ? '與該同學內容重疊達 ' + d.maxSimilarity + '%，請確認是否為同組專題' : '獨創性高，無異常重疊',
          nowStr
        ]);
      }
    });
  } catch (e) {
    Logger.log('寫入相似度分頁略過: ' + e.message);
  }
}

// ==========================================
// 9. 全班批次作業批改與排程執行 (Orchestrator)
// ==========================================

function runBatchAssessment(courseId, courseWorkId, rubricConfig) {
  var userProps = PropertiesService.getUserProperties();
  var apiKey = userProps.getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('未設定 Gemini API Key，請先於設定視窗中輸入');
  }
  
  var students = getStudentList(courseId, courseWorkId);
  var validStudents = students.filter(function(s) { return s.fileType !== 'NONE'; });
  
  if (validStudents.length === 0) {
    throw new Error('此作業尚無任何已繳交的檔案');
  }
  
  // 1. 蒐集文字報告內容進行 3-Gram 全班相似度比對
  var submissionsWithText = [];
  validStudents.forEach(function(s) {
    var text = '';
    if (s.fileType === 'DOC' || s.fileType === 'WORD') {
      try {
        text = DocumentApp.openById(s.fileId).getBody().getText();
      } catch (e) {
        text = '';
      }
    }
    submissionsWithText.push({
      studentId: s.studentId,
      studentName: s.studentName,
      text: text,
      fileId: s.fileId
    });
  });
  
  var similarityResults = runClassSimilarityAnalysis(submissionsWithText);
  var simMap = {};
  similarityResults.forEach(function(sim) {
    simMap[sim.studentId] = sim;
  });
  
  // 2. 逐一呼叫 Gemini 2.5 Flash 進行多模態評分
  var batchScores = [];
  validStudents.forEach(function(s) {
    try {
      var assessment = assessStudentSubmission(s, rubricConfig, apiKey);
      var simInfo = simMap[s.studentId];
      
      batchScores.push({
        studentId: s.studentId,
        studentName: s.studentName,
        score: assessment.totalScore,
        comment: assessment.overallFeedback,
        similarityStatus: simInfo ? simInfo.statusLabel : '【獨立完成】',
        similarityDetails: simInfo || null,
        assessment: assessment
      });
    } catch (err) {
      Logger.log('學生 ' + s.studentName + ' 批改失敗: ' + err.message);
      batchScores.push({
        studentId: s.studentId,
        studentName: s.studentName,
        score: null,
        comment: '批改失敗: ' + err.message,
        similarityStatus: '比對失敗'
      });
    }
  });
  
  return {
    success: true,
    totalCount: validStudents.length,
    results: batchScores
  };
}

