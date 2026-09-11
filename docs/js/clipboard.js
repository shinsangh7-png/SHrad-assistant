// Try the classic execCommand("copy") path FIRST. It's synchronous, so it runs to completion
// inside the same click gesture that triggered it. navigator.clipboard.writeText() is async --
// if that promise takes even one extra macrotask (a permission check, the window regaining
// focus, etc.) the browser can decide the user gesture has expired and silently reject, which
// is what made Copy work only sometimes. Falling back to the async Clipboard API second still
// covers the rare case where execCommand itself is unavailable.
export async function copyToClipboard(text) {
  const previousActive = document.activeElement;
  if (copyWithExecCommand(text, previousActive)) return;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("클립보드 복사에 실패했습니다.");
}

function copyWithExecCommand(text, restoreFocusTo) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (e) {
    ok = false;
  }
  document.body.removeChild(ta);
  if (ok && restoreFocusTo && typeof restoreFocusTo.focus === "function") {
    restoreFocusTo.focus();
  }
  return ok;
}
