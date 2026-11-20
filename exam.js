"use strict";
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyJvfaFqcPD85SF4XJ_M7AcGe7KLkCc62-fL5Fk-G3dOqXjWGeXo4LtsseAY2PidzWGFA/exec";
const REQUIRED_API_VERSION = 3;
const BACKEND_UPDATE_MESSAGE = "The exam server needs an update. Please contact your teacher to deploy the latest Apps Script version before starting or resuming the exam.";
const STORAGE_KEY = "oracle-sql-attempt-v2";
const $ = id => document.getElementById(id);
let attempt = null, deadline = 0, clockOffset = 0, timer = null, saveTimer = null;
let sending = false, finalized = false, syncing = false, resave = false, revision = 0;
let tabAway = false, focusAway = false, focusMonitoringArmed = false;
let needsSessionVerification = false;
let result = null, submitPending = false, lastSync = 0, warningLevel = 0, recovery = null;
function setVisible(id, visible) { $(id).classList.toggle("hidden", !visible); }
function message(text, type = "") { $("accessBanner").textContent = text; $("accessBanner").className = "notice " + type; }
let requestQueue = Promise.resolve();
function api(payload) {
  // Preserve write order so an older autosave cannot overwrite a submitted answer.
  const request = requestQueue.then(() => requestApi(payload));
  requestQueue = request.catch(() => {});
  return request;
}
async function requestApi(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(SCRIPT_URL, {method: "POST", body: JSON.stringify(payload), signal: controller.signal});
    if (!response.ok) throw new Error("The server is unavailable. Please try again.");
    const data = await response.json();
    if (data.status !== "ok") throw new Error(/invalid post action|unknown action/i.test(data.message || "") ? BACKEND_UPDATE_MESSAGE : (data.message || "The request could not be completed."));
    return data;
  } finally { clearTimeout(timeout); }
}
function localSave() {
  if (!attempt) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({attempt, deadline, clockOffset, finalized, result, submitPending, savedAt: Date.now()}));
    return true;
  } catch (_) {
    $("saveStatus").textContent = "Device storage unavailable. Keep this page open; online saving continues.";
    return false;
  }
}
function snapshot() {
  return {answers: {...attempt.answers}, flags: [...attempt.flags], currentIdx: attempt.currentIdx, tabSwitches: attempt.tabSwitches || 0, focusLosses: attempt.focusLosses || 0, lockedQuestions: [...(attempt.lockedQuestions || [])], seenQuestions: [...(attempt.seenQuestions || [])]};
}
function changed() {
  revision++;
  const saved = localSave();
  if (saved) $("saveStatus").textContent = navigator.onLine ? "Saved on this device · syncing…" : "Offline · saved on this device";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(syncProgress, 650);
}
async function syncProgress() {
  if (!attempt || finalized || submitPending || questionFeedbackBusy) return;
  if (syncing) { resave = true; return; }
  syncing = true;
  const sentRevision = revision;
  try {
    const data = await api({action: "saveAttempt", rollNo: attempt.roll, token: attempt.token, ...snapshot()});
    lastSync = Date.now();
    if (data.result) { acceptResult(data.result); return; }
    if (Number.isFinite(data.deadline)) {
      deadline = Math.min(deadline, data.deadline); attempt.deadline = deadline;
    }
    if (data.lockedQuestions) {
      const lockChanged = data.lockedQuestions.some(id => !(attempt.lockedQuestions || []).includes(id) || attempt.answers[id] !== data.answers[id]);
      attempt.lockedQuestions = [...new Set([...(attempt.lockedQuestions || []), ...data.lockedQuestions])];
      for (const id of data.lockedQuestions) {
        if (data.answers[id] === undefined) delete attempt.answers[id];
        else attempt.answers[id] = data.answers[id];
      }
      localSave(); if (lockChanged) renderQuestion();
    }
    if (sentRevision === revision) $("saveStatus").textContent = "All changes saved online";
  } catch (err) {
    $("saveStatus").textContent = "Not synced · your device copy is retained. Reconnecting…";
  } finally {
    syncing = false;
    if (resave && !finalized && !submitPending && !questionFeedbackBusy) { resave = false; syncProgress(); }
  }
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("themeBtn").textContent = theme === "dark" ? "Light mode" : "Dark mode";
  $("themeBtn").setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
}
async function enterFullscreen() {
  if (document.fullscreenElement) return true;
  if (!document.documentElement.requestFullscreen) {
    $("fullscreenBtn").textContent = "Use browser full screen";
    $("fullscreenBtn").title = "Use your browser's full-screen control (F11 on Windows).";
    return false;
  }
  try {
    await document.documentElement.requestFullscreen({navigationUI:"hide"});
    return true;
  } catch (_) {
    $("fullscreenBtn").textContent = "Enter full screen";
    $("fullscreenBtn").title = "Allow full screen in your browser, then select this button. On Windows you can also use F11.";
    return false;
  }
}
function updateFullscreenButton() {
  const active = !!document.fullscreenElement;
  $("fullscreenBtn").textContent = active ? "Full screen active" : "Full screen";
  $("fullscreenBtn").disabled = active;
}
async function initialize() {
  try { applyTheme(localStorage.getItem("oracle-theme") || "light"); recovery = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (_) {}
  $("themeBtn").onclick = () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(theme); try { localStorage.setItem("oracle-theme", theme); } catch (_) {}
  };
  $("fullscreenBtn").onclick = enterFullscreen;
  document.addEventListener("fullscreenchange", updateFullscreenButton);
  updateFullscreenButton();
  $("studentForm").onsubmit = startExam;
  // Fullscreen requires a real gesture: request it on the first login interaction.
  $("studentForm").addEventListener("pointerdown", event => {
    if (event.isTrusted && !attempt && !document.fullscreenElement) enterFullscreen();
  });
  $("prevBtn").onclick = () => navigate(-1);
  $("nextBtn").onclick = () => navigate(1);
  $("submitQuestionBtn").onclick = submitCurrentQuestion;
  $("clearBtn").onclick = () => {
    if (questionBlocked()) return;
    if(attempt.feedback)delete attempt.feedback[attempt.questions[attempt.currentIdx].id];
    delete attempt.answers[attempt.questions[attempt.currentIdx].id]; changed(); renderQuestion();
  };
  $("flagBtn").onclick = () => {
    if (blocked()) return;
    const id = attempt.questions[attempt.currentIdx].id;
    attempt.flags = attempt.flags.includes(id) ? attempt.flags.filter(x => x !== id) : [...attempt.flags, id];
    changed(); updatePalette(); updateFlag();
  };
  $("submitExamBtn").onclick = confirmSubmit;
  $("submitDialog").addEventListener("close", () => { if ($("submitDialog").returnValue === "submit") submitExam(); });
  $("nextStudentBtn").onclick = nextStudent;
  $("retryBtn").onclick = () => submitExam();
  $("verifySessionBtn").onclick = openSessionVerification;
  $("sessionForm").onsubmit = recoverSession;
  $("cancelSessionBtn").onclick = () => $("sessionDialog").close();
  $("sessionDialog").addEventListener("close", () => { $("sessionCode").value = ""; });
  window.addEventListener("online", () => { if (submitPending) submitExam(); else syncProgress(); });
  window.addEventListener("offline", () => { if (attempt && !finalized) $("saveStatus").textContent = "Offline · progress retained on this device"; });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && focusMonitoringArmed) recordFocusEvent("tab");
    else { tabAway = false; if (attempt && !finalized && !submitPending) { tick(); renderQuestion(); syncProgress(); } }
  });
  // Browser password bubbles can blur the page immediately after sign-in.
  // Arm only on real student input inside the active exam, never programmatic focus.
  const armFocusMonitoring = event => {
    if (event.isTrusted && attempt && !finalized && !submitPending) focusMonitoringArmed = true;
  };
  $("examView").addEventListener("pointerdown", armFocusMonitoring);
  $("examView").addEventListener("keydown", armFocusMonitoring);
  window.addEventListener("blur", () => { if (focusMonitoringArmed) recordFocusEvent("focus"); });
  window.addEventListener("focus", () => {
    focusAway = false;
    if (attempt && !finalized && !submitPending) { tick(); renderQuestion(); syncProgress(); }
  });
  window.addEventListener("pagehide", localSave);
  window.addEventListener("beforeunload", localSave);
  if (recovery && recovery.attempt && recovery.attempt.token && Array.isArray(recovery.attempt.questions)) {
    $("rollInput").value = recovery.attempt.roll;
    $("nameInput").value = recovery.attempt.name;
    if (recovery.finalized && recovery.result) {
      attempt = recovery.attempt; result = recovery.result; finalized = true; showResults();
      return;
    }
  }
  await checkExamWindow();
}
async function checkExamWindow() {
  try {
    const response = await fetch(`${SCRIPT_URL}?action=status`);
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data.apiVersion !== REQUIRED_API_VERSION) {
      message(BACKEND_UPDATE_MESSAGE, "closed");
      setVisible("studentForm", false);
      return;
    }
    const state = data.state || data.status;
    if (!state) throw new Error();
    $("durationFact").textContent = `${data.durationMinutes || 60} min`;
    if (data.openFormatted && data.closeFormatted) $("scheduleText").textContent = `Window: ${data.openFormatted} — ${data.closeFormatted}.`;
    const canResume = !!(recovery && !recovery.finalized);
    setVisible("studentForm", state === "OPEN" || canResume);
    if (state === "OPEN") message(canResume ? "An attempt is saved on this device. Enter your access code to resume." : "The exam is open. Complete your details to begin.", "open");
    else if (canResume) message("An existing attempt was found. Sign in to recover or submit your saved progress.");
    else if (state === "NOT_STARTED") message(`The exam has not started. ${data.openFormatted ? "Opens " + data.openFormatted + "." : "Please check the schedule with your teacher."}`);
    else message(data.message || `The exam is closed.${data.closeFormatted ? " Ended " + data.closeFormatted + "." : " Please contact your teacher for the schedule."}`, "closed");
  } catch (_) {
    message("Unable to check the schedule. Check your connection and reload. Saved progress is retained on this device.", "closed");
    setVisible("studentForm", !!recovery);
  }
}
async function startExam(e) {
  e.preventDefault();
  if (sending || attempt) return;
  const roll = $("rollInput").value.trim().toUpperCase();
  const name = $("nameInput").value.trim();
  const batch = ["courseInput", "branchInput", "semInput", "batchInput", "groupInput"].map(id => $(id).value.trim()).join("-");
  sending = true;
  // Request before the API call, while the Start click still grants user activation.
  const fullscreenRequest = enterFullscreen();
  $("startBtn").disabled = true; $("startBtn").textContent = "Preparing your assessment…";
  try {
    const fullscreenReady = await fullscreenRequest;
    if (!fullscreenReady || !document.fullscreenElement) {
      message("Full screen is required before starting. Select Full screen above, allow it in your browser, then select Start / resume again. No new attempt has been started.", "closed");
      return;
    }
    const previous = recovery && recovery.attempt && recovery.attempt.roll === roll ? recovery : null;
    const data = await api({action: "startAttempt", rollNo: roll, name, batch, accessCode: $("accessCode").value, token: previous ? previous.attempt.token : ""});
    $("accessCode").value = "";
    attempt = data.attempt;
    focusMonitoringArmed = false; tabAway = false; focusAway = false;
    clockOffset = data.serverNow - Date.now();
    deadline = attempt.deadline;
    attempt.seenQuestions = [...new Set([...(attempt.seenQuestions || []), ...(previous && previous.attempt.token === attempt.token ? previous.attempt.seenQuestions || [] : [])])];
    attempt.lockedQuestions = attempt.lockedQuestions || [];
    finalized = false;
    if (data.result) { acceptResult(data.result); return; }
    // Merge the newest unsynced device changes only for the identical server attempt.
    if (previous && previous.attempt.token === attempt.token && !previous.finalized && previous.savedAt > (attempt.updatedAt || 0)) {
      const allowed = new Set(attempt.questions.map(q => String(q.id)));
      const serverLocked = [...attempt.lockedQuestions];
      const serverAnswers = {...attempt.answers};
      attempt.answers = Object.fromEntries(Object.entries(previous.attempt.answers || {}).filter(([id]) => allowed.has(id)));
      attempt.flags = (previous.attempt.flags || []).filter(id => allowed.has(String(id)));
      attempt.currentIdx = Math.min(previous.attempt.currentIdx || 0, attempt.questions.length - 1);
      attempt.focusLosses = Math.max(attempt.focusLosses || 0, previous.attempt.focusLosses || 0);
      attempt.tabSwitches = Math.max(attempt.tabSwitches || 0, previous.attempt.tabSwitches || 0);
      attempt.lockedQuestions = [...new Set([...serverLocked, ...(previous.attempt.lockedQuestions || []).filter(id => allowed.has(String(id)))])];
      for (const id of serverLocked) {
        if (serverAnswers[id] === undefined) delete attempt.answers[id]; else attempt.answers[id] = serverAnswers[id];
      }
      submitPending = !!previous.submitPending;
    }
    setVisible("gateView", false); setVisible("examView", true); setVisible("timerDisplay", true);
    $("sessionBadge").textContent = "Assessment in progress";
    $("studentLine").textContent = `${attempt.name} · ${attempt.roll} · ${attempt.batch}`;
    buildPalette(); renderQuestion(); localSave();
    sending = false;
    timer = setInterval(tick, 1000); tick();
    if (submitPending) submitExam(); else syncProgress();
    $("examHeading").setAttribute("tabindex", "-1"); $("examHeading").focus();
  } catch (err) { message(err.message, "closed"); }
  finally { sending = false; $("startBtn").disabled = false; $("startBtn").textContent = "Start / resume assessment →"; }
}
let questionFeedbackBusy = false;
async function submitCurrentQuestion() {
  if(questionBlocked() || questionFeedbackBusy) return;
  const q=attempt.questions[attempt.currentIdx];
  if(attempt.answers[q.id]===undefined){$("saveStatus").textContent="Select an answer before submitting this question.";return;}
  questionFeedbackBusy=true;
  $("submitQuestionBtn").disabled=true;
  $("submitQuestionBtn").textContent="Saving…";
  revision++;
  localSave();
  clearTimeout(saveTimer);
  $("saveStatus").textContent="Saving this answer online… Please wait; one click is enough.";
  try {
    const payload={action:"submitQuestion",rollNo:attempt.roll,token:attempt.token,questionId:q.id,...snapshot()};
    let response;
    try { response=await api(payload); }
    catch(err) {
      if(!(err.name==="AbortError" || err.name==="TypeError" || /server is unavailable/i.test(err.message)))throw err;
      $("saveStatus").textContent="Connection interrupted. Retrying your saved answer automatically…";
      response=await api(payload);
    }
    lastSync=Date.now();
    $("saveStatus").textContent="Answer saved online";
    if(response.result){acceptResult(response.result);return;}
    attempt.feedback=attempt.feedback || {};
    attempt.feedback[q.id]={correct:response.correctOption,selected:response.selectedOption};
    localSave();renderQuestion();
    $("submitQuestionBtn").textContent=response.selectedOption===response.correctOption?"Correct ✓":"Incorrect";
    await new Promise(resolve=>setTimeout(resolve,1000));
    questionFeedbackBusy=false;
    if(!blocked() && attempt.questions[attempt.currentIdx].id===q.id){
      if(attempt.currentIdx<attempt.questions.length-1)navigate(1);else renderQuestion();
    }
  } catch(err){$("saveStatus").textContent=err.message+" Your answer is retained on this device. Select Submit Question to retry.";}
  finally{questionFeedbackBusy=false;if(attempt && !finalized && !submitPending)renderQuestion();}
}
function blocked() { return !attempt || finalized || submitPending || Date.now() + clockOffset >= deadline; }
function questionBlocked() {
  return blocked() || questionFeedbackBusy || (attempt.lockedQuestions || []).includes(attempt.questions[attempt.currentIdx].id);
}
function recordFocusEvent(kind) {
  if (blocked()) return;
  if (kind === "tab") {
    if (tabAway) return;
    tabAway = true; attempt.tabSwitches = (attempt.tabSwitches || 0) + 1;
  } else {
    if (focusAway) return;
    focusAway = true; attempt.focusLosses = (attempt.focusLosses || 0) + 1;
  }
  lockCurrentQuestion();
  changed(); syncProgress();
}
function lockCurrentQuestion() {
  if (blocked()) return;
  const seen = new Set([...(attempt.seenQuestions || []), attempt.questions[attempt.currentIdx].id]);
  attempt.lockedQuestions = [...new Set([...(attempt.lockedQuestions || []), ...seen])];
  changed(); renderQuestion(); syncProgress();
}
function tick() {
  if (!attempt || finalized) return;
  const remaining = Math.max(0, Math.ceil((deadline - Date.now() - clockOffset) / 1000));
  $("timerDisplay").textContent = `${String(Math.floor(remaining / 60)).padStart(2,"0")}:${String(remaining % 60).padStart(2,"0")}`;
  $("timerDisplay").classList.toggle("urgent", remaining <= 120);
  const level = remaining <= 120 ? 2 : remaining <= 600 ? 1 : 0;
  if (level > warningLevel) {
    warningLevel = level; setVisible("timeWarning", true);
    $("timeWarning").textContent = level === 2 ? "2 minutes or less remain. Review your answers and prepare to submit." : "10 minutes or less remain. Check your unanswered and flagged questions.";
  }
  if (remaining === 0 && !submitPending) submitExam();
  else if (Date.now() - lastSync > 20000 && !syncing && !submitPending) syncProgress();
}
function renderQuestion(focus = false) {
  const q = attempt.questions[attempt.currentIdx];
  attempt.seenQuestions = [...new Set([...(attempt.seenQuestions || []), q.id])];
  $("qCounter").textContent = `Question ${attempt.currentIdx + 1} of ${attempt.questions.length}`;
  $("qTopic").textContent = q.topic || "Oracle SQL"; $("qText").textContent = q.q;
  const options = $("optionsContainer"); options.replaceChildren();
  q.options.forEach((option, index) => {
    const label = document.createElement("label"); label.className = "option";
    const radio = document.createElement("input"); radio.type = "radio"; radio.name = "answer"; radio.value = String(index); radio.checked = attempt.answers[q.id] === index; radio.disabled = questionBlocked();
    const letter = document.createElement("span"); letter.className = "option-letter"; letter.textContent = String.fromCharCode(65 + index) + "."; letter.setAttribute("aria-hidden", "true");
    const text = document.createElement("span"); text.textContent = option;
    const feedback=attempt.feedback && attempt.feedback[q.id];
    if(questionFeedbackBusy && feedback && feedback.selected===attempt.answers[q.id]){
      if(index===feedback.correct)label.classList.add("feedback-correct");
      else if(index===feedback.selected)label.classList.add("feedback-wrong");
    }
    radio.onchange = () => { if (questionBlocked()) return; if(attempt.feedback)delete attempt.feedback[q.id]; attempt.answers[q.id] = index; $("submitQuestionBtn").textContent = "Submit Question"; changed(); renderQuestion(); };
    label.append(radio, letter, text); options.appendChild(label);
  });
  $("prevBtn").disabled = attempt.currentIdx === 0 || submitPending;
  $("nextBtn").disabled = attempt.currentIdx === attempt.questions.length - 1 || submitPending;
  const locked = (attempt.lockedQuestions || []).includes(q.id);
  $("submitQuestionBtn").disabled = questionBlocked();
  $("clearBtn").disabled = questionBlocked();
  $("submitQuestionBtn").textContent = locked ? "Question locked" : "Submit Question";
  setVisible("questionLockBanner", locked);
  $("questionLockBanner").textContent = locked ? "Question locked: the exam lost focus or you switched tabs. Your existing answer is retained; you cannot select, change or clear an answer for this question. You may continue to another question." : "";
  updateFlag(); updatePalette();
  if (focus) { $("qText").setAttribute("tabindex", "-1"); $("qText").focus(); }
}
function updateFlag() {
  const flagged = attempt.flags.includes(attempt.questions[attempt.currentIdx].id);
  $("flagBtn").setAttribute("aria-pressed", String(flagged));
  $("flagBtn").textContent = flagged ? "⚑ Flagged for review" : "⚑ Mark for review";
}
function navigate(delta) {
  if (questionFeedbackBusy || blocked()) return;
  attempt.currentIdx = Math.max(0, Math.min(attempt.questions.length - 1, attempt.currentIdx + delta));
  changed(); renderQuestion(true);
}
function buildPalette() {
  $("questionPalette").replaceChildren();
  attempt.questions.forEach((q, idx) => {
    const btn = document.createElement("button"); btn.type = "button"; btn.textContent = String(idx + 1);
    btn.onclick = () => { if (questionFeedbackBusy || blocked()) return; attempt.currentIdx = idx; changed(); renderQuestion(true); };
    $("questionPalette").appendChild(btn);
  });
}
function counts() {
  const answered = attempt.questions.filter(q => Number.isInteger(attempt.answers[q.id])).length;
  return {answered, unanswered: attempt.questions.length - answered, flagged: attempt.flags.length};
}
function updatePalette() {
  const count = counts();
  $("progressText").textContent = `${count.answered} of ${attempt.questions.length} answered`;
  $("flagCount").textContent = `${count.flagged} flagged for review`;
  $("navigatorCount").textContent = `${count.answered} / ${attempt.questions.length}`;
  $("examProgress").max = attempt.questions.length; $("examProgress").value = count.answered;
  attempt.questions.forEach((q, idx) => {
    const btn = $("questionPalette").children[idx];
    const detail = result && result.details ? result.details[idx] : null;
    const answered = attempt.answers[q.id] !== undefined;
    const feedback=attempt.feedback && attempt.feedback[q.id];
    let state = detail ? detail.status : feedback && feedback.selected===attempt.answers[q.id] ? (feedback.correct===feedback.selected?"correct":"wrong") : answered ? "answered" : "unanswered";
    const flagged = !finalized && attempt.flags.includes(q.id);
    const locked = !finalized && (attempt.lockedQuestions || []).includes(q.id);
    btn.className = "pal-btn" + ((state === "correct" || state === "answered") ? " answered" : state === "wrong" ? " incorrect" : "") + (locked ? " locked" : "") + (flagged ? " flagged" : "") + (!finalized && !submitPending && attempt.currentIdx === idx ? " current" : "");
    btn.disabled = submitPending;
    btn.setAttribute("aria-disabled", String(finalized || submitPending));
    btn.setAttribute("aria-label", `Question ${idx + 1}: ${state === "wrong" ? "incorrect" : state}${flagged ? ", flagged for review" : ""}${locked ? ", locked after focus loss" : ""}`);
    if (attempt.currentIdx === idx && !finalized && !submitPending) btn.setAttribute("aria-current", "step"); else btn.removeAttribute("aria-current");
    btn.title = btn.getAttribute("aria-label");
  });
}
function confirmSubmit() {
  if (blocked()) return;
  const c = counts();
  $("confirmCounts").textContent = `Answered: ${c.answered} / ${attempt.questions.length}\nUnanswered: ${c.unanswered}\nFlagged for review: ${c.flagged}\nLocked questions: ${new Set(attempt.lockedQuestions || []).size}`;
  $("submitDialog").returnValue = "";
  $("submitDialog").showModal();
}
function openSessionVerification() {
  $("sessionCode").value = "";
  setVisible("sessionError", false);
  if (!$("sessionDialog").open) $("sessionDialog").showModal();
}
async function recoverSession(event) {
  event.preventDefault();
  if (!attempt || sending || finalized) return;
  sending = true; $("recoverSessionBtn").disabled = true;
  setVisible("sessionError", false);
  try {
    const data = await api({action:"recoverAttempt",rollNo:attempt.roll,accessCode:$("sessionCode").value,
      startedAt:attempt.startedAt,questionIds:attempt.questions.map(q=>q.id)});
    const restored = data.attempt;
    if (!restored || restored.startedAt !== attempt.startedAt || JSON.stringify(restored.questions.map(q=>q.id)) !== JSON.stringify(attempt.questions.map(q=>q.id))) {
      throw new Error("The server returned a different attempt. Your saved answers are retained. Please contact your teacher.");
    }
    attempt.token = restored.token;
    deadline = restored.deadline; attempt.deadline = deadline;
    clockOffset = data.serverNow - Date.now();
    attempt.lockedQuestions = [...new Set([...(attempt.lockedQuestions || []), ...(restored.lockedQuestions || [])])];
    for (const id of restored.lockedQuestions || []) {
      if (restored.answers[id] === undefined) delete attempt.answers[id]; else attempt.answers[id] = restored.answers[id];
    }
    needsSessionVerification = false;
    localSave(); $("sessionDialog").close(); $("sessionCode").value = "";
    if (data.result) { acceptResult(data.result); return; }
    sending = false;
    await submitExam();
  } catch (err) {
    $("sessionError").textContent = err.message;
    setVisible("sessionError", true);
  } finally { sending = false; $("recoverSessionBtn").disabled = false; }
}
async function submitExam() {
  if (needsSessionVerification) { openSessionVerification(); return; }
  if (!attempt || finalized || sending) return;
  sending = true; submitPending = true;
  clearInterval(timer); clearTimeout(saveTimer);
  if ($("submitDialog").open) $("submitDialog").close("cancel");
  localSave(); showResults();
  $("resultHeading").textContent = "Saving your assessment…";
  $("resultSummary").textContent = "Keep this page open while your submission is confirmed.";
  setVisible("retryBtn", false);
  setVisible("verifySessionBtn", false);
  try {
    const data = await api({action: "submit", rollNo: attempt.roll, token: attempt.token, ...snapshot()});
    acceptResult(data.result);
  } catch (err) {
    $("resultHeading").textContent = "Submission awaiting confirmation";
    needsSessionVerification = /session could not be verified|session.*invalid|invalid.*session/i.test(err.message);
    $("resultSummary").textContent = needsSessionVerification
      ? "Your saved session needs verification. Your answers remain on this device. Select Verify session and submit, then enter your student access code."
      : `${err.message} Your answers are retained on this device. Retry to confirm the same attempt; a duplicate result will not be created.`;
    setVisible("retryBtn", !needsSessionVerification);
    setVisible("verifySessionBtn", needsSessionVerification); localSave();
  } finally { sending = false; }
}
function acceptResult(value) {
  needsSessionVerification = false;
  result = value; finalized = true; submitPending = false;
  clearInterval(timer); clearTimeout(saveTimer);
  // Use the server's accepted answers, including its deadline cutoff.
  attempt.answers = Object.fromEntries(result.details.filter(d => Number.isInteger(d.selected)).map(d => [d.questionId, d.selected]));
  localSave(); showResults();
}
function nextStudent() {
  // Pending answers must remain recoverable until the server confirms submission.
  if (!finalized || !result) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {
    $("resultSummary").textContent = "Unable to clear the saved session. Please allow site storage and try again.";
    return;
  }
  clearInterval(timer); clearTimeout(saveTimer);
  attempt = null; recovery = null; result = null; finalized = false; submitPending = false;
  // pagehide/beforeunload cannot rewrite the cleared previous student's session.
  window.location.reload();
}
function showResults() {
  setVisible("gateView", false); setVisible("examView", false); setVisible("timerDisplay", false); setVisible("resultView", true);
  $("sessionBadge").textContent = finalized ? "Assessment submitted" : "Submission pending";
  $("resultIdentity").textContent = `${attempt.name} · ${attempt.roll} · ${attempt.batch}`;
  setVisible("nextStudentBtn", finalized && !!result);
  setVisible("verifySessionBtn", !finalized && needsSessionVerification);
  setVisible("examSubmitActions", false);
  $("resultNavigator").appendChild($("navigatorCard"));
  buildPalette(); updatePalette();
  $("navigatorLegend").textContent = finalized ? "Green = Correct · Red = Incorrect · Gray = Unanswered. Hover or focus a number for its status." : "Green = Answered · Gray = Unanswered. Grading appears after the server confirms submission.";
  $("resultStats").replaceChildren();
  if (finalized && result) {
    $("resultHeading").textContent = "Assessment submitted successfully";
    $("resultSummary").textContent = `Your result has been recorded. Score: ${result.score} / ${result.totalQuestions} (${result.percentage}%).`;
    const stats = [[`${result.percentage}%`, "Overall score", ""], [result.correctCount, "Correct", "correct"], [result.wrongCount, "Incorrect", "incorrect"], [result.unattemptedCount, "Unanswered", ""], [new Set(attempt.lockedQuestions || []).size, "Locked questions", "locked"]];
    for (const [value, label, cls] of stats) {
      const item = document.createElement("div"); item.className = "stat " + cls;
      const strong = document.createElement("strong"); strong.textContent = value;
      const span = document.createElement("span"); span.textContent = label; item.append(strong, span); $("resultStats").appendChild(item);
    }
    setVisible("retryBtn", false);
  }
  $("resultHeading").setAttribute("tabindex", "-1"); $("resultHeading").focus();
}
document.addEventListener("DOMContentLoaded", initialize);
