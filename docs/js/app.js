import { storage, applyPostprocessingRules } from "./storage.js";
import { correctGrammar, getCheckpoints } from "./anthropic-client.js";
import { Dictation } from "./dictation.js";
import { insertAtCursor } from "./cursor-insert.js";

const transcriptText = document.getElementById("transcript-text");
const startBtn = document.getElementById("start-btn");
const correctBtn = document.getElementById("correct-btn");
const checkBtn = document.getElementById("check-btn");
const resetBtn = document.getElementById("reset-btn");
const micStatus = document.getElementById("mic-status");

function setMicStatus(msg, isError = false) {
  micStatus.textContent = msg;
  micStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

// The STT model auto-punctuates each segment (capital first letter, trailing period) based on
// its own guess at sentence boundaries -- but a segment is just wherever the silence timer or a
// manual F6 cut happened to land, not necessarily where the radiologist's sentence actually
// ends. Strip that per-segment guess on the way in; Correction re-adds real sentence
// capitalization/periods afterward using the full text as context.
function stripAutoPunctuation(text) {
  let t = text.replace(/[.!?]+\s*$/, "");
  if (t.length > 0) {
    const firstWord = (t.match(/^[A-Za-z]+/) || [""])[0];
    const isAcronym = firstWord.length >= 2 && firstWord === firstWord.toUpperCase();
    if (!isAcronym) t = t.charAt(0).toLowerCase() + t.slice(1);
  }
  return t;
}

// Spoken "enter" becomes a real line break. Added because Enter/Space can't be used as the
// dictation hotkey (they're needed for normal typing), so a line-break command has to be
// spoken instead -- and this has to happen at insert time, not deferred to Correction, since
// Correction is slow enough that the user often skips it entirely.
function convertSpokenNewline(text) {
  return text.replace(/\benter\b/gi, "\n");
}

// "L one two" -> "L1-2". Only triggers when the first number is spelled out as a word --
// deliberately leaves any already-digit level mention (e.g. "C3/4", "L4-5") completely alone,
// since whether a given mention should use a slash or a hyphen is contextual (this radiologist
// uses "/" for per-level finding breakdowns but "-" in conclusion-style summaries) and that
// nuance belongs to Correction, not an instant regex.
const LEVEL_NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
function convertDiscLevels(text) {
  const words = Object.keys(LEVEL_NUMBER_WORDS).join("|");
  const re = new RegExp(`\\b([LCTS])\\s+(${words})\\s+(${words}|\\d{1,2})\\b`, "gi");
  return text.replace(re, (match, letter, n1, n2) => {
    const v1 = LEVEL_NUMBER_WORDS[n1.toLowerCase()];
    const v2 = LEVEL_NUMBER_WORDS[n2.toLowerCase()] ?? parseInt(n2, 10);
    return `${letter.toUpperCase()}${v1}-${v2}`;
  });
}

// --- Tabs (plain nav buttons: "규칙" to go to the rules screen, "← 전사" to come back) ---
document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    document.getElementById(btn.dataset.tab).classList.remove("hidden");
  });
});

// --- Dictation (F6 + start button) ---
let isRecording = false;

