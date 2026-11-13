/**
 * 🎓 AI 智慧批改與教學助手系統 (AI Teacher Assistant System)
 * Google Docs 側邊欄後端核心服務 gas/Code.gs
 * 
 * 架構：
 * 1. onOpen() 建立 Google Docs 工具選單，開啟 Sidebar
 * 2. 多教師環境與權限隔離 (UserProperties)
 * 3. Google Classroom 課程、作業與學生名單讀取
 * 4. 檔案格式分流處理 (Word 自動轉檔副本、圖片/PDF companion doc)
 * 5. 3-Gram + Jaccard 全班作業相似度比對引擎 (純本機計算，不呼叫外部 API)
 * 6. Google Doc 批改表格與手機語音回饋附加寫入
 * 7. 成績總表 (Master Sheet) 精準學號匹配匯入
 * 8. doGet() 相容傳統 Web App 模式
 */

// ==========================================
// 1. Google Docs 選單與 Sidebar 啟動 (方案 A)
// ==========================================

function onOpen(e) {
  try {
    DocumentApp.getUi()
      .createMenu('🎓 AI 智慧批改助手')
      .addItem('開啟批改側邊欄 (Sidebar)', 'showGradingSidebar')
      .addSeparator()
      .addItem('教師金鑰與總表設定', 'openSettingsPrompt')
      .addToUi();
  } catch (err) {
    Logger.log('onOpen error: ' + err.message);
  }
}

function showGradingSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('AI 智慧批改助手')
    .setWidth(360);
  DocumentApp.getUi().showSidebar(html);
}

// 相容獨立 Web App 瀏覽
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page.toLowerCase() : 'sidebar';
  if (page === 'mobile') {
    return HtmlService.createHtmlOutputFromFile('WebAppMobile')
      .setTitle('AI 智慧批改 - 手機語音端')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('AI 智慧批改主控台')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==========================================
// 2. 教師個人金鑰與試算表設定 (UserProperties)
// ==========================================

function getTeacherSettings() {
  var userProps = PropertiesService.getUserProperties();
  return {
    apiKey: userProps.getProperty('GEMINI_API_KEY') || '',
    sheetId: userProps.getProperty('MASTER_SHEET_ID') || '',
    vercelUrl: userProps.getProperty('VERCEL_URL') || 'https://gasgradingsystem.vercel.app',
    hasConfigured: !!(userProps.getProperty('GEMINI_API_KEY') && userProps.getProperty('MASTER_SHEET_ID'))
  };
}

function saveTeacherSettings(apiKey, sheetId, vercelUrl) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('請輸入有效的 Gemini API Key');
  }
  if (!sheetId || !sheetId.trim()) {
    throw new Error('請輸入有效的 Google Sheets 成績總表 ID');
  }

  // 驗證試算表存取權限
  try {
    var ss = SpreadsheetApp.openById(sheetId.trim());
    var name = ss.getName();
  } catch (err) {
    throw new Error('無法開啟成績總表，請確認 ID 正確且具備存取權限: ' + err.message);
  }

  var userProps = PropertiesService.getUserProperties();
  userProps.setProperty('GEMINI_API_KEY', apiKey.trim());
  userProps.setProperty('MASTER_SHEET_ID', sheetId.trim());
  if (vercelUrl && vercelUrl.trim()) {
    userProps.setProperty('VERCEL_URL', vercelUrl.trim().replace(/\/$/, ''));
  }

  return { success: true, message: '設定已儲存！已成功連線至試算表: ' + name };
}

// ==========================================
// 3. Google Classroom 課程與學生作業讀取
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
      var studentId = info.email ? info.email.split('@')[0] : userId;
      var fileData = resolveSubmissionFile(sub, info.name);

      resultList.push({
        submissionId: sub.id,
        userId: userId,
        studentId: studentId,
        studentName: info.name,
        email: info.email,
        state: sub.state,
        assignedGrade: sub.assignedGrade || null,
        draftGrade: sub.draftGrade || null,
        fileId: fileData.fileId,
        fileName: fileData.fileName,
        fileType: fileData.fileType,
        viewUrl: fileData.viewUrl,
        companionDocId: fileData.companionDocId || null
      });
    });

    return resultList;
  } catch (err) {
    throw new Error('取得學生繳交名單失敗: ' + err.message);
  }
}

