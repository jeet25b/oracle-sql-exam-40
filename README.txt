ORACLE SQL ASSESSMENT — DEPLOYMENT AND OPERATIONS

This version changes both the student page and the Apps Script API. Deploy both together.
Local changes do not update the live GitHub Pages site or the existing Apps Script deployment.

1. PRIVATE APPS SCRIPT PROJECT
   Add Code.gs AND QuestionBank.gs to the same Google Apps Script project bound to your faculty spreadsheet.
   QuestionBank.gs contains the canonical question bank and answer keys. Do not publish it with the website.
   In Project Settings > Script properties, add ADMIN_PASSKEY with a new private faculty password.
   The previous hardcoded faculty password has been removed from Code.gs.
   Update teacher.html access using that new password at login; no password is embedded in the page.

2. GOOGLE SHEETS
   Settings tab, columns A:B, with header Key | Value:
     OPEN_TIME       | an ISO time including timezone, e.g. YYYY-MM-DDTHH:mm:ss+05:30
     CLOSE_TIME      | a later ISO time including timezone
     DurationMinutes | 60
     ExamTitle       | Oracle SQL Assessment
   The teacher page can set opening and closing times. All visible schedule times are IST (UTC+05:30).
   Missing/invalid schedules keep the exam locked; no expired default schedule is used.

   Students tab, columns A:C, with header Roll Number | Student Name | Access Code:
     Add each enrolled student's roll number, registered name and a unique private random access code.
     Format roll numbers and access codes as plain text before entering them. Preserve leading zeros.
     Use a long random code per student, distribute privately, and do not reuse the faculty password.
     The roster is required. Without it, new attempts are blocked with an explanatory message.
     Registration codes verify possession of the teacher-issued credential; this is not institutional SSO.

   Results is created automatically. Its first ten columns are:
     Timestamp (IST), Roll Number, Student Name, Batch, Total Score, Max Marks,
     Correct, Wrong, Unattempted, Question Breakdown JSON; followed by Q1_Marks ... Q40_Marks.
   Existing results with this schema are preserved and block new attempts for the same roll number.
   The older Timestamp/RollNumber/StudentName layout is supported directly. Keep the Results tab
   and its existing rows. New detailed columns are appended automatically; no manual header edit is needed.

   Attempts is created automatically. It stores each student's fixed shuffled question set,
   session token, deadline, saved answers and result. Keep this spreadsheet private to faculty.
   Do not delete Attempts or Results during the exam. One attempt is reserved when a student starts.
   A new login resumes that same attempt; it does not reset the question set or timer.
   For a fresh exam cohort/window, use a separate spreadsheet/deployment or archive BOTH tables deliberately.
   Changing only the exam window does not grant another attempt.

3. DEPLOY THE API
   Deploy > Manage deployments > Edit > New version > Deploy.
   Run as the spreadsheet owner; allow students to access the web app.
   Keep the existing /exec URL when editing the existing deployment. If it changes, update SCRIPT_URL
   in exam.js and teacher.html together. Never place credentials in public JavaScript.

4. PUBLISH THE WEBSITE
   Publish ONLY index.html, exam.css, exam.js and teacher.html.
   The supplied .github/workflows/deploy.yml builds a Pages artifact containing only these assets.
   In GitHub Settings > Pages choose GitHub Actions, then run/push the workflow after deploying the API.
   Do not publish Code.gs, QuestionBank.gs, tests, Students data or saved attempts as website assets.
   QuestionBank.gs is ignored by Git and must be copied privately into Apps Script.
   If the repository or prior question bank is public, old answer keys may exist in Git history.
   Use a fresh private question bank for a high-stakes exam. Server grading does not erase public history.