const dictation = new Dictation({
  onTranscript: (text) =>
    insertAtCursor(
      transcriptText,
      convertSpokenNewline(applyPostprocessingRules(convertDiscLevels(stripAutoPunctuation(text))))
    ),
  onStatus: (state) => {
    if (state === "listening") setMicStatus("듣는 중...");
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

// The dictation hotkey (default F6, user-configurable in settings) just toggles recording
// on/off -- same key starts and stops, no separate pause/full-stop distinction.
let dictationHotkey = storage.getSettings().hotkey || "F6";

function normalizeKey(key) {
  return key === " " ? "Space" : key;
}

function setDictationHotkey(key) {
  dictationHotkey = key;
  startBtn.title = `전사 시작/정지 (${key})`;
}
setDictationHotkey(dictationHotkey);

document.addEventListener("keydown", (e) => {
  if (normalizeKey(e.key) === dictationHotkey) {
    e.preventDefault();
    toggleRecording();
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

// --- Reset ---
resetBtn.addEventListener("mousedown", (e) => e.preventDefault());
resetBtn.addEventListener("click", () => {
  transcriptText.value = "";
  transcriptText.focus();
  setMicStatus("초기화됨");
});

// --- Check (differential diagnosis / checkpoints) ---
const checkModal = document.getElementById("check-modal");
const checkDdxList = document.getElementById("check-ddx-list");
const checkPointsList = document.getElementById("check-points-list");
const checkModalStatus = document.getElementById("check-modal-status");

function renderCheckList(el, items) {
  el.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "check-list-empty";
    li.textContent = "해당 없음";
    el.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  });
}

function closeCheckModal() {
  checkModal.classList.add("hidden");
}

checkBtn.addEventListener("mousedown", (e) => e.preventDefault());
checkBtn.addEventListener("click", async () => {
  if (!transcriptText.value.trim()) {
    setMicStatus("확인할 내용이 없습니다.", true);
    return;
  }
  checkBtn.disabled = true;
  checkDdxList.innerHTML = "";
  checkPointsList.innerHTML = "";
  checkModalStatus.textContent = "불러오는 중...";
  checkModalStatus.style.color = "var(--muted)";
  checkModal.classList.remove("hidden");
  try {
    const { differentials, checkpoints } = await getCheckpoints(transcriptText.value);
    renderCheckList(checkDdxList, differentials);
    renderCheckList(checkPointsList, checkpoints);
    checkModalStatus.textContent = "";
  } catch (e) {
    checkModalStatus.textContent = e.message || String(e);
    checkModalStatus.style.color = "var(--danger)";
  } finally {
    checkBtn.disabled = false;
  }
});

document.getElementById("close-check-modal").addEventListener("click", closeCheckModal);
checkModal.addEventListener("click", (e) => {
  if (e.target.id === "check-modal") closeCheckModal();
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

// --- Normal-form templates (modality -> body part -> saved boilerplate text) ---
// Left-click a part = insert its saved text immediately and jump back to 전사 (the common
// case). Right-click = edit/delete via a small context menu, so managing templates never
// gets in the way of just using them.
const MODALITIES = ["MR", "CT", "US", "X-ray"];
const templateContent = document.getElementById("template-content");
const templateContextMenu = document.getElementById("template-context-menu");
let templateContextTarget = null;

function goToTranscribeTab() {
  document.getElementById("tab-templates").classList.add("hidden");
  document.getElementById("tab-transcribe").classList.remove("hidden");
}

function renderTemplateModalityStep() {
  templateContent.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "modality-grid";
  MODALITIES.forEach((modality) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-sm";
    btn.textContent = modality;
    btn.addEventListener("click", () => renderTemplatePartStep(modality));
    grid.appendChild(btn);
  });
  templateContent.appendChild(grid);
}

function renderTemplatePartStep(modality) {
  templateContent.innerHTML = "";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "action-sm";
  back.textContent = "← 모달리티";
  back.addEventListener("click", renderTemplateModalityStep);
  templateContent.appendChild(back);

  const grid = document.createElement("div");
  grid.className = "modality-grid";
  storage.templates.getParts(modality).forEach((part) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-sm";
    btn.textContent = part;
    btn.addEventListener("click", () => {
      const text = storage.templates.get(modality, part);
      if (text.trim()) insertAtCursor(transcriptText, text.trim());
      goToTranscribeTab();
    });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      templateContextTarget = { modality, part };
      templateContextMenu.style.left = `${e.clientX}px`;
      templateContextMenu.style.top = `${e.clientY}px`;
      templateContextMenu.classList.remove("hidden");
    });
    grid.appendChild(btn);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "action-sm";
  addBtn.textContent = "+ 추가";
  addBtn.addEventListener("click", () => {
    const name = prompt("새 부위 이름을 입력하세요:");
    if (name && name.trim()) {
      storage.templates.addPart(modality, name.trim());
      renderTemplateEditStep(modality, name.trim());
    }
  });
  grid.appendChild(addBtn);

  templateContent.appendChild(grid);
}

function renderTemplateEditStep(modality, part) {
  templateContent.innerHTML = "";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "action-sm";
  back.textContent = `← ${modality}`;
  back.addEventListener("click", () => renderTemplatePartStep(modality));
  templateContent.appendChild(back);

  const label = document.createElement("p");
  label.className = "rules-desc";
  label.textContent = `${modality} - ${part}`;
  templateContent.appendChild(label);

  const textarea = document.createElement("textarea");
  textarea.id = "template-edit-text";
  textarea.placeholder = "노말폼 텍스트를 입력하세요...";
  textarea.value = storage.templates.get(modality, part);
  templateContent.appendChild(textarea);

  const row = document.createElement("div");
  row.className = "action-row";

  const insertBtn = document.createElement("button");
  insertBtn.type = "button";
  insertBtn.className = "primary action-sm";
  insertBtn.textContent = "삽입";
  insertBtn.addEventListener("click", () => {
    if (textarea.value.trim()) insertAtCursor(transcriptText, textarea.value.trim());
    goToTranscribeTab();
  });

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "action-sm";
  saveBtn.textContent = "저장";
  saveBtn.addEventListener("click", () => {
    storage.templates.save(modality, part, textarea.value);
    saveBtn.textContent = "저장됨";
    setTimeout(() => {
      saveBtn.textContent = "저장";
    }, 1000);
  });

  row.appendChild(insertBtn);
  row.appendChild(saveBtn);
  templateContent.appendChild(row);
}

templateContextMenu.querySelector('[data-action="edit"]').addEventListener("click", () => {
  if (!templateContextTarget) return;
  const { modality, part } = templateContextTarget;
  renderTemplateEditStep(modality, part);
  templateContextMenu.classList.add("hidden");
});
templateContextMenu.querySelector('[data-action="delete"]').addEventListener("click", () => {
  if (!templateContextTarget) return;
  const { modality, part } = templateContextTarget;
  if (confirm(`"${part}" 템플릿을 삭제하시겠습니까?`)) {
    storage.templates.removePart(modality, part);
    renderTemplatePartStep(modality);
  }
  templateContextMenu.classList.add("hidden");
});
document.addEventListener("click", () => templateContextMenu.classList.add("hidden"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") templateContextMenu.classList.add("hidden");
});

document.querySelector('[data-tab="tab-templates"]').addEventListener("click", renderTemplateModalityStep);
renderTemplateModalityStep();

// --- Settings (API keys + custom terms) ---
const settingsModal = document.getElementById("settings-modal");
const openaiKeyInput = document.getElementById("openai-key-input");
const anthropicKeyInput = document.getElementById("anthropic-key-input");
const geminiKeyInput = document.getElementById("gemini-key-input");
const groqKeyInput = document.getElementById("groq-key-input");
const customTermsInput = document.getElementById("custom-terms-input");
const hotkeyInput = document.getElementById("hotkey-input");
const sttModelSelect = document.getElementById("stt-model-select");
const themeSelect = document.getElementById("theme-select");
const settingsStatus = document.getElementById("settings-modal-status");

hotkeyInput.addEventListener("keydown", (e) => {
  e.preventDefault();
  hotkeyInput.value = normalizeKey(e.key);
});

const THEME_CLASSES = ["theme-gray", "theme-blue", "theme-coral"];
function applyTheme(theme) {
  document.body.classList.remove(...THEME_CLASSES);
  const cls = `theme-${theme}`;
  if (THEME_CLASSES.includes(cls)) document.body.classList.add(cls);
}
themeSelect.addEventListener("change", () => {
  applyTheme(themeSelect.value);
  storage.saveSettings({ ...storage.getSettings(), theme: themeSelect.value });
});

function openSettingsModal() {
  const s = storage.getSettings();
  openaiKeyInput.value = s.openaiApiKey || "";
  anthropicKeyInput.value = s.anthropicApiKey || "";
  geminiKeyInput.value = s.geminiApiKey || "";
  groqKeyInput.value = s.groqApiKey || "";
  customTermsInput.value = s.customTerms || "";
  hotkeyInput.value = s.hotkey || "F6";
  sttModelSelect.value = s.sttModel || "gpt-4o-transcribe";
  themeSelect.value = s.theme || "pink";
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
    geminiApiKey: geminiKeyInput.value.trim(),
    groqApiKey: groqKeyInput.value.trim(),
    customTerms: customTermsInput.value.trim(),
    hotkey: hotkeyInput.value.trim() || "F6",
    sttModel: sttModelSelect.value,
    theme: themeSelect.value,
  });
  setDictationHotkey(hotkeyInput.value.trim() || "F6");
  settingsStatus.textContent = "저장됨";
  settingsStatus.style.color = "var(--muted)";
  setTimeout(closeSettingsModal, 500);
});

// --- Init ---
{
  const s = storage.getSettings();
  applyTheme(s.theme || "pink");
  if (!s.openaiApiKey && !s.anthropicApiKey) openSettingsModal();
}
