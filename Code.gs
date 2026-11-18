/**
 * Oracle SQL & PL/SQL 40-Question Exam Portal Backend (Google Apps Script)
 * 
 * Setup:
 * 1. Create a Google Sheet with two tabs: 'Settings' and 'Results'
 *    - Settings tab:
 *        A1: Key              | B1: Value
 *        A2: ExamTitle        | B2: Oracle SQL & PL/SQL Assessment (40 MCQs)
 *        A3: StartTimeIST     | B3: 2026-11-25T10:00:00+05:30
 *        A4: EndTimeIST       | B4: 2026-11-25T11:30:00+05:30
 *        A5: DurationMinutes  | B5: 60
 *        A6: AllowMultiple    | B6: FALSE
 *    - Results tab (Row 1 Headers):
 *        A1: Timestamp | B1: RollNumber | C1: StudentName | D1: Batch | E1: Score | F1: TotalQuestions | G1: Percentage | H1: TimeTakenSec | I1: TabSwitches
 * 2. Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone
 */

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const action = (e && e.parameter && e.parameter.action) || "status";

  if (action === "results") {
    const resSheet = ss.getSheetByName("Results");
    if (!resSheet) return jsonResponse({ status: "ERROR", message: "Results sheet missing." });
    const rows = resSheet.getDataRange().getValues();
    if (rows.length <= 1) return jsonResponse({ status: "OK", results: [] });
    const headers = rows[0];
    const data = rows.slice(1).map(r => {
      let obj = {};
      headers.forEach((h, i) => obj[h] = r[i]);
      return obj;
    });
    return jsonResponse({ status: "OK", results: data });
  }

  // Default: Check exam accessibility window
  const settings = getSettingsMap(ss);
  const now = new Date();
  const start = new Date(settings.StartTimeIST || "2026-11-25T10:00:00+05:30");
  const end = new Date(settings.EndTimeIST || "2026-11-25T11:30:00+05:30");
  const duration = Number(settings.DurationMinutes || 60);
  const title = settings.ExamTitle || "Oracle SQL & PL/SQL Exam";

  if (now < start) {
    return jsonResponse({
      status: "LOCKED",
      examTitle: title,
      serverTime: now.toISOString(),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      message: "Exam is not open yet. Starts at " + Utilities.formatDate(start, "Asia/Kolkata", "dd MMM yyyy, hh:mm a 'IST'")
    });
  }

  if (now > end) {
    return jsonResponse({
      status: "CLOSED",
      examTitle: title,
      serverTime: now.toISOString(),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      message: "The exam window closed on " + Utilities.formatDate(end, "Asia/Kolkata", "dd MMM yyyy, hh:mm a 'IST'")
    });
  }

  return jsonResponse({
    status: "OPEN",
    examTitle: title,
    durationMinutes: duration,
    serverTime: now.toISOString(),
    endTime: end.toISOString()
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settings = getSettingsMap(ss);
    const now = new Date();
    const start = new Date(settings.StartTimeIST || "2026-11-25T10:00:00+05:30");
    const end = new Date(settings.EndTimeIST || "2026-11-25T11:30:00+05:30");
    // 2-minute grace period for network latency on auto-submit
    const graceEnd = new Date(end.getTime() + 2 * 60 * 1000);

    if (now < start || now > graceEnd) {
      return jsonResponse({ status: "REJECTED", message: "Submission rejected: outside active exam time window." });
    }

    const payload = JSON.parse(e.postData.contents);
    const roll = String(payload.rollNumber || "").trim().toUpperCase();
    const name = String(payload.studentName || "").trim();
    const batch = String(payload.batch || "B.Tech CSE III A-1").trim();
    const score = Number(payload.score || 0);
    const total = Number(payload.totalQuestions || 40);
    const timeTaken = Number(payload.timeTakenSec || 0);
    const tabSwitches = Number(payload.tabSwitches || 0);

    let resSheet = ss.getSheetByName("Results");
    if (!resSheet) {
      resSheet = ss.insertSheet("Results");
      resSheet.appendRow(["Timestamp", "RollNumber", "StudentName", "Batch", "Score", "TotalQuestions", "Percentage", "TimeTakenSec", "TabSwitches"]);
    }

    const allowMultiple = String(settings.AllowMultiple || "FALSE").toUpperCase() === "TRUE";
    if (!allowMultiple && roll) {
      const existing = resSheet.getDataRange().getValues();
      for (let i = 1; i < existing.length; i++) {
        if (String(existing[i][1]).trim().toUpperCase() === roll) {
          return jsonResponse({ status: "DUPLICATE", message: "Roll number " + roll + " has already submitted this exam." });
        }
      }
    }

    const istTimestamp = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
    const pct = total > 0 ? ((score / total) * 100).toFixed(2) + "%" : "0%";
    resSheet.appendRow([istTimestamp, roll, name, batch, score, total, pct, timeTaken, tabSwitches]);

    return jsonResponse({ status: "SAVED", message: "Result recorded successfully.", score: score, total: total });
  } catch (err) {
    return jsonResponse({ status: "ERROR", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function getSettingsMap(ss) {
  const sheet = ss.getSheetByName("Settings");
  const map = {};
  if (!sheet) return map;
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) map[String(rows[i][0]).trim()] = rows[i][1];
  }
  return map;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
