// Inserts `text` at the current cursor position (replacing any selection) in a textarea,
// automatically padding with a single space on either side where needed so dictating into
// the middle of existing text reads naturally — e.g. "chronic |tear" + "partial" -> "chronic
// partial tear" — without ever producing a double space or a stray leading/trailing space at
// the start/end of the field.
export function insertAtCursor(el, text) {
  if (!el || !text) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);

  let insert = text;
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before) && !/^[\s.,;:)\]]/.test(insert);
  const needsTrailingSpace = after.length > 0 && !/^\s/.test(after) && !/\s$/.test(insert) && !/^[.,;:)\]]/.test(after);

  if (needsLeadingSpace) insert = " " + insert;
  if (needsTrailingSpace) insert = insert + " ";

  el.value = before + insert + after;
  const newPos = before.length + insert.length;
  el.selectionStart = el.selectionEnd = newPos;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Assigning textarea.value from code doesn't fire "input" on its own, so anything listening for
// edits (the per-line copy handles) would keep showing the old text's layout until the next
// real keystroke. Go through this whenever the text is replaced programmatically.
export function setFieldValue(el, value) {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Returns `document.activeElement` if it is one of the given candidate elements, else null.
export function getActiveField(candidates) {
  return candidates.includes(document.activeElement) ? document.activeElement : null;
}
