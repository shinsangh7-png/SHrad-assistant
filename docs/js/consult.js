import { storage } from "./storage.js";
import { CHAT_CLIENTS, PROVIDER_LABELS, readFileAsImage } from "./chat-clients.js";
import { radiologyConsultSystemPrompt, pptSummarySystemPrompt, extractJson } from "./consult-prompts.js";
import { copyToClipboard } from "./clipboard.js";
import {
  listConversations,
  getConversation,
  getConversationByPatient,
  saveConversation,
  deleteConversation,
  newConversationId,
  newPatientId,
} from "./consult-db.js";

const PROVIDERS = ["gpt", "gemini", "claude"];

const els = {
  tabButtons: document.querySelectorAll(".consult-provider-tabs .consult-tab"),
  newPatientBtn: document.getElementById("consult-new-patient-btn"),
  sidebarList: document.getElementById("consult-conversation-list"),
  convSelect: document.getElementById("consult-conv-select"),
  modelInput: document.getElementById("consult-model-input"),
  messages: document.getElementById("consult-messages"),
  attachments: document.getElementById("consult-attachments"),
  attachBtn: document.getElementById("consult-attach-btn"),
  fileInput: document.getElementById("consult-file-input"),
  input: document.getElementById("consult-input"),
  sendBtn: document.getElementById("consult-send-btn"),
  status: document.getElementById("consult-status"),
  pptBtn: document.getElementById("consult-ppt-btn"),
  pptModal: document.getElementById("ppt-modal"),
  pptStatus: document.getElementById("ppt-modal-status"),
  pptSlides: document.getElementById("ppt-slides-container"),
  pptCopyAllBtn: document.getElementById("ppt-copy-all-btn"),
  closePptModal: document.getElementById("close-ppt-modal"),
  settingsBtn: document.getElementById("consult-settings-btn"),
  settingsModal: document.getElementById("consult-settings-modal"),
  settingsStatus: document.getElementById("consult-settings-modal-status"),
  closeSettingsModal: document.getElementById("close-consult-settings-modal"),
  saveSettingsBtn: document.getElementById("save-consult-settings-btn"),
  openaiKeyInput: document.getElementById("consult-openai-key-input"),
  geminiKeyInput: document.getElementById("consult-gemini-key-input"),
  anthropicKeyInput: document.getElementById("consult-anthropic-key-input"),
};

let activeProvider = storage.consult.getActiveProvider();
const currentConv = { gpt: null, gemini: null, claude: null };
let pendingAttachments = [];
let sending = false;

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function blankConversation(provider, patientId = newPatientId()) {
  return {
    id: newConversationId(),
    provider,
    patientId,
    title: "새 환자",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

async function loadInitialConversation(provider) {
  const lastId = storage.consult.getLastConversationId(provider);
  if (lastId) {
    const conv = await getConversation(lastId);
    if (conv) return conv;
  }
  const list = await listConversations(provider);
  return list[0] || blankConversation(provider);
}

async function ensureProviderLoaded(provider) {
  if (currentConv[provider]) return;
  currentConv[provider] = await loadInitialConversation(provider);
}

function scrollMessagesToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderMessages(conv) {
  els.messages.innerHTML = "";
  conv.messages.forEach((msg, idx) => {
    const bubble = document.createElement("div");
    bubble.className = `consult-msg ${msg.role}`;

    if (msg.images && msg.images.length) {
      const imgRow = document.createElement("div");
      imgRow.className = "consult-msg-images";
      msg.images.forEach((im) => {
        const img = document.createElement("img");
        img.src = im.dataUrl;
        img.addEventListener("click", () => window.open(im.dataUrl, "_blank"));
        imgRow.appendChild(img);
      });
      bubble.appendChild(imgRow);
    }

    if (msg.text) {
      const textEl = document.createElement("div");
      textEl.textContent = msg.text;
      bubble.appendChild(textEl);
    }

    if (msg.role === "assistant") {
      const actions = document.createElement("div");
      actions.className = "consult-msg-actions";
      PROVIDERS.filter((p) => p !== conv.provider).forEach((target) => {
        const btn = document.createElement("button");
        btn.className = "action-sm";
        btn.textContent = `${PROVIDER_LABELS[target]}로`;
        btn.title = `같은 질문을 ${PROVIDER_LABELS[target]}에 보내기`;
        btn.addEventListener("click", () => sendTo(target, conv, idx));
        actions.appendChild(btn);
      });
      bubble.appendChild(actions);
    }

    els.messages.appendChild(bubble);
  });
  scrollMessagesToBottom();
}

async function renderSidebar(provider) {
  const list = await listConversations(provider);
  const activeId = currentConv[provider]?.id;

  els.sidebarList.innerHTML = "";
  list.forEach((conv) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "consult-conv-item" + (conv.id === activeId ? " active" : "");

    const label = document.createElement("span");
    label.className = "consult-conv-item-label";
    label.textContent = conv.title || "새 환자";
    item.appendChild(label);

    const del = document.createElement("span");
    del.className = "consult-conv-item-delete";
    del.textContent = "×";
    del.title = "삭제";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeConversation(conv.id, provider);
    });
    item.appendChild(del);

    item.addEventListener("click", () => selectConversation(conv.id));
    els.sidebarList.appendChild(item);
  });

  els.convSelect.innerHTML = "";
  const blankOpt = document.createElement("option");
  blankOpt.value = "";
  blankOpt.textContent = "새 환자";
  els.convSelect.appendChild(blankOpt);
  list.forEach((conv) => {
    const opt = document.createElement("option");
    opt.value = conv.id;
    opt.textContent = conv.title || "새 환자";
    els.convSelect.appendChild(opt);
  });
  els.convSelect.value = list.some((c) => c.id === activeId) ? activeId : "";
}

