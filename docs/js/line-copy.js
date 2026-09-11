import { copyToClipboard } from "./clipboard.js";

// A small drag-to-copy handle per line, rendered in a column beside the textarea. Click one
// handle to copy just that line; press and drag across handles to copy the covered lines
// joined by real newlines (so pasting reproduces them as separate lines). Hovering a handle
// (or dragging across several) highlights the matching line(s) in the textarea so it's clear
// what's about to be copied.
//
// Line positions are measured with a hidden mirror element (same font/box as the textarea)
// rather than assumed from a fixed line-height, so it stays correct even if a long line wraps
// onto multiple visual rows. The mirror's width must match the textarea's actual *content*
// width -- using the textarea's outer width instead (which doesn't account for its own
// scrollbar eating into that space) was the earlier bug where positions were right for the
// first line or two and then drifted/vanished further down.
export function attachLineCopyHandles(textarea, overlay, highlight, { onStatus } = {}) {
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
    boxSizing: "border-box",
    borderWidth: "0",
  });
  document.body.appendChild(mirror);

  const MIRROR_PROPS = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight",
    "letterSpacing", "textTransform",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  ];

  function syncMirrorBox() {
    const cs = getComputedStyle(textarea);
    MIRROR_PROPS.forEach((prop) => {
      mirror.style[prop] = cs[prop];
    });
    // clientWidth (not offsetWidth) -- it already excludes the textarea's own scrollbar, which
    // is exactly the width available for text to wrap in.
    mirror.style.width = `${textarea.clientWidth}px`;
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
  let charOffsets = [];

  function rebuild() {
    lines = textarea.value.split("\n");
    offsets = measureLineOffsets(lines);
    let pos = 0;
    charOffsets = lines.map((line) => {
      const start = pos;
      pos += line.length + 1; // +1 for the newline joining it to the next line
      return { start, end: start + line.length };
    });
    positionOverlay();
    render();
  }

  // Keeps the handle column just inside the textarea's own scrollbar (rather than a fixed
  // guess), so it lines up whether or not a scrollbar is currently showing.
  function positionOverlay() {
    const cs = getComputedStyle(textarea);
    const borderX = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    const scrollbarWidth = Math.max(0, textarea.offsetWidth - textarea.clientWidth - borderX);
    const right = scrollbarWidth + 3;
    overlay.style.right = `${right}px`;
    highlight.style.right = `${right + 14}px`;
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

  function showPreview(a, b) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (!offsets[lo] || !offsets[hi]) return;
    const scrollTop = textarea.scrollTop;
    const top = offsets[lo].top - scrollTop;
    const bottom = offsets[hi].top + offsets[hi].height - scrollTop;
    highlight.style.top = `${top}px`;
    highlight.style.height = `${Math.max(bottom - top, 10)}px`;
    highlight.style.display = "block";
  }

  function hidePreview() {
    highlight.style.display = "none";
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

  overlay.addEventListener("pointerover", (e) => {
    if (dragStart !== null) return;
    const handle = e.target.closest(".line-copy-handle");
    if (!handle) return;
    showPreview(Number(handle.dataset.index), Number(handle.dataset.index));
  });

  overlay.addEventListener("pointerout", (e) => {
    if (dragStart !== null) return;
    const related = e.relatedTarget;
    if (related instanceof Node && overlay.contains(related)) return;
    hidePreview();
  });

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
    showPreview(idx, idx);
  });

  overlay.addEventListener("pointermove", (e) => {
    if (dragStart === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const handle = el && el.closest(".line-copy-handle");
    if (handle) {
      dragCurrent = Number(handle.dataset.index);
      setActiveRange(dragStart, dragCurrent);
      showPreview(dragStart, dragCurrent);
    }
  });

  function endDrag() {
    if (dragStart === null) return;
    const a = dragStart;
    const b = dragCurrent ?? dragStart;
    dragStart = null;
    dragCurrent = null;
    copyRange(a, b);
    hidePreview();
    setTimeout(clearActive, 400);
  }

  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);

  new ResizeObserver(rebuild).observe(textarea);
  textarea.addEventListener("input", rebuild);
  textarea.addEventListener("scroll", () => {
    render();
    hidePreview();
  });
  window.addEventListener("resize", rebuild);

  rebuild();
}
