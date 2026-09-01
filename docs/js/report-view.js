import { storage, applyPostprocessingRules } from "./storage.js";
import { correctGrammar, getClinicalCheckpoints, extractSequence, MissingApiKeyError as ClaudeKeyError } from "./anthropic-client.js";
import { getClinicalCheckpointsGemini, MissingApiKeyError as GeminiKeyError } from "./gemini-client.js";
import { Dictation, isSpeechSupported } from "./speech.js";
import { insertAtCursor, getActiveField } from "./cursor-insert.js";

const MODALITY_REGIONS = {
  CT: ["Brain", "Chest", "Abdomen", "Spine", "Rib", "Extremity", "Shoulder"],
  US: ["Thyroid", "Carotid doppler", "LGP", "Extremity doppler", "KUB", "Echocardiography"],
  MRI: [
    "Brain", "Neck", "Abdomen", "C-spine", "T-spine", "L-spine", "TL-spine",
    "Shoulder", "Elbow", "Wrist", "Hand", "Hip", "Knee", "Ankle", "Foot",
  ],
};

const modalitySelect = document.getElementById("modality-select");
const regionSelect = document.getElementById("region-select");
const patientContext = document.getElementById("patient-context");
const findingsText = document.getElementById("findings-text");
const conclusionText = document.getElementById("conclusion-text");
const recommendationText = document.getElementById("recommendation-text");
const micToggleBtn = document.getElementById("mic-toggle-btn");
const micStatus = document.getElementById("mic-status");
const reportStatus = document.getElementById("report-status");
const templateListInline = document.getElementById("template-list-inline");
const keyImagesDropzone = document.getElementById("key-images-dropzone");
const keyImagesPreview = document.getElementById("key-images-preview");

const reportFields = [findingsText, conclusionText, recommendationText];
let keyImages = []; // {data, mime_type, url}

function setReportStatus(msg, isError = false) {
  reportStatus.textContent = msg;
  reportStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function getActiveOrDefault() {
  return getActiveField(reportFields) || findingsText;
}

reportFields.forEach((field) => {
  field.addEventListener("focus", () => field.classList.add("active-field"));
  field.addEventListener("blur", () => field.classList.remove("active-field"));
});

function preventFocusSteal(btn) {
  btn.addEventListener("mousedown", (e) => e.preventDefault());
}

// --- Modality / region / templates ---
function populateSelect(select, values) {
  select.innerHTML = values.map((v) => `<option value="${v}">${v}</option>`).join("");
}
function populateRegionsForModality() {
  populateSelect(regionSelect, MODALITY_REGIONS[modalitySelect.value] || []);
}
populateSelect(modalitySelect, Object.keys(MODALITY_REGIONS));
populateRegionsForModality();
modalitySelect.addEventListener("change", () => {
  populateRegionsForModality();
  refreshTemplateList();
});
regionSelect.addEventListener("change", refreshTemplateList);

function appendToField(field, text) {
  if (!text || !text.trim()) return;
  const current = field.value.trim();
  field.value = current ? `${current}\n${text.trim()}` : text.trim();
}

function applyTemplate(template) {
  appendToField(findingsText, template.findings_text);
  appendToField(conclusionText, template.conclusion_text);
  appendToField(recommendationText, template.recommendation_text);
  setReportStatus(`템플릿 추가됨: ${template.title || "(제목 없음)"}`);
}

function refreshTemplateList() {
  const modality = modalitySelect.value;
  const bodyRegion = regionSelect.value;
  const templates = storage.listTemplatesByRegion(modality, bodyRegion);
  if (templates.length === 0) {
    templateListInline.innerHTML = `<li class="empty">${modality}/${bodyRegion}에 저장된 템플릿이 없습니다.</li>`;
    return;
  }
  templateListInline.innerHTML = templates
    .map((t, i) => `<li data-index="${i}">${t.title || "(제목 없음)"}</li>`)
    .join("");
  templateListInline.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => applyTemplate(templates[Number(li.dataset.index)]));
  });
}

// --- Key images ---
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      const data = url.split(",")[1];
      resolve({ data, mime_type: file.type, url });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderKeyImages() {
  keyImagesDropzone.classList.toggle("has-images", keyImages.length > 0);
  keyImagesPreview.innerHTML = keyImages
    .map(
      (img, i) => `
        <div class="image-thumb">
          <img src="${img.url}" alt="key image ${i + 1}" />
          <button type="button" class="remove-btn" data-index="${i}" aria-label="삭제">&times;</button>
        </div>`
    )
    .join("");
  keyImagesPreview.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      keyImages.splice(Number(btn.dataset.index), 1);
      renderKeyImages();
    });
  });
}

async function handleKeyImagePaste(e) {
  const items = [...(e.clipboardData?.items || [])];
  const files = items.filter((item) => item.type.startsWith("image/")).map((item) => item.getAsFile()).filter(Boolean);
  if (files.length === 0) return;
  e.preventDefault();
  const added = await Promise.all(files.map(fileToBase64));
  keyImages.push(...added);
  renderKeyImages();
}
keyImagesDropzone.addEventListener("paste", handleKeyImagePaste);