// 讀取學生作業內容（文字或圖片 Base64）
function getStudentContentForAssessment(student) {
  try {
    if (student.fileType === 'IMAGE') {
      var imageFile = DriveApp.getFileById(student.fileId);
      var blob = imageFile.getBlob();
      return {
        isImage: true,
        imageBase64: Utilities.base64Encode(blob.getBytes()),
        imageMimeType: blob.getContentType(),
        docText: ''
      };
    } else {
      var docId = student.fileId;
      var docText = '';
      try {
        var doc = DocumentApp.openById(docId);
        docText = doc.getBody().getText();
      } catch (e) {
        docText = '（無法讀取文件內容或文件為空）';
      }
      return {
        isImage: false,
        imageBase64: '',
        imageMimeType: '',
        docText: docText
      };
    }
  } catch (err) {
    throw new Error('讀取學生作業內容失敗: ' + err.message);
  }
}

// ==========================================
// 4. 檔案自動相容與分流轉檔
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

      // 1. Google Doc
      if (lowerTitle.indexOf('.docx') === -1 && lowerTitle.indexOf('.doc') === -1 &&
          (att.driveFile.mimeType === 'application/vnd.google-apps.document' || !lowerTitle.match(/\.(jpg|jpeg|png|pdf)$/))) {
        return {
          fileId: fileId,
          fileName: title,
          fileType: 'DOC',
          viewUrl: viewUrl
        };
      }

      // 2. Word 檔
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

      // 3. 圖片或 PDF
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

function getOrCreateDocFromWord(wordFileId, title) {
  try {
    var wordFile = DriveApp.getFileById(wordFileId);
    var parents = wordFile.getParents();
    var folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    var targetTitle = '[AI批改] ' + title.replace(/\.(docx|doc)$/i, '');

    var existingFiles = folder.getFilesByName(targetTitle);
    if (existingFiles.hasNext()) {
      return existingFiles.next().getId();
    }

    var copiedFile = Drive.Files.copy({
      title: targetTitle,
      parents: [{ id: folder.getId() }]
    }, wordFileId, { convert: true });

    return copiedFile.id;
  } catch (err) {
    Logger.log('Word 轉檔備用方案: ' + err.message);
    var copy = DriveApp.getFileById(wordFileId).makeCopy('[AI批改] ' + title);
    return copy.getId();
  }
}

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
    Logger.log('Companion Doc 建立失敗: ' + err.message);
    var fallbackDoc = DocumentApp.create('[AI批改-圖片] ' + studentName + '_' + title);
    return fallbackDoc.getId();
  }
}

// ==========================================
// 5. 3-Gram + Jaccard 全班作業相似度演算法
// ==========================================

