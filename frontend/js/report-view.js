import { api, MODALITIES, getRegionsForModality } from "./api.js";
import { Recorder } from "./recorder.js";
import { TranscriptPanel } from "./transcript-panel.js";

const modalitySelect = document.getElementById("modality-select");
const regionSelect = document.getElementById("region-select");
const patientContext = document.getElementById("patient-context");
const previousReport = document.getElementById("previous-report");
const findingsText = document.getElementById("findings-text");
const fullReportText = document.getElementById("full-report-text");
const micToggleBtn = document.getElementById("mic-toggle-btn");
const micStatus = document.getElementById("mic-status");
const reportStatus = document.getElementById("report-status");
const copyStatus = document.getElementById("copy-status");
const templateListInline = document.getElementById("template-list-inline");
const keyImagesDropzone = document.getElementById("key-images-dropzone");
const keyImagesPreview = document.getElementById("key-images-preview");
const modeToggle = document.getElementById("mode-toggle");
const modeToggleBtns = [...modeToggle.querySelectorAll(".mode-toggle-btn")];
const reportModeToggle = document.getElementById("report-mode-toggle");
const reportModeToggleBtns = [...reportModeToggle.querySelectorAll(".mode-toggle-btn")];

let keyImages = []; // {data, mime_type, url}
let sttMode = "ko-en";
let reportMode = localStorage.getItem("reportMode") || "local";
let templateConclusions = [];
let templateSeqs = [];

modeToggleBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    sttMode = btn.dataset.mode;
    modeToggleBtns.forEach((b) => b.classList.toggle("active", b === btn));
  });
});

reportModeToggleBtns.forEach((btn) => {
  btn.classList.toggle("active", btn.dataset.mode === reportMode);
  btn.addEventListener("click", () => {
    reportMode = btn.dataset.mode;
    localStorage.setItem("reportMode", reportMode);
    reportModeToggleBtns.forEach((b) => b.classList.toggle("active", b === btn));
  });
});

function populateSelect(select, values) {
  select.innerHTML = values.map((v) => `<option value="${v}">${v}</option>`).join("");
}

function populateRegionsForModality() {
  populateSelect(regionSelect, getRegionsForModality(modalitySelect.value));
}

populateSelect(modalitySelect, MODALITIES);
populateRegionsForModality();
modalitySelect.addEventListener("change", () => {
  populateRegionsForModality();
  refreshTemplateList();
});
regionSelect.addEventListener("change", refreshTemplateList);

let isRecording = false;

const transcriptPanel = new TranscriptPanel({ micBtn: micToggleBtn, findingsEl: findingsText });

const recorder = new Recorder({
  onStatus: (state) => transcriptPanel.setStatus(state),
  onFinal: (data) => transcriptPanel.appendSegment(data),
  onError: (msg) => {
    micStatus.textContent = `오류: ${msg}`;
    micStatus.style.color = "var(--danger)";
    stopRecording();
  },
});

