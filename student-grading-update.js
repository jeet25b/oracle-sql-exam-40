/* ==========================================================================
   STUDENT EXAM PORTAL (index.html) — REPLACEABLE GRADING & REVIEW MODULE
   1. Add the CSS block into your <style> tag so wrong answers highlight RED.
   2. Replace your grading/submission function with gradeAndSubmitExam().
   ========================================================================== */

/* --- 1. CSS STYLES (Add inside <style>) ---
.option-item.correct-answer {
  background: rgba(34, 197, 94, 0.16) !important;
  border: 1px solid #22c55e !important;
  color: #4ade80 !important;
}

.option-item.wrong-answer {
  background: rgba(239, 68, 68, 0.18) !important;
  border: 1px solid #ef4444 !important;
  color: #f87171 !important;
}
------------------------------------------- */

// --- 2. JAVASCRIPT GRADING & QUESTION-WISE SUBMISSION ---
function gradeAndSubmitExam(questions, userAnswers, studentInfo, SCRIPT_URL) {
  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unattemptedCount = 0;

  const questionMarks = []; // 1 for correct, 0 for wrong/unattempted (Q1_Marks..Q40_Marks)
  const details = [];       // Per-question audit trail

  questions.forEach((q, idx) => {
    const selected = userAnswers[idx]; // index 0..3 or null/undefined
    const correctIdx = q.answer;       // index of right option

    let mark = 0;
    let status = "unattempted";

    if (selected === null || selected === undefined || selected === "") {
      unattemptedCount++;
      status = "unattempted";
    } else if (Number(selected) === Number(correctIdx)) {
      score += 1;
      correctCount++;
      mark = 1;
      status = "correct";
    } else {
      wrongCount++;
      mark = 0;
      status = "wrong";
    }

    questionMarks.push(mark);
    details.push({
      qNo: idx + 1,
      selected: selected ?? "NA",
      correct: correctIdx,
      mark: mark,
      status: status
    });

    // Apply Review Highlighting in DOM:
    // Mark user's wrong choice in RED, and right choice in GREEN
    const optionElements = document.querySelectorAll(`[data-qindex="${idx}"] .option-item`);
    optionElements.forEach((el, optIdx) => {
      el.classList.remove("correct-answer", "wrong-answer", "selected");
      if (optIdx === Number(correctIdx)) {
        el.classList.add("correct-answer");
      }
      if (
        selected !== null &&
        selected !== undefined &&
        optIdx === Number(selected) &&
        Number(selected) !== Number(correctIdx)
      ) {
        el.classList.add("wrong-answer"); // Strictly RED for wrong choice
      }
    });
  });

  // Send payload with question-wise marks to Google Apps Script
  return fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({
      action: "submit",
      rollNo: studentInfo.rollNo,
      name: studentInfo.name,
      batch: studentInfo.batch || "B.Tech CSE III A-1",
      score: score,
      correctCount: correctCount,
      wrongCount: wrongCount,
      unattemptedCount: unattemptedCount,
      questionMarks: questionMarks,
      details: details
    })
  }).then(res => res.json());
}
