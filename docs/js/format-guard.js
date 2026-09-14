// Correction/Conclusion are both told not to touch blank-line spacing, but an LLM can still
// drift on this despite explicit instructions -- observed concretely as an extra blank line
// getting inserted right after a bracket section marker (e.g. "[ Conclusion ]\nNo significant
// abnormality." coming back as "[ Conclusion ]\n\nNo significant abnormality."), apparently the
// model "tidying up" perceived inconsistent spacing elsewhere in the same document. Rather than
// relying solely on prompt wording, deterministically force the blank-line count immediately
// after each section marker in the model's output back to whatever it was in the original --
// this can't drift regardless of what the model does, and it never touches the actual finding
// text, only the newline run right after each marker.
const MARKER_RE = /\[\s*[A-Za-z][A-Za-z\s]*\]/g;

function newlineRunAfter(text, index) {
  let count = 0;
  while (text[index + count] === "\n") count++;
  return count;
}

export function restoreMarkerSpacing(original, corrected) {
  const origMarkers = [...original.matchAll(MARKER_RE)];
  if (origMarkers.length === 0) return corrected;

  let result = corrected;
  let searchFrom = 0;
  for (const m of origMarkers) {
    const markerText = m[0];
    const idx = result.indexOf(markerText, searchFrom);
    if (idx === -1) continue; // marker missing/renamed in the output -- not this guard's job
    const afterIdx = idx + markerText.length;
    const desired = newlineRunAfter(original, m.index + markerText.length);
    const actual = newlineRunAfter(result, afterIdx);
    if (desired !== actual && desired <= 2 && actual <= 2) {
      result = result.slice(0, afterIdx) + "\n".repeat(desired) + result.slice(afterIdx + actual);
    }
    searchFrom = idx + markerText.length;
  }
  return result;
}
