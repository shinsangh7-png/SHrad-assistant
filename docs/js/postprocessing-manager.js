import { storage } from "./storage.js";

const rulesListEl = document.getElementById("rules-list");
const statusMsg = document.getElementById("status-msg");

function setStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function escapeAttr(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function renderRow(rule) {
  const row = document.createElement("div");
  row.className = "rule-row";
  row.dataset.id = rule.id;
  row.innerHTML = `
    <input type="text" class="find-input" placeholder="예: Left" value="${escapeAttr(rule.find_text)}" />
    <span class="rule-arrow">&rarr;</span>
    <input type="text" class="replace-input" placeholder="예: Lt." value="${escapeAttr(rule.replace_text)}" />
    <label class="rule-active-toggle">
      <input type="checkbox" class="active-checkbox" ${rule.is_active ? "checked" : ""} /> 사용
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
    setStatus("저장됨");
  }

  findInput.addEventListener("blur", save);
  replaceInput.addEventListener("blur", save);
  activeCheckbox.addEventListener("change", save);

  deleteBtn.addEventListener("click", () => {
    storage.deleteRule(rule.id);
    row.remove();
    setStatus("삭제됨");
  });

  return row;
}

function refreshList() {
  const rules = storage.listRules();
  rulesListEl.innerHTML = "";
  rules.forEach((rule) => rulesListEl.appendChild(renderRow(rule)));
}

document.getElementById("add-rule-btn").addEventListener("click", () => {
  const rule = storage.saveRule({ find_text: "", replace_text: "", is_active: true });
  const row = renderRow(rule);
  rulesListEl.appendChild(row);
  row.querySelector(".find-input").focus();
  setStatus("새 규칙이 추가되었습니다. 내용을 입력하세요.");
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
    refreshList();
  } catch (e) {
    ioStatus.textContent = `가져오기 실패: ${e.message}`;
    ioStatus.style.color = "var(--danger)";
  }
  importFileInput.value = "";
});

refreshList();
