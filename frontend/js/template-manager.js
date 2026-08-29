import { api, MODALITIES, getRegionsForModality } from "./api.js";

const modalitySelect = document.getElementById("modality-select");
const regionSelect = document.getElementById("region-select");
const titleInput = document.getElementById("title-input");
const findingsInput = document.getElementById("findings-input");
const conclusionInput = document.getElementById("conclusion-input");
const seqInput = document.getElementById("seq-input");
const templateListEl = document.getElementById("template-list");
const statusMsg = document.getElementById("status-msg");
const versionHistoryEl = document.getElementById("version-history");

let allTemplates = [];
let currentGroupId = null; // null = editing a brand-new (unsaved) template

function populateSelect(select, values) {
  select.innerHTML = values.map((v) => `<option value="${v}">${v}</option>`).join("");
}

function populateRegionsForModality() {
  populateSelect(regionSelect, getRegionsForModality(modalitySelect.value, true));
}

populateSelect(modalitySelect, MODALITIES);
populateRegionsForModality();

function setStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function clearForm() {
  titleInput.value = "";
  findingsInput.value = "";
  conclusionInput.value = "";
  seqInput.value = "";
  versionHistoryEl.innerHTML = "";
  currentGroupId = null;
}

function renderList() {
  templateListEl.innerHTML = allTemplates
    .map(
      (t) =>
        `<li data-group-id="${t.group_id}">${t.modality} / ${t.body_region}${
          t.title ? ` — ${t.title}` : " — (제목 없음)"
        }</li>`
    )
    .join("");

  templateListEl.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => {
      const template = allTemplates.find((t) => t.group_id === Number(li.dataset.groupId));
      if (template) loadTemplate(template);
      highlightSelected(li);
    });
  });
}

async function refreshList() {
  allTemplates = await api.listTemplates();
  renderList();
  const match = [...templateListEl.querySelectorAll("li")].find(
    (li) => Number(li.dataset.groupId) === currentGroupId
  );
  highlightSelected(match || null);
}

function highlightSelected(activeLi) {
  templateListEl.querySelectorAll("li").forEach((li) => li.classList.remove("selected"));
  if (activeLi) activeLi.classList.add("selected");
}

function loadTemplate(template) {
  modalitySelect.value = template.modality;
  populateRegionsForModality();
  regionSelect.value = template.body_region;
  titleInput.value = template.title || "";
  findingsInput.value = template.findings_text || "";
  conclusionInput.value = template.conclusion_text || "";
  seqInput.value = template.seq_text || "";
  currentGroupId = template.group_id;
  setStatus(`불러옴: ${template.modality} / ${template.body_region}${template.title ? " — " + template.title : ""} (v${template.version})`);
  loadHistory(template.group_id);
}

async function loadHistory(groupId) {
  if (groupId == null) {
    versionHistoryEl.innerHTML = "";
    return;
  }
  const history = await api.getTemplateHistory(groupId);
  if (history.length === 0) {
    versionHistoryEl.innerHTML = "";
    return;
  }
  versionHistoryEl.innerHTML =
    "<strong>버전 이력</strong><br>" +
    history
      .map((h) => `v${h.version}${h.is_active ? " (현재)" : ""} - ${new Date(h.updated_at).toLocaleString()}`)
      .join("<br>");
}

modalitySelect.addEventListener("change", populateRegionsForModality);

document.getElementById("new-template-btn").addEventListener("click", () => {
  clearForm();
  highlightSelected(null);
  setStatus("새 템플릿을 작성하세요. 같은 검사부위에 여러 템플릿을 등록할 수 있습니다.");
});

document.getElementById("save-btn").addEventListener("click", async () => {
  if (!titleInput.value.trim()) {
    setStatus("제목을 입력해주세요.", true);
    return;
  }
  if (!findingsInput.value.trim()) {
    setStatus("Findings 내용을 입력해주세요.", true);
    return;
  }
  try {
    const saved = await api.saveTemplate({
      modality: modalitySelect.value,
      body_region: regionSelect.value,
      title: titleInput.value,
      findings_text: findingsInput.value,
      conclusion_text: conclusionInput.value,
      seq_text: seqInput.value,
      group_id: currentGroupId,
    });
    currentGroupId = saved.group_id;
    setStatus("저장 완료 (새 버전 생성됨)");
    await refreshList();
    await loadHistory(currentGroupId);
  } catch (e) {
    setStatus(`저장 실패: ${e.message}`, true);
  }
});

const syncStatus = document.getElementById("sync-status");

document.getElementById("sync-now-btn").addEventListener("click", async () => {
  syncStatus.textContent = "동기화 중...";
  try {
    const result = await api.syncNow();
    if (!result.enabled) {
      syncStatus.textContent = "동기화 비활성화됨 (OneDrive 폴더를 찾을 수 없음)";
      syncStatus.style.color = "var(--danger)";
      return;
    }
    await refreshList();
    syncStatus.textContent = "동기화 완료";
    syncStatus.style.color = "var(--muted)";
  } catch (e) {
    syncStatus.textContent = `동기화 실패: ${e.message}`;
    syncStatus.style.color = "var(--danger)";
  }
});

document.getElementById("delete-btn").addEventListener("click", async () => {
  if (currentGroupId == null) {
    setStatus("삭제할 템플릿을 먼저 선택하세요.", true);
    return;
  }
  try {
    await api.deactivateTemplate(currentGroupId);
    setStatus("비활성화 완료");
    clearForm();
    await refreshList();
  } catch (e) {
    setStatus(`비활성화 실패: ${e.message}`, true);
  }
});

(async function init() {
  await refreshList();
})();