function setReportStatus(msg, isError = false) {
  reportStatus.textContent = msg;
  reportStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function resetForm() {
  patientContext.value = "";
  findingsText.value = "";
  fullReportText.value = "";
  copyStatus.textContent = "";
  keyImages = [];
  templateConclusions = [];
  templateSeqs = [];
  renderKeyImages();
  setReportStatus("새 판독을 시작합니다.");
}

function appendTemplate(template) {
  const current = findingsText.value.trim();
  findingsText.value = current ? `${current}\n${template.findings_text}` : template.findings_text;

  if (template.seq_text && template.seq_text.trim()) {
    templateSeqs.push(template.seq_text.trim());
  }
  if (template.conclusion_text && template.conclusion_text.trim()) {
    templateConclusions.push(template.conclusion_text.trim());
  }
  if (templateConclusions.length || templateSeqs.length) {
    const seqBlock = templateSeqs.length ? `Sequence:\n${templateSeqs.join("\n")}\n\n` : "";
    fullReportText.value = `${seqBlock}Finding:\n${findingsText.value}\n\nConclusion:\n${templateConclusions.join("\n")}`;
  }

  setReportStatus(`템플릿 추가됨: ${template.title || "(제목 없음)"}`);
}

async function refreshTemplateList() {
  const modality = modalitySelect.value;
  const bodyRegion = regionSelect.value;
  let templates = [];
  try {
    templates = await api.listTemplatesByRegion(modality, bodyRegion);
  } catch (e) {
    templateListInline.innerHTML = `<li class="empty">템플릿 목록 조회 실패</li>`;
    return;
  }
  if (templates.length === 0) {
    templateListInline.innerHTML = `<li class="empty">${modality}/${bodyRegion}에 저장된 템플릿이 없습니다.</li>`;
    return;
  }
  templateListInline.innerHTML = templates
    .map((t, i) => `<li data-index="${i}">${t.title || "(제목 없음)"}</li>`)
    .join("");
  templateListInline.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => appendTemplate(templates[Number(li.dataset.index)]));
  });
}