// --- Dictation (Web Speech API), F6 hotkey, cursor insertion ---
let isRecording = false;

const dictation = new Dictation({
  onFinalResult: (text) => {
    insertAtCursor(getActiveOrDefault(), text);
  },
  onError: (msg) => {
    micStatus.textContent = msg;
    micStatus.style.color = "var(--danger)";
    stopRecording();
  },
  onSpeechStart: () => micToggleBtn.classList.add("speech"),
  onSpeechEnd: () => micToggleBtn.classList.remove("speech"),
});

function startRecording() {
  if (!isSpeechSupported()) {
    micStatus.textContent = "이 브라우저는 음성인식을 지원하지 않습니다. Chrome/Edge를 사용해주세요.";
    micStatus.style.color = "var(--danger)";
    return;
  }
  dictation.start();
  isRecording = true;
  micToggleBtn.classList.add("recording");
  micStatus.textContent = "녹음 중...";
  micStatus.style.color = "var(--muted)";
}

function stopRecording() {
  dictation.stop();
  isRecording = false;
  micToggleBtn.classList.remove("recording", "speech");
  micStatus.textContent = "";
}

function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

preventFocusSteal(micToggleBtn);
micToggleBtn.addEventListener("click", toggleRecording);

document.addEventListener("keydown", (e) => {
  if (e.key === "F6") {
    e.preventDefault();
    toggleRecording();
  }
});

// --- Correction ---
function friendlyApiError(e) {
  if (e instanceof ClaudeKeyError || e instanceof GeminiKeyError) return e.message;
  return e.message || String(e);
}

const correctOnlyBtn = document.getElementById("correct-only-btn");
preventFocusSteal(correctOnlyBtn);
correctOnlyBtn.addEventListener("click", async () => {
  const field = getActiveOrDefault();
  if (!field.value.trim()) {
    setReportStatus("교정할 내용이 없습니다.", true);
    return;
  }
  setReportStatus("교정 중...");
  try {
    let corrected = await correctGrammar(field.value);
    corrected = applyPostprocessingRules(corrected);
    field.value = corrected;
    setReportStatus("교정 완료. 확인 후 필요하면 직접 수정하세요.");
  } catch (e) {
    setReportStatus(`교정 실패: ${friendlyApiError(e)}`, true);
  }
});

// --- Copy (tab-delimited for Finding / Conclusion / Recommendation) ---
const copyReportBtn = document.getElementById("copy-report-btn");
preventFocusSteal(copyReportBtn);
copyReportBtn.addEventListener("click", async () => {
  const text = `${findingsText.value}\t${conclusionText.value}\t${recommendationText.value}`;
  try {
    await navigator.clipboard.writeText(text);
    setReportStatus("클립보드에 복사되었습니다 (Tab으로 구분됨 — AutoHotkey 스크립트와 함께 사용하세요).");
  } catch (e) {
    setReportStatus(`복사 실패: ${e.message}`, true);
  }
});

// --- New report ---
document.getElementById("new-report-btn").addEventListener("click", () => {
  patientContext.value = "";
  findingsText.value = "";
  conclusionText.value = "";
  recommendationText.value = "";
  keyImages = [];
  renderKeyImages();
  setReportStatus("새 판독을 시작합니다.");
});

// --- Sequence generation modal ---
const sequenceModal = document.getElementById("sequence-modal");
const sequenceDropzone = document.getElementById("sequence-image-dropzone");
const sequencePreview = document.getElementById("sequence-image-preview");
const sequenceStatus = document.getElementById("sequence-modal-status");
let sequenceImage = null;
let sequenceTargetField = null;

function renderSequenceImage() {
  sequenceDropzone.classList.toggle("has-images", !!sequenceImage);
  sequencePreview.innerHTML = sequenceImage
    ? `<div class="image-thumb"><img src="${sequenceImage.url}" alt="sequence" /><button type="button" class="remove-btn" aria-label="삭제">&times;</button></div>`
    : "";
  const removeBtn = sequencePreview.querySelector(".remove-btn");
  if (removeBtn) removeBtn.addEventListener("click", () => { sequenceImage = null; renderSequenceImage(); });
}

function openSequenceModal() {
  sequenceTargetField = getActiveOrDefault();
  sequenceImage = null;
  renderSequenceImage();
  sequenceStatus.textContent = "";
  sequenceModal.classList.remove("hidden");
}
function closeSequenceModal() {
  sequenceModal.classList.add("hidden");
}

sequenceDropzone.addEventListener("paste", async (e) => {
  const items = [...(e.clipboardData?.items || [])];
  const file = items.find((item) => item.type.startsWith("image/"))?.getAsFile();
  if (!file) return;
  e.preventDefault();
  sequenceImage = await fileToBase64(file);
  renderSequenceImage();
});

const openSequenceBtn = document.getElementById("open-sequence-btn");
preventFocusSteal(openSequenceBtn);
openSequenceBtn.addEventListener("click", openSequenceModal);
document.getElementById("close-sequence-modal").addEventListener("click", closeSequenceModal);
sequenceModal.addEventListener("click", (e) => {
  if (e.target.id === "sequence-modal") closeSequenceModal();
});

