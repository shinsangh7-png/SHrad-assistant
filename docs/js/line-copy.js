import { copyToClipboard } from "./clipboard.js";

// A small drag-to-copy handle per line, rendered in a column beside the textarea. Click one
// handle to copy just that line; press and drag across handles to copy the covered lines
// joined by real newlines (so pasting reproduces them as separate lines). Line positions are
// measured with a hidden mirror element (same font/box as the textarea) rather than assumed
// from a fixed line-height, so it stays correct even if a long line wraps onto multiple visual
// rows.
export function attachLineCopyHandles(textarea, overlay, { onStatus } = {}) {
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    whiteSpace: "pre-wrap",
    wordWrap: "break-word",
    overflowWrap: "break-word",
    borderStyle: "solid",
    borderColor: "transparent",
  });
  document.body.appendChild(mirror);

  const MIRROR_PROPS = [
    "boxSizing", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight",
    "letterSpacing", "textTransform",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  ];

  function syncMirrorBox() {
    const cs = getComputedStyle(textarea);
    MIRROR_PROPS.forEach((prop) => {
      mirror.style[prop] = cs[prop];
    });
    mirror.style.width = `${textarea.offsetWidth}px`;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function measureLineOffsets(lines) {
    syncMirrorBox();
    mirror.innerHTML = lines
      .map((line, i) => `<span class="lc-mark" data-i="${i}">${escapeHtml(line) || " "}</span>`)
      .join("\n");
    return [...mirror.querySelectorAll(".lc-mark")].map((span) => ({
      top: span.offsetTop,
      height: span.offsetHeight,
    }));
  }

  let lines = [];
  let offsets = [];

  function rebuild() {
    lines = textarea.value.split("\n");
    offsets = measureLineOffsets(lines);
    render();
  }

  function render() {
    overlay.innerHTML = "";
    const scrollTop = textarea.scrollTop;
    const viewHeight = textarea.clientHeight;
    offsets.forEach((off, i) => {
      const top = off.top - scrollTop;
      const height = Math.max(off.height, 10);
      if (top + height < 0 || top > viewHeight) return;
      const handle = document.createElement("div");
      handle.className = "line-copy-handle";
      handle.dataset.index = String(i);
      handle.style.top = `${top}px`;
      handle.style.height = `${height}px`;
      overlay.appendChild(handle);
    });
  }

  function setActiveRange(a, b) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    overlay.querySelectorAll(".line-copy-handle").forEach((el) => {
      const idx = Number(el.dataset.index);
      el.classList.toggle("active", idx >= lo && idx <= hi);
    });
  }

  function clearActive() {
    overlay.querySelectorAll(".line-copy-handle").forEach((el) => el.classList.remove("active"));
  }

  async function copyRange(a, b) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const text = lines.slice(lo, hi + 1).join("\n");
    try {
      await copyToClipboard(text);
      const n = hi - lo + 1;
      onStatus?.(n === 1 ? "1줄 복사됨" : `${n}줄 복사됨`);
    } catch (e) {
      onStatus?.(`복사 실패: ${e.message}`, true);
    }
  }

  let dragStart = null;
  let dragCurrent = null;

  overlay.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".line-copy-handle");
    if (!handle) return;
    e.preventDefault();
    const idx = Number(handle.dataset.index);
    dragStart = idx;
    dragCurrent = idx;
    try {
      overlay.setPointerCapture(e.pointerId);
    } catch (err) {
      // Ignore -- pointer capture is a nice-to-have (keeps drag tracking even if the
      // pointer leaves the overlay); the range logic below works without it.
    }
    setActiveRange(idx, idx);
  });

  overlay.addEventListener("pointermove", (e) => {
    if (dragStart === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const handle = el && el.closest(".line-copy-handle");
    if (handle) {
      dragCurrent = Number(handle.dataset.index);
      setActiveRange(dragStart, dragCurrent);
    }
  });

  function endDrag() {
    if (dragStart === null) return;
    const a = dragStart;
    const b = dragCurrent ?? dragStart;
    dragStart = null;
    dragCurrent = null;
    copyRange(a, b);
    setTimeout(clearActive, 400);
  }

  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);

  new ResizeObserver(rebuild).observe(textarea);
  textarea.addEventListener("input", rebuild);
  textarea.addEventListener("scroll", render);
  window.addEventListener("resize", rebuild);

  rebuild();
}
