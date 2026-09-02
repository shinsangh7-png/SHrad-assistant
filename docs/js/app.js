import { storage, applyPostprocessingRules } from "./storage.js";
import { correctGrammar } from "./anthropic-client.js";
import { Dictation } from "./dictation.js";
import { insertAtCursor } from "./cursor-insert.js";

const transcriptText = document.getElementById("transcript-text");
const startBtn = document.getElementById("start-btn");
const correctBtn = document.getElementById("correct-btn");
const micStatus = document.getElementById("mic-status");

function setMicStatus(msg, isError = false) {
  micStatus.textContent = msg;
  micStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

// --- Tabs ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.remove("hidden");
  });
});

// --- Dictation (F6 + start button) ---
let isRecording = false;

const dictation = new Dictation({
  onTranscript: (text) => insertAtCursor(transcriptText, text),
  onStatus: (state) => {
    if (state === "calibrating") setMicStatus("환경음 측정 중...");
    else if (state === "listening") setMicStatus("듣는 중...");
    else if (state === "transcribing") setMicStatus("전사 중...");
    else setMicStatus("");
  },
  onError: (msg) => setMicStatus(msg, true),
});

let isStarting = false;

function startRecording() {
  if (isStarting || isRecording) return;
  isStarting = true;
  dictation
    .start()
    .then(() => {
      isRecording = true;
      startBtn.classList.add("recording");
    })
    .catch((e) => setMicStatus(`마이크 시작 실패: ${e.message}`, true))
    .finally(() => {
      isStarting = false;
    });
}

function stopRecording() {
  dictation.stop();
  isRecording = false;
  startBtn.classList.remove("recording");
}

function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

// Mouse click on the mic button is the deliberate full stop/start toggle.
startBtn.addEventListener("mousedown", (e) => e.preventDefault());
startBtn.addEventListener("click", toggleRecording);

// F6 is meant to be tapped often, mid-sentence, to mark where one phrase ends and the next
// begins -- so while already recording it just cuts the current segment off and sends it,
// without stopping the mic (no re-acquiring the microphone, no recalibration delay, and
// nothing spoken right after the tap gets lost waiting for that). To actually stop dictating,
// click the mic button instead of using F6.
document.addEventListener("keydown", (e) => {
  if (e.key === "F6") {
    e.preventDefault();
    if (isRecording) dictation.cutNow();
    else startRecording();
  }
});

// --- Correction ---
correctBtn.addEventListener("mousedown", (e) => e.preventDefault());
correctBtn.addEventListener("click", async () => {
  if (!transcriptText.value.trim()) {
    setMicStatus("교정할 내용이 없습니다.", true);
    return;
  }
  correctBtn.disabled = true;
  setMicStatus("교정 중...");
  try {
    let corrected = await correctGrammar(transcriptText.value);
    corrected = applyPostprocessingRules(corrected);
    transcriptText.value = corrected;
    setMicStatus("교정 완료.");
  } catch (e) {
    setMicStatus(`교정 실패: ${e.message}`, true);
  } finally {
    correctBtn.disabled = false;
  }
});

// --- Post-processing rules tab ---
const rulesListEl = document.getElementById("rules-list");
const rulesStatus = document.getElementById("rules-status");

function setRulesStatus(msg, isError = false) {
  rulesStatus.textContent = msg;
  rulesStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function escapeAttr(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function renderRuleRow(rule) {
  const row = document.createElement("div");
  row.className = "rule-row";
  row.dataset.id = rule.id;
  row.innerHTML = `
    <input type="text" class="find-input" placeholder="Left" value="${escapeAttr(rule.find_text)}" />
    <span class="rule-arrow">&rarr;</span>
    <input type="text" class="replace-input" placeholder="Lt." value="${escapeAttr(rule.replace_text)}" />
    <label class="rule-active-toggle">
      <input type="checkbox" class="active-checkbox" ${rule.is_active ? "checked" : ""} />
    </label>
    <button type="button" class="rule-delete-btn" title="삭제">&times;</button>
  `;

  const findInput = row.querySelector(".find-input");
  const replaceInput = row.querySelector(".replace-input");
  const activeCheckbox = row.querySelector(".active-checkbox");
  const deleteBtn = row.querySelector(".rule-delete-btn");

  function save() {
    storage.saveRule({
      id: rule.id,
      find_text: findInput.value,
      replace_text: replaceInput.value,
      is_active: activeCheckbox.checked,
    });
    setRulesStatus("저장됨");
  }

  findInput.addEventListener("blur", save);
  replaceInput.addEventListener("blur", save);
  activeCheckbox.addEventListener("change", save);

  deleteBtn.addEventListener("click", () => {
    storage.deleteRule(rule.id);
    row.remove();
    setRulesStatus("삭제됨");
  });

  return row;
}

function refreshRulesList() {
  const rules = storage.listRules();
  rulesListEl.innerHTML = "";
  rules.forEach((rule) => rulesListEl.appendChild(renderRuleRow(rule)));
}

document.getElementById("add-rule-btn").addEventListener("click", () => {
  const rule = storage.saveRule({ find_text: "", replace_text: "", is_active: true });
  const row = renderRuleRow(rule);
  rulesListEl.appendChild(row);
  row.querySelector(".find-input").focus();
  setRulesStatus("새 규칙이 추가되었습니다.");
});

refreshRulesList();

// --- Settings (API keys + custom terms) ---
const settingsModal = document.getElementById("settings-modal");
const openaiKeyInput = document.getElementById("openai-key-input");
const anthropicKeyInput = document.getElementById("anthropic-key-input");
const customTermsInput = document.getElementById("custom-terms-input");
const settingsStatus = document.getElementById("settings-modal-status");

function openSettingsModal() {
  const s = storage.getSettings();
  openaiKeyInput.value = s.openaiApiKey || "";
  anthropicKeyInput.value = s.anthropicApiKey || "";
  customTermsInput.value = s.customTerms || "";
  settingsStatus.textContent = "";
  settingsModal.classList.remove("hidden");
}
function closeSettingsModal() {
  settingsModal.classList.add("hidden");
}

document.getElementById("settings-btn").addEventListener("click", openSettingsModal);
document.getElementById("close-settings-modal").addEventListener("click", closeSettingsModal);
settingsModal.addEventListener("click", (e) => {
  if (e.target.id === "settings-modal") closeSettingsModal();
});
document.getElementById("save-settings-btn").addEventListener("click", () => {
  storage.saveSettings({
    openaiApiKey: openaiKeyInput.value.trim(),
    anthropicApiKey: anthropicKeyInput.value.trim(),
    customTerms: customTermsInput.value.trim(),
  });
  settingsStatus.textContent = "저장됨";
  settingsStatus.style.color = "var(--muted)";
  setTimeout(closeSettingsModal, 500);
});

// --- Init ---
{
  const s = storage.getSettings();
  if (!s.openaiApiKey && !s.anthropicApiKey) openSettingsModal();
}