async function removeConversation(id, provider) {
  if (!confirm("이 대화를 삭제할까요?")) return;
  await deleteConversation(id);
  if (currentConv[provider]?.id === id) {
    currentConv[provider] = blankConversation(provider);
    if (activeProvider === provider) renderMessages(currentConv[provider]);
  }
  if (activeProvider === provider) await renderSidebar(provider);
}

function renderAttachments() {
  els.attachments.innerHTML = "";
  pendingAttachments.forEach((im, idx) => {
    const chip = document.createElement("div");
    chip.className = "consult-attachment-chip";
    const img = document.createElement("img");
    img.src = im.dataUrl;
    const removeBtn = document.createElement("button");
    removeBtn.className = "consult-attachment-remove";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      pendingAttachments.splice(idx, 1);
      renderAttachments();
    });
    chip.append(img, removeBtn);
    els.attachments.appendChild(chip);
  });
}

async function addFiles(files) {
  const imageFiles = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
  for (const file of imageFiles) {
    try {
      pendingAttachments.push(await readFileAsImage(file));
    } catch (e) {
      setStatus(`이미지 첨부 실패: ${e.message || e}`, true);
    }
  }
  renderAttachments();
}

function autoTitle(conv) {
  if (conv.title && conv.title !== "새 환자") return;
  const firstUserMsg = conv.messages.find((m) => m.role === "user");
  if (!firstUserMsg) return;
  if (firstUserMsg.text) {
    conv.title = firstUserMsg.text.slice(0, 24) + (firstUserMsg.text.length > 24 ? "…" : "");
  } else if (firstUserMsg.images?.length) {
    conv.title = "(이미지 문의)";
  }
}

async function switchProvider(provider) {
  activeProvider = provider;
  storage.consult.setActiveProvider(provider);
  els.tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.provider === provider));
  els.modelInput.value = storage.consult.getModels()[provider];
  pendingAttachments = [];
  renderAttachments();
  setStatus("");

  await ensureProviderLoaded(provider);
  renderMessages(currentConv[provider]);
  await renderSidebar(provider);
}

function newPatient() {
  currentConv[activeProvider] = blankConversation(activeProvider);
  pendingAttachments = [];
  renderAttachments();
  renderMessages(currentConv[activeProvider]);
  setStatus("");
  renderSidebar(activeProvider);
}

async function selectConversation(id) {
  if (!id) {
    newPatient();
    return;
  }
  const conv = await getConversation(id);
  if (!conv) return;
  currentConv[activeProvider] = conv;
  storage.consult.setLastConversationId(activeProvider, id);
  renderMessages(conv);
  await renderSidebar(activeProvider);
}