function stopRecording() {
  recorder.stop();
  isRecording = false;
  micToggleBtn.classList.remove("recording", "speech");
  modeToggleBtns.forEach((b) => (b.disabled = false));
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

async function handleKeyImagePaste(e) {
  const items = [...(e.clipboardData?.items || [])];
  const files = items
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (files.length === 0) return;
  e.preventDefault();
  const added = await Promise.all(files.map(fileToBase64));
  keyImages.push(...added);
  renderKeyImages();
}

async function toggleRecording() {
  if (isRecording) {
    stopRecording();
    return;
  }
  micStatus.textContent = "";
  try {
    await recorder.start({ modality: modalitySelect.value, bodyRegion: regionSelect.value, mode: sttMode });
    isRecording = true;
    micToggleBtn.classList.add("recording");
    modeToggleBtns.forEach((b) => (b.disabled = true));
  } catch (e) {
    micStatus.textContent = `마이크 시작 실패: ${e.message}`;
    micStatus.style.color = "var(--danger)";
  }
}

async function correctOnly() {
  if (!findingsText.value.trim()) {
    setReportStatus("Findings 내용이 없습니다.", true);
    return;
  }
  setReportStatus("교정 중...");
  try {
    const corrected = await api.correctGrammar(findingsText.value, previousReport.value, reportMode);
    findingsText.value = corrected.corrected_text;
    setReportStatus("교정 완료. 확인 후 필요하면 직접 수정하세요.");
  } catch (e) {
    setReportStatus(`교정 실패: ${e.message}`, true);
  }
}

async function generateReport() {
  if (!findingsText.value.trim()) {
    setReportStatus("Findings 내용이 없습니다.", true);
    return;
  }
  setReportStatus("교정 중...");
  try {
    const corrected = await api.correctGrammar(findingsText.value, previousReport.value, reportMode);
    findingsText.value = corrected.corrected_text;

    setReportStatus("결론 생성 중...");
    const conclusion = await api.generateConclusion(
      findingsText.value,
      modalitySelect.value,
      regionSelect.value,
      previousReport.value
    );

    fullReportText.value = `Finding:\n${findingsText.value}\n\nConclusion:\n${conclusion.conclusion}`;
    setReportStatus("리포트 생성 완료");
  } catch (e) {
    setReportStatus(`리포트 생성 실패: ${e.message}`, true);
  }
}

async function copyReport() {
  if (!fullReportText.value.trim()) {
    copyStatus.textContent = "복사할 내용이 없습니다.";
    copyStatus.style.color = "var(--danger)";
    return;
  }
  try {
    await navigator.clipboard.writeText(fullReportText.value);
    copyStatus.textContent = "복사됨";
    copyStatus.style.color = "var(--muted)";
  } catch (e) {
    copyStatus.textContent = `복사 실패: ${e.message}`;
    copyStatus.style.color = "var(--danger)";
  }
}

function renderCheckpointSection(container, data, error, which) {
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
  if (which === "ddx") {
    const ddxHtml = data.differential_diagnoses
      .slice(0, 3)
      .map(
        (d) => `<div class="checkpoint-item"><strong>${d.diagnosis}</strong><span>${d.supporting_findings}</span></div>`
      )
      .join("");
    container.innerHTML = `<div class="checkpoint-section">${ddxHtml || '<div class="checkpoint-item">해당 없음</div>'}</div>`;
  } else {
    const checkpointsHtml = data.checkpoints
      .slice(0, 3)
      .map((c) => `<div class="checkpoint-item"><strong>${c.point}</strong><span>${c.rationale}</span></div>`)
      .join("");
    container.innerHTML = `<div class="checkpoint-section">${checkpointsHtml || '<div class="checkpoint-item">해당 없음</div>'}</div>`;
  }
}

async function openCheckpointsModal(which) {
  const reportOrFindings = fullReportText.value.trim() || findingsText.value.trim();
  if (!reportOrFindings) {
    setReportStatus("Findings 내용이 없습니다.", true);
    return;
  }
  const modal = document.getElementById("checkpoints-modal");
  document.getElementById("checkpoints-modal-title").textContent = which === "ddx" ? "DDx" : "Additional consideration";
  const statusEl = document.getElementById("checkpoints-modal-status");
  const claudeEl = document.getElementById("claude-checkpoints-content");
  const geminiEl = document.getElementById("gemini-checkpoints-content");
  claudeEl.className = "placeholder-panel";
  claudeEl.textContent = "불러오는 중...";
  geminiEl.className = "placeholder-panel";
  geminiEl.textContent = "불러오는 중...";
  statusEl.textContent = "";
  modal.classList.remove("hidden");

  try {
    const result = await api.getCheckpoints(
      patientContext.value,
      modalitySelect.value,
      regionSelect.value,
      reportOrFindings,
      keyImages.map(({ data, mime_type }) => ({ data, mime_type }))
    );
    renderCheckpointSection(claudeEl, result.claude, result.claude_error, which);
    renderCheckpointSection(geminiEl, result.gemini, result.gemini_error, which);
  } catch (e) {
    statusEl.textContent = `조회 실패: ${e.message}`;
    statusEl.style.color = "var(--danger)";
  }
}

function closeCheckpointsModal() {
  document.getElementById("checkpoints-modal").classList.add("hidden");
}

function renderClinicalContextSection(container, data, error) {
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
  const impressionsHtml = data.clinical_impressions
    .slice(0, 3)
    .map((c) => `<div class="checkpoint-item"><strong>${c.impression}</strong><span>${c.rationale}</span></div>`)
    .join("");
  const considerationsHtml = data.imaging_considerations
    .slice(0, 3)
    .map((c) => `<div class="checkpoint-item"><strong>${c.point}</strong><span>${c.rationale}</span></div>`)
    .join("");
  container.innerHTML = `
    <div class="checkpoint-section"><h3>Clinical impression</h3>${impressionsHtml || '<div class="checkpoint-item">해당 없음</div>'}</div>
    <div class="checkpoint-section"><h3>Imaging considerations</h3>${considerationsHtml || '<div class="checkpoint-item">해당 없음</div>'}</div>
  `;
}

async function openClinicalContextModal() {
  if (!patientContext.value.trim()) {
    setReportStatus("Clinical information 내용이 없습니다.", true);
    return;
  }
  const modal = document.getElementById("clinical-context-modal");
  const statusEl = document.getElementById("clinical-context-modal-status");
  const claudeEl = document.getElementById("claude-clinical-context-content");
  const geminiEl = document.getElementById("gemini-clinical-context-content");
  claudeEl.className = "placeholder-panel";
  claudeEl.textContent = "불러오는 중...";
  geminiEl.className = "placeholder-panel";
  geminiEl.textContent = "불러오는 중...";
  statusEl.textContent = "";
  modal.classList.remove("hidden");

  try {
    const result = await api.analyzeClinicalContext(patientContext.value, modalitySelect.value, regionSelect.value);
    renderClinicalContextSection(claudeEl, result.claude, result.claude_error);
    renderClinicalContextSection(geminiEl, result.gemini, result.gemini_error);
  } catch (e) {
    statusEl.textContent = `조회 실패: ${e.message}`;
    statusEl.style.color = "var(--danger)";
  }
}

function closeClinicalContextModal() {
  document.getElementById("clinical-context-modal").classList.add("hidden");
}

function renderAskAnswer(container, text, error) {
  if (error) {
    container.className = "placeholder-panel";
    container.textContent = error;
    return;
  }
  if (!text) {
    container.className = "placeholder-panel";
    container.textContent = "결과 없음";
    return;
  }
  container.className = "ask-answer-text";
  container.textContent = text;
}

function closeAskModal() {
  document.getElementById("ask-modal").classList.add("hidden");
}

async function submitQuestion() {
  const questionInput = document.getElementById("ask-question-input");
  const question = questionInput.value.trim();
  const statusEl = document.getElementById("ask-modal-status");
  if (!question) return;

  document.getElementById("ask-modal").classList.remove("hidden");
  const claudeEl = document.getElementById("claude-ask-content");
  const geminiEl = document.getElementById("gemini-ask-content");
  claudeEl.className = "placeholder-panel";
  claudeEl.textContent = "불러오는 중...";
  geminiEl.className = "placeholder-panel";
  geminiEl.textContent = "불러오는 중...";
  statusEl.textContent = "";

  try {
    const result = await api.askAI(question, modalitySelect.value, regionSelect.value, findingsText.value);
    renderAskAnswer(claudeEl, result.claude, result.claude_error);
    renderAskAnswer(geminiEl, result.gemini, result.gemini_error);
  } catch (e) {
    statusEl.textContent = `조회 실패: ${e.message}`;
    statusEl.style.color = "var(--danger)";
  }
}

micToggleBtn.addEventListener("click", toggleRecording);
document.getElementById("correct-only-btn").addEventListener("click", correctOnly);
document.getElementById("generate-report-btn").addEventListener("click", generateReport);
document.getElementById("new-report-btn").addEventListener("click", resetForm);
document.getElementById("copy-report-btn").addEventListener("click", copyReport);
document.getElementById("open-ddx-btn").addEventListener("click", () => openCheckpointsModal("ddx"));
document.getElementById("open-additional-btn").addEventListener("click", () => openCheckpointsModal("additional"));
keyImagesDropzone.addEventListener("paste", handleKeyImagePaste);
document.getElementById("close-checkpoints-modal").addEventListener("click", closeCheckpointsModal);
document.getElementById("checkpoints-modal").addEventListener("click", (e) => {
  if (e.target.id === "checkpoints-modal") closeCheckpointsModal();
});
document.getElementById("open-clinical-context-btn").addEventListener("click", openClinicalContextModal);
document.getElementById("close-clinical-context-modal").addEventListener("click", closeClinicalContextModal);
document.getElementById("clinical-context-modal").addEventListener("click", (e) => {
  if (e.target.id === "clinical-context-modal") closeClinicalContextModal();
});
document.getElementById("ask-submit-btn").addEventListener("click", submitQuestion);
document.getElementById("ask-question-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitQuestion();
  }
});
document.getElementById("close-ask-modal").addEventListener("click", closeAskModal);
document.getElementById("ask-modal").addEventListener("click", (e) => {
  if (e.target.id === "ask-modal") closeAskModal();
});

refreshTemplateList();
setReportStatus("새 판독을 시작합니다.");
