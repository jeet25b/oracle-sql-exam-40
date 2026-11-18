const ADMIN_PASSKEY = "Oracle@2026"; // Change this to your preferred teacher password
const SETTINGS_SHEET = "Settings";
const RESULTS_SHEET = "Results";

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "status";
  
  if (action === "status") {
    return jsonResponse(getExamWindowStatus());
  }
  
  if (action === "results") {
    const key = e.parameter.key || "";
    if (key !== ADMIN_PASSKEY) {
      return jsonResponse({ status: "error", message: "Invalid Teacher Passkey" });
    }
    return jsonResponse({
      status: "ok",
      window: getExamWindowStatus(),
      results: getAllResults()
    });
  }

  return jsonResponse({ status: "error", message: "Unknown action" });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || "submit";

    // 1. Update Exam Window Times from teacher.html
    if (action === "updateWindow") {
      if (data.key !== ADMIN_PASSKEY) {
        return jsonResponse({ status: "error", message: "Unauthorized Passkey" });
      }
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName(SETTINGS_SHEET);
      if (!sheet) {
        sheet = ss.insertSheet(SETTINGS_SHEET);
        sheet.appendRow(["Key", "Value"]);
      }
      sheet.clear();
      sheet.appendRow(["Key", "Value"]);
      sheet.appendRow(["OPEN_TIME", data.openTime]);   // ISO string with +05:30
      sheet.appendRow(["CLOSE_TIME", data.closeTime]); // ISO string with +05:30
      
      return jsonResponse({
        status: "ok",
        message: "Exam window updated successfully.",
        window: getExamWindowStatus()
      });
    }

    // 2. Record Student Submission + Question-Wise Marks
    if (action === "submit") {
      const win = getExamWindowStatus();
      if (!win.isOpen) {
        return jsonResponse({ status: "error", message: "Submission rejected: Exam window is closed." });
      }

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName(RESULTS_SHEET);
      const qCount = data.questionMarks ? data.questionMarks.length : 40;

      // Initialize headers if sheet doesn't exist
      if (!sheet) {
        sheet = ss.insertSheet(RESULTS_SHEET);
        const headers = [
          "Timestamp (IST)", "Roll Number", "Student Name", "Batch",
          "Total Score", "Max Marks", "Correct", "Wrong", "Unattempted",
          "Question Breakdown JSON"
        ];
        for (let i = 1; i <= qCount; i++) {
          headers.push("Q" + i + "_Marks");
        }
        sheet.appendRow(headers);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
      }

      const istTime = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd MMM yyyy, hh:mm:ss a");
      const row = [
        istTime,
        data.rollNo || "",
        data.name || "",
        data.batch || "B.Tech CSE III A-1",
        data.score || 0,
        qCount,
        data.correctCount || 0,
        data.wrongCount || 0,
        data.unattemptedCount || 0,
        JSON.stringify(data.details || [])
      ];

      // Append individual question marks (1 for correct, 0 for wrong/unattempted)
      if (data.questionMarks && Array.isArray(data.questionMarks)) {
        data.questionMarks.forEach(m => row.push(m));
      }

      sheet.appendRow(row);
      return jsonResponse({ status: "ok", message: "Result recorded successfully." });
    }

    return jsonResponse({ status: "error", message: "Invalid POST action" });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function getExamWindowStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SETTINGS_SHEET);
  
  // Default fallback window if Settings sheet hasn't been configured yet
  let openISO = "2026-11-18T17:00:00+05:30";
  let closeISO = "2026-11-18T18:30:00+05:30";

  if (sheet && sheet.getLastRow() >= 3) {
    const vals = sheet.getRange(2, 1, 2, 2).getValues();
    vals.forEach(r => {
      if (r[0] === "OPEN_TIME" && r[1]) openISO = String(r[1]);
      if (r[0] === "CLOSE_TIME" && r[1]) closeISO = String(r[1]);
    });
  }

  const now = new Date();
  const openDate = new Date(openISO);
  const closeDate = new Date(closeISO);

  const openFormatted = Utilities.formatDate(openDate, "Asia/Kolkata", "dd MMM yyyy, hh:mm a") + " IST";
  const closeFormatted = Utilities.formatDate(closeDate, "Asia/Kolkata", "dd MMM yyyy, hh:mm a") + " IST";

  let state = "OPEN";
  let isOpen = true;
  if (now < openDate) {
    state = "NOT_STARTED";
    isOpen = false;
  } else if (now > closeDate) {
    state = "CLOSED";
    isOpen = false;
  }

  return {
    isOpen: isOpen,
    state: state,
    openISO: openISO,
    closeISO: closeISO,
    openFormatted: openFormatted,
    closeFormatted: closeFormatted
  };
}

function getAllResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RESULTS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const qMarks = [];
    for (let c = 10; c < headers.length; c++) {
      qMarks.push({ q: headers[c].replace("_Marks", ""), mark: r[c] });
    }
    rows.push({
      timestamp: r[0],
      rollNo: r[1],
      name: r[2],
      batch: r[3],
      score: r[4],
      maxMarks: r[5],
      correct: r[6],
      wrong: r[7],
      unattempted: r[8],
      details: r[9] ? JSON.parse(r[9]) : [],
      qMarks: qMarks
    });
  }
  return rows;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