async function sendMessage() {
  if (sending) return;
  const text = els.input.value.trim();
  const images = pendingAttachments.slice();
  if (!text && images.length === 0) return;

  sending = true;
  els.sendBtn.disabled = true;
  const conv = currentConv[activeProvider];

  // If the last turn is already role "user", it never got an answer (a previous send failed,
  // or this conversation was just forwarded in via [Send to X]). Claude/Gemini both reject two
  // consecutive user turns, so merge into it instead of appending a second one.
  const lastMsg = conv.messages[conv.messages.length - 1];
  if (lastMsg && lastMsg.role === "user") {
    lastMsg.text = [lastMsg.text, text].filter(Boolean).join("\n\n");
    lastMsg.images = [...(lastMsg.images || []), ...images];
  } else {
    conv.messages.push({ role: "user", text, images, ts: Date.now() });
  }
  renderMessages(conv);
  els.input.value = "";
  pendingAttachments = [];
  renderAttachments();
  setStatus(`${PROVIDER_LABELS[activeProvider]} 응답 대기중...`);

  try {
    const model = storage.consult.getModels()[activeProvider];
    const answer = await CHAT_CLIENTS[activeProvider]({
      system: radiologyConsultSystemPrompt(),
      messages: conv.messages,
      model,
    });
    conv.messages.push({ role: "assistant", text: answer, images: [], ts: Date.now() });
    autoTitle(conv);
    conv.updatedAt = Date.now();
    await saveConversation(conv);
    storage.consult.setLastConversationId(activeProvider, conv.id);
    renderMessages(conv);
    await renderSidebar(activeProvider);
    setStatus("");
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    sending = false;
    els.sendBtn.disabled = false;
  }
}

// Copies everything up to (but not including) the unsatisfying assistant reply at `msgIndex` --
// i.e. all prior context plus the user question that produced it -- into the same patient's
// thread on another provider's tab, then immediately asks that provider the same question.
async function sendTo(targetProvider, sourceConv, msgIndex) {
  const slice = sourceConv.messages.slice(0, msgIndex).map((m) => ({ ...m }));
  let target = await getConversationByPatient(sourceConv.patientId, targetProvider);
  if (!target) {
    target = blankConversation(targetProvider, sourceConv.patientId);
    target.title = sourceConv.title;
  }
  target.messages = slice;
  currentConv[targetProvider] = target;

  await switchProvider(targetProvider);
  setStatus(`${PROVIDER_LABELS[targetProvider]} 응답 대기중...`);

  try {
    const model = storage.consult.getModels()[targetProvider];
    const answer = await CHAT_CLIENTS[targetProvider]({
      system: radiologyConsultSystemPrompt(),
      messages: target.messages,
      model,
    });
    target.messages.push({ role: "assistant", text: answer, images: [], ts: Date.now() });
    target.updatedAt = Date.now();
    await saveConversation(target);
    storage.consult.setLastConversationId(targetProvider, target.id);
    renderMessages(target);
    await renderSidebar(targetProvider);
    setStatus("");
  } catch (e) {
    setStatus(e.message || String(e), true);
    renderMessages(target);
  }
}

function slideToText(slide) {
  return `${slide.title || ""}\n\n${(slide.bullets || []).map((b) => `• ${b}`).join("\n")}`;
}

function renderPptSlides(slides) {
  els.pptSlides.innerHTML = "";
  slides.forEach((slide, i) => {
    const card = document.createElement("div");
    card.className = "ppt-slide-card";

    const title = document.createElement("div");
    title.className = "ppt-slide-title";
    title.textContent = `${i + 1}. ${slide.title || ""}`;

    const list = document.createElement("ul");
    list.className = "ppt-slide-bullets";
    (slide.bullets || []).forEach((b) => {
      const li = document.createElement("li");
      li.textContent = b;
      list.appendChild(li);
    });

    const copyBtn = document.createElement("button");
    copyBtn.className = "action-sm";
    copyBtn.textContent = "복사";
    copyBtn.addEventListener("click", async () => {
      await copyToClipboard(slideToText(slide));
      copyBtn.textContent = "복사됨";
      setTimeout(() => (copyBtn.textContent = "복사"), 1000);
    });

    card.append(title, list, copyBtn);
    els.pptSlides.appendChild(card);
  });

  els.pptCopyAllBtn.onclick = async () => {
    await copyToClipboard(slides.map(slideToText).join("\n\n---\n\n"));
    els.pptCopyAllBtn.textContent = "복사됨";
    setTimeout(() => (els.pptCopyAllBtn.textContent = "전체 복사"), 1000);
  };
}

