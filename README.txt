ORACLE SQL & PL/SQL 40-MCQ SCHEDULED EXAM PORTAL — SETUP GUIDE

1. GOOGLE SHEETS & APPS SCRIPT SETUP
   a. Create a new Google Sheet and rename two tabs:
      - Tab 1: Settings
      - Tab 2: Results
   b. In the 'Settings' tab, populate rows 1 to 6:
      Row 1: Key             | Value
      Row 2: ExamTitle       | Oracle SQL & PL/SQL Assessment (40 MCQs)
      Row 3: StartTimeIST    | 2026-11-25T10:00:00+05:30
      Row 4: EndTimeIST      | 2026-11-25T11:30:00+05:30
      Row 5: DurationMinutes | 60
      Row 6: AllowMultiple   | FALSE
   c. In the 'Results' tab, set Row 1 headers:
      Timestamp | RollNumber | StudentName | Batch | Score | TotalQuestions | Percentage | TimeTakenSec | TabSwitches
   d. Open Extensions > Apps Script, paste the contents of Code.gs, save, and click:
      Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
   e. Copy the generated Web App URL (/exec).

2. FRONTEND & QUESTION BANK SETUP
   a. Open index.html and replace YOUR_DEPLOYMENT_ID in SCRIPT_URL with your Web App URL.
   b. Default faculty passcode in index.html is set to: oracle2026 (change TEACHER_PASSCODE before publishing).
   c. Open important_questions.js (currently preloaded with 45 important Oracle SQL & PL/SQL MCQs) and paste any additional questions from your previous quiz with `important: true`.

3. DEPLOY ON GITHUB PAGES
   a. Upload index.html and important_questions.js to a new GitHub repository (e.g., jeet25b/oracle-sql-exam-40).
   b. Go to Settings > Pages > Branch: main / (root) > Save.
   c. Download results anytime in .xlsx format either from the Teacher Results button on the portal or via File > Download > Microsoft Excel (.xlsx) in Google Sheets.
