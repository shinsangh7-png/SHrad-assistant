import { storage } from "./storage.js";

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
const titleInput = document.getElementById("title-input");
const findingsInput = document.getElementById("findings-input");
const conclusionInput = document.getElementById("conclusion-input");
const recommendationInput = document.getElementById("recommendation-input");
const seqInput = document.getElementById("seq-input");
const templateListEl = document.getElementById("template-list");
const statusMsg = document.getElementById("status-msg");

let currentId = null;

function populateSelect(select, values) {
  select.innerHTML = values.map((v) => `<option value="${v}">${v}</option>`).join("");
}
function populateRegionsForModality() {
  populateSelect(regionSelect, ["All", ...(MODALITY_REGIONS[modalitySelect.value] || [])]);
}
populateSelect(modalitySelect, Object.keys(MODALITY_REGIONS));
populateRegionsForModality();
modalitySelect.addEventListener("change", populateRegionsForModality);

function setStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function clearForm() {
  titleInput.value = "";
  findingsInput.value = "";
  conclusionInput.value = "";
  recommendationInput.value = "";
  seqInput.value = "";
  currentId = null;
}

function renderList() {
  const templates = storage.listTemplates();
  templateListEl.innerHTML = templates
    .map((t) => `<li data-id="${t.id}">${t.modality} / ${t.body_region} — ${t.title || "(제목 없음)"}</li>`)
    .join("");
  templateListEl.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => {
      const t = templates.find((x) => x.id === li.dataset.id);
      if (t) loadTemplate(t);
      highlightSelected(li);
    });
  });
}

function highlightSelected(activeLi) {
  templateListEl.querySelectorAll("li").forEach((li) => li.classList.remove("selected"));
  if (activeLi) activeLi.classList.add("selected");
}

function loadTemplate(t) {
  modalitySelect.value = t.modality;
  populateRegionsForModality();
  regionSelect.value = t.body_region;
  titleInput.value = t.title || "";
  findingsInput.value = t.findings_text || "";
  conclusionInput.value = t.conclusion_text || "";
  recommendationInput.value = t.recommendation_text || "";
  seqInput.value = t.seq_text || "";
  currentId = t.id;
  setStatus(`불러옴: ${t.modality} / ${t.body_region} — ${t.title || "(제목 없음)"}`);
}

document.getElementById("new-template-btn").addEventListener("click", () => {
  clearForm();
  highlightSelected(null);
  setStatus("새 템플릿을 작성하세요.");
});

document.getElementById("save-btn").addEventListener("click", () => {
  if (!titleInput.value.trim()) {
    setStatus("제목을 입력해주세요.", true);
    return;
  }
  const saved = storage.saveTemplate({
    id: currentId,
    modality: modalitySelect.value,
    body_region: regionSelect.value,
    title: titleInput.value,
    findings_text: findingsInput.value,
    conclusion_text: conclusionInput.value,
    recommendation_text: recommendationInput.value,
    seq_text: seqInput.value,
  });
  currentId = saved.id;
  setStatus("저장 완료");
  renderList();
});

document.getElementById("delete-btn").addEventListener("click", () => {
  if (currentId == null) {
    setStatus("삭제할 템플릿을 먼저 선택하세요.", true);
    return;
  }
  storage.deleteTemplate(currentId);
  setStatus("삭제 완료");
  clearForm();
  renderList();
});

// --- Export / Import ---
const ioStatus = document.getElementById("io-status");

document.getElementById("export-btn").addEventListener("click", () => {
  const data = storage.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sh-rad-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  ioStatus.textContent = "내보내기 완료";
  ioStatus.style.color = "var(--muted)";
});

const importFileInput = document.getElementById("import-file-input");
document.getElementById("import-btn").addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", async () => {
  const file = importFileInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    storage.importData(data, { merge: true });
    ioStatus.textContent = `가져오기 완료 (템플릿 ${data.templates?.length || 0}개, 규칙 ${data.rules?.length || 0}개 확인)`;
    ioStatus.style.color = "var(--muted)";
    renderList();
  } catch (e) {
    ioStatus.textContent = `가져오기 실패: ${e.message}`;
    ioStatus.style.color = "var(--danger)";
  }
  importFileInput.value = "";
});

renderList();