function extract3Grams(text) {
  if (!text) return new Set();
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

    var simPercentage = Math.round(maxSim * 1000) / 10;
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
// 6. 寫入評分結果與語音批註至 Google Doc
// ==========================================

function writeAssessmentToDoc(fileId, fileType, companionDocId, assessment) {
  var targetDocId = (fileType === 'IMAGE' || fileType === 'PDF') ? companionDocId : fileId;
  if (!targetDocId) return { success: false, message: '無可寫入之 Doc ID' };

  try {
    var doc = DocumentApp.openById(targetDocId);
    var body = doc.getBody();

    body.appendHorizontalRule();
    var heading = body.appendParagraph('🎓 AI 智慧批改與回饋報告 (Gemini 3.8 Flash)');
    heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);

    var scorePara = body.appendParagraph('【評核總分】：' + assessment.totalScore + ' 分');
    scorePara.setHeading(DocumentApp.ParagraphHeading.HEADING2);

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
    table.setBorderWidth(1);
    table.setBorderColor('#CBD5E1');
    var headerRow = table.getRow(0);
    for (var c = 0; c < headerRow.getNumCells(); c++) {
      headerRow.getCell(c).setBackgroundColor('#1E3A8A');
      var p = headerRow.getCell(c).getChild(0).asParagraph();
      p.setForegroundColor('#FFFFFF');
      p.setBold(true);
    }

    body.appendParagraph('\n📝 【整體綜合回饋】：').setBold(true);
    body.appendParagraph(assessment.overallFeedback || '表現良好。');

    if (assessment.improvements && assessment.improvements.length > 0) {
      body.appendParagraph('\n💡 【建議改善重點】：').setBold(true);
      assessment.improvements.forEach(function(imp) {
        body.appendListItem(imp);
      });
    }

    if (assessment.rewriteExample) {
      body.appendParagraph('\n✨ 【AI 示範專業重寫 / 優化範例】：').setBold(true);
      var quote = body.appendParagraph(assessment.rewriteExample);
      quote.setItalic(true);
      quote.setIndentStart(20);
    }

    doc.saveAndClose();
    return { success: true };
  } catch (err) {
    Logger.log('寫入 Google Doc 失敗: ' + err.message);
    throw new Error('寫入 Google Doc 失敗: ' + err.message);
  }
}

function writeVoiceFeedbackToDoc(fileId, fileType, companionDocId, feedback) {
  var targetDocId = (fileType === 'IMAGE' || fileType === 'PDF') ? companionDocId : fileId;
  if (!targetDocId) return { success: false };

  try {
    var doc = DocumentApp.openById(targetDocId);
    var body = doc.getBody();

    body.appendParagraph('\n🎙️ 【教師手機語音即時批註】 (' + Utilities.formatDate(new Date(), 'GMT+8', 'HH:mm:ss') + ')')
      .setBold(true).setForegroundColor('#0F766E');
    body.appendParagraph('口述原音摘錄：' + feedback.transcription).setItalic(true);

    if (feedback.keyPoints && feedback.keyPoints.length > 0) {
      feedback.keyPoints.forEach(function(pt) {
        body.appendListItem(pt);
      });
    }
    if (feedback.rewriteExample) {
      body.appendParagraph('示範修訂範例：' + feedback.rewriteExample).setForegroundColor('#2563EB');
    }

    doc.saveAndClose();
    return { success: true };
  } catch (err) {
    Logger.log('寫入語音批註至 Doc 失敗: ' + err.message);
    throw new Error('寫入語音批註至 Doc 失敗: ' + err.message);
  }
}

// ==========================================
// 7. 同步成績至 Google Sheets 成績總表
// ==========================================

function syncToMasterSheet(columnName, assessmentResults) {
  var userProps = PropertiesService.getUserProperties();
  var sheetId = userProps.getProperty('MASTER_SHEET_ID');
  if (!sheetId) {
    throw new Error('未設定 Master Sheet ID，請先在設定中輸入試算表 ID');
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('成績總表') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  if (data.length < 4) {
    throw new Error('成績總表格式不符，至少需有標題與欄位列 (第4列為欄位名)');
  }

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

  if (targetColIdx === -1) {
    targetColIdx = headers.length;
    sheet.getRange(headerRowIdx + 1, targetColIdx + 1).setValue(columnName + ' (100)');
  }

  var studentRowMap = {};
  for (var r = headerRowIdx + 1; r < data.length; r++) {
    var sid = String(data[r][studentIdColIdx]).trim();
    if (sid) {
      studentRowMap[sid] = r + 1;
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

  syncSimilaritySheet(ss, assessmentResults, columnName);

  return {
    success: true,
    updatedCount: updatedCount,
    message: '成功以學號精準匹配並同步 ' + updatedCount + ' 筆學生成績至總表！'
  };
}

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