5. STUDENT EXPERIENCE
   Green means answered before final submission. Red appears for incorrect questions only after server grading.
   Submit Question saves the current answer; students can edit unlocked questions until final Submit Exam.
   Switching tabs or moving focus away permanently locks the current question. Its current answer
   (or unanswered state) is retained. Locks persist on the device and backend through refresh/resume;
   later save/submit requests cannot change a lock already recorded by the backend.
   Browser focus events detect focus loss, including other apps; they are not a substitute for proctoring.
   Navigator flags, accessible radio controls, keyboard focus and a final review dialog are included.
   A local device copy saves immediately and online progress syncs after edits and every 20 seconds.
   Re-enter the student code after refresh to resume. The access code itself is never saved on the device.
   Offline work is retained locally. A server deadline cannot be reset by refreshing or reconnecting.
   At timeout the page submits automatically. Final requests have a 15-second network arrival tolerance.
   If reconnecting later, the backend grades the last answers saved online before the deadline;
   unsynced answers after that cutoff cannot be accepted. Explain this to students in advance.
   If the browser is closed at timeout, reconnecting finalizes the saved attempt; no background job is installed.
   Retry submission returns the same result if the server saved it but the response was lost.
   Browser storage is best-effort and may be unavailable in private/restricted modes; keep the page open.
   Receipts export as CSV (Excel compatible) only after confirmed submission.
   Pending attempts stay saved internally; students cannot download a pending JSON file.
   Only correctness is released after submission; detailed answer keys/solutions are not sent to the browser.
   Clear site storage on shared devices after downloading the receipt; do not share session tokens.

6. VALIDATION
   Run: node tests/exam.test.cjs
   Tests use an in-memory spreadsheet/API simulation; they never access real student records.
   Perform one staging deployment test with a test roster before opening the real exam.

SESSION VERIFICATION RECOVERY
   If a pending submission reports an invalid session, use Verify session and submit and enter
   the student access code again. This reconnects only to the same original attempt; it cannot
   create another attempt, reset the timer, or transfer answers to a different question set.
   Missing/replaced Attempts records need faculty restoration. Do not delete saved browser data
   or Attempts rows to resolve submission errors. Deploy Code.gs and the website together.

RESULTS AND QUESTION-WISE RECOVERY
   New Results rows include totals plus Q1..Q40 fields: Marks, QuestionID, Question,
   Selected (A/B/C/D or Unanswered), Correct (A/B/C/D), Status, and the breakdown JSON.
   Q1 means the first question in that student's shuffled order; QuestionID maps to the bank.
   Existing total-only rows remain unchanged; absent historical answers are not invented.
   To recover completed attempts missing from Results, paste the latest Code.gs into Apps Script,
   save, select repairMissingResults from the function dropdown and click Run. Authorize if asked.
   The log reports the number restored. Only Attempts records with an existing result are restored.
   If the last submission never reached the server, use Verify session and submit on the original
   student's browser. Missing Attempts data requires restoring the spreadsheet's original record.
   Deploy > Manage deployments > Edit > New version > Deploy to activate fixes for students.
   Keep the existing Results and Attempts tabs; do not rename or delete them for this update.

FOCUS MONITORING IN RESULTS
   TabSwitches counts transitions to a hidden exam tab/page. FocusLosses counts window blur
   events (e.g. another app or browser window). One action may trigger both and appear in
   both separate columns. Repeated events while still away are deduplicated; subsequent
   departures are counted even if the current question is already locked.
   LockedQuestions records how many question answers were locked. Counts autosave and resume.
   Deploy updated exam.js AND Code.gs together. Historical missing focus counts stay blank;
   they cannot be reconstructed from a total score or a historical combined event count.

BALANCED ANSWER POSITIONS
   New 40-question attempts contain exactly 10 correct options A, 10 B, 10 C and 10 D.
   The position schedule and distractors are shuffled; the server stores the remapped key.
   Existing attempts keep their original option order and answer keys on resume.
   Redeploy Code.gs to enable this rule for newly started attempts.

VIEWED-QUESTION LOCKING AND REVIEW FEEDBACK
   Tab changes or focus loss lock ALL questions viewed in that attempt, including submitted
   questions. Unseen questions remain editable. Seen IDs and submitted feedback persist on
   the backend and device. Existing attempts start tracking new viewed questions after update;
   historical unsaved view history cannot be reconstructed. Publish index.html, exam.js and
   exam.css together, and redeploy Code.gs for server persistence/enforcement.
