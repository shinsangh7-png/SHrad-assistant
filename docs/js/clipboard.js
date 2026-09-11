// navigator.clipboard.writeText silently rejects in some browsers/contexts (window not
// focused at the moment of the call, permission not yet granted, older WebView) -- which is
// why "Copy" worked sometimes and not others. Fall back to the older execCommand("copy") path
// (via a throwaway textarea) whenever the modern API is unavailable or fails.
export async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (e) {
      // fall through to the legacy fallback below
    }
  }
  copyWithExecCommand(text);
}

function copyWithExecCommand(text) {
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
  if (!ok) throw new Error("클립보드 복사에 실패했습니다.");
}
