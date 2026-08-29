import { api } from "./api.js";

const rulesListEl = document.getElementById("rules-list");
const statusMsg = document.getElementById("status-msg");

function setStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? "var(--danger)" : "var(--muted)";
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

  async function save() {
    try {
      await api.updateRule(rule.id, {
        find_text: findInput.value,
        replace_text: replaceInput.value,
        is_active: activeCheckbox.checked,
      });
      setStatus("저장됨");
    } catch (e) {
      setStatus(`저장 실패: ${e.message}`, true);
    }
  }

  findInput.addEventListener("blur", save);
  replaceInput.addEventListener("blur", save);
  activeCheckbox.addEventListener("change", save);

  deleteBtn.addEventListener("click", async () => {
    try {
      await api.deleteRule(rule.id);
      row.remove();
      setStatus("삭제됨");
    } catch (e) {
      setStatus(`삭제 실패: ${e.message}`, true);
    }
  });

  return row;
}

function escapeAttr(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

async function refreshList() {
  const rules = await api.listRules();
  rulesListEl.innerHTML = "";
  rules.forEach((rule) => rulesListEl.appendChild(renderRow(rule)));
}

document.getElementById("add-rule-btn").addEventListener("click", async () => {
  try {
    const rule = await api.createRule({ find_text: "", replace_text: "" });
    const row = renderRow(rule);
    rulesListEl.appendChild(row);
    row.querySelector(".find-input").focus();
    setStatus("새 규칙이 추가되었습니다. 내용을 입력하세요.");
  } catch (e) {
    setStatus(`추가 실패: ${e.message}`, true);
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

(async function init() {
  try {
    await refreshList();
  } catch (e) {
    setStatus(`불러오기 실패: ${e.message}`, true);
  }
})();