async function openPptModal() {
  const conv = currentConv[activeProvider];
  if (!conv || conv.messages.length === 0) {
    setStatus("먼저 대화를 나눠주세요.", true);
    return;
  }
  els.pptModal.classList.remove("hidden");
  els.pptSlides.innerHTML = "";
  els.pptStatus.textContent = "요약 생성 중...";
  els.pptStatus.style.color = "var(--muted)";

  try {
    const transcript = conv.messages
      .map((m) => {
        const imgNote = m.images?.length ? ` [이미지 ${m.images.length}장 첨부됨]` : "";
        return `${m.role === "user" ? "Q" : "A"}: ${m.text}${imgNote}`;
      })
      .join("\n\n");
    const model = storage.consult.getModels()[activeProvider];
    const raw = await CHAT_CLIENTS[activeProvider]({
      system: pptSummarySystemPrompt(),
      messages: [{ role: "user", text: transcript, images: [] }],
      model,
    });
    const parsed = extractJson(raw);
    const slides = Array.isArray(parsed?.slides) ? parsed.slides : [];
    if (!slides.length) throw new Error("요약 결과가 비어 있습니다.");
    els.pptStatus.textContent = "";
    renderPptSlides(slides);
  } catch (e) {
    els.pptStatus.textContent = e.message || String(e);
    els.pptStatus.style.color = "var(--danger)";
  }
}

// --- Wiring ---
els.tabButtons.forEach((btn) => btn.addEventListener("click", () => switchProvider(btn.dataset.provider)));
els.newPatientBtn.addEventListener("click", newPatient);
els.convSelect.addEventListener("change", () => selectConversation(els.convSelect.value || null));
els.attachBtn.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", async (e) => {
  await addFiles(e.target.files);
  e.target.value = "";
});
els.input.addEventListener("paste", async (e) => {
  const items = Array.from(e.clipboardData?.items || []).filter((it) => it.type.startsWith("image/"));
  if (!items.length) return;
  e.preventDefault();
  await addFiles(items.map((it) => it.getAsFile()).filter(Boolean));
});
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendMessage();
  }
});
els.sendBtn.addEventListener("click", sendMessage);
els.modelInput.addEventListener("change", () => {
  storage.consult.setModel(activeProvider, els.modelInput.value.trim());
});
els.pptBtn.addEventListener("click", openPptModal);
els.closePptModal.addEventListener("click", () => els.pptModal.classList.add("hidden"));
els.pptModal.addEventListener("click", (e) => {
  if (e.target.id === "ppt-modal") els.pptModal.classList.add("hidden");
});

// --- API key settings (shared localStorage settings object with the main SH Rad app -- this
// page only edits the 3 fields it needs, merging so it never wipes out the transcribe app's
// own fields like hotkey/theme/customTerms). ---
function openSettingsModal() {
  const s = storage.getSettings();
  els.openaiKeyInput.value = s.openaiApiKey || "";
  els.geminiKeyInput.value = s.geminiApiKey || "";
  els.anthropicKeyInput.value = s.anthropicApiKey || "";
  els.settingsStatus.textContent = "";
  els.settingsModal.classList.remove("hidden");
}
function closeSettingsModal() {
  els.settingsModal.classList.add("hidden");
}
els.settingsBtn.addEventListener("click", openSettingsModal);
els.closeSettingsModal.addEventListener("click", closeSettingsModal);
els.settingsModal.addEventListener("click", (e) => {
  if (e.target.id === "consult-settings-modal") closeSettingsModal();
});
els.saveSettingsBtn.addEventListener("click", () => {
  storage.saveSettings({
    ...storage.getSettings(),
    openaiApiKey: els.openaiKeyInput.value.trim(),
    geminiApiKey: els.geminiKeyInput.value.trim(),
    anthropicApiKey: els.anthropicKeyInput.value.trim(),
  });
  els.settingsStatus.textContent = "저장됨";
  els.settingsStatus.style.color = "var(--muted)";
  setTimeout(closeSettingsModal, 500);
});

switchProvider(activeProvider);

{
  const s = storage.getSettings();
  if (!s.openaiApiKey && !s.geminiApiKey && !s.anthropicApiKey) openSettingsModal();
}