const generateSequenceBtn = document.getElementById("generate-sequence-btn");
generateSequenceBtn.addEventListener("click", async () => {
  if (!sequenceImage) {
    sequenceStatus.textContent = "이미지를 먼저 붙여넣어주세요.";
    sequenceStatus.style.color = "var(--danger)";
    return;
  }
  sequenceStatus.textContent = "생성 중...";
  sequenceStatus.style.color = "var(--muted)";
  try {
    const seqText = await extractSequence(sequenceImage.data, sequenceImage.mime_type);
    insertAtCursor(sequenceTargetField, seqText);
    closeSequenceModal();
    setReportStatus("시퀀스가 삽입되었습니다.");
  } catch (e) {
    sequenceStatus.textContent = `생성 실패: ${friendlyApiError(e)}`;
    sequenceStatus.style.color = "var(--danger)";
  }
});

// --- Clinical Check Point ---
function renderCheckpointSection(container, data, error) {
  if (error) {
    container.className = "placeholder-panel";
    container.textContent = error;
    return;
  }
  if (!data) {
    container.className = "placeholder-panel";
    container.textContent = "결과 없음";
    return;
  }
  container.className = "";
  const ddxHtml = data.differential_diagnoses
    .slice(0, 3)
    .map((d) => `<div class="checkpoint-item"><strong>${d.diagnosis}</strong><span>${d.supporting_findings}</span></div>`)
    .join("");
  const cpHtml = data.checkpoints
    .slice(0, 3)
    .map((c) => `<div class="checkpoint-item"><strong>${c.point}</strong><span>${c.rationale}</span></div>`)
    .join("");
  container.innerHTML = `
    <div class="checkpoint-section"><h3>Differential diagnosis</h3>${ddxHtml || '<div class="checkpoint-item">해당 없음</div>'}</div>
    <div class="checkpoint-section"><h3>Check point</h3>${cpHtml || '<div class="checkpoint-item">해당 없음</div>'}</div>
  `;
}

function openCheckpointsModal() {
  if (!findingsText.value.trim() && !conclusionText.value.trim()) {
    setReportStatus("작성된 내용이 없습니다.", true);
    return;
  }
  const combinedReport =
    `Findings:\n${findingsText.value}\n\nConclusion:\n${conclusionText.value}\n\nRecommendation:\n${recommendationText.value}`;
  const modal = document.getElementById("checkpoints-modal");
  const statusEl = document.getElementById("checkpoints-modal-status");
  const claudeEl = document.getElementById("claude-checkpoints-content");
  const geminiEl = document.getElementById("gemini-checkpoints-content");
  claudeEl.className = "placeholder-panel";
  claudeEl.textContent = "불러오는 중...";
  geminiEl.className = "placeholder-panel";
  geminiEl.textContent = "불러오는 중...";
  statusEl.textContent = "";
  modal.classList.remove("hidden");

  const images = keyImages.map(({ data, mime_type }) => ({ data, mime_type }));

  getClinicalCheckpoints(patientContext.value, modalitySelect.value, regionSelect.value, combinedReport, images)
    .then((result) => renderCheckpointSection(claudeEl, result, null))
    .catch((e) => renderCheckpointSection(claudeEl, null, friendlyApiError(e)));

  getClinicalCheckpointsGemini(patientContext.value, modalitySelect.value, regionSelect.value, combinedReport, images)
    .then((result) => renderCheckpointSection(geminiEl, result, null))
    .catch((e) => renderCheckpointSection(geminiEl, null, friendlyApiError(e)));
}

function closeCheckpointsModal() {
  document.getElementById("checkpoints-modal").classList.add("hidden");
}

const openCheckpointsBtn = document.getElementById("open-checkpoints-btn");
preventFocusSteal(openCheckpointsBtn);
openCheckpointsBtn.addEventListener("click", openCheckpointsModal);
document.getElementById("close-checkpoints-modal").addEventListener("click", closeCheckpointsModal);
document.getElementById("checkpoints-modal").addEventListener("click", (e) => {
  if (e.target.id === "checkpoints-modal") closeCheckpointsModal();
});

// --- Settings (API keys) ---
const settingsModal = document.getElementById("settings-modal");
const anthropicKeyInput = document.getElementById("anthropic-key-input");
const geminiKeyInput = document.getElementById("gemini-key-input");
const settingsStatus = document.getElementById("settings-modal-status");

function openSettingsModal() {
  const s = storage.getSettings();
  anthropicKeyInput.value = s.anthropicApiKey || "";
  geminiKeyInput.value = s.geminiApiKey || "";
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
    anthropicApiKey: anthropicKeyInput.value.trim(),
    geminiApiKey: geminiKeyInput.value.trim(),
  });
  settingsStatus.textContent = "저장됨";
  settingsStatus.style.color = "var(--muted)";
  setTimeout(closeSettingsModal, 600);
});

// --- Init ---
refreshTemplateList();
setReportStatus("새 판독을 시작합니다.");
{
  const s = storage.getSettings();
  if (!s.anthropicApiKey && !s.geminiApiKey) openSettingsModal();
}
