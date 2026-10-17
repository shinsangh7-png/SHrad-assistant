// Pure text helpers for the two LLM steps (Correction / Conclusion).
//
// Both used to ask the model to write the ENTIRE report back out, and output tokens are what
// dominate the wait. Now the model only returns what actually changes -- a short list of edited
// lines for Correction, just the Conclusion list for Conclusion -- and everything else in the
// document is never sent back, never rewritten, and so can't drift (blank lines, template layout,
// untouched findings all stay byte-for-byte as they were).

// A section marker is a bracketed name alone on its own line: "[ Finding ]", "[ Conclusion ]"...
const MARKER_RE = /^[ \t]*\[\s*([A-Za-z][A-Za-z ]*?)\s*\][ \t]*$/gm;

export function parseSections(text) {
  const marks = [];
  const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
  let m;
  while ((m = re.exec(text))) {
    marks.push({ name: m[1].trim().toLowerCase(), markerStart: m.index, markerEnd: m.index + m[0].length });
  }
  return marks.map((mk, i) => ({
    ...mk,
    bodyStart: mk.markerEnd,
    bodyEnd: i + 1 < marks.length ? marks[i + 1].markerStart : text.length,
  }));
}

export function findSection(text, name) {
  const wanted = name.toLowerCase();
  return parseSections(text).find((s) => s.name === wanted) || null;
}

// What the Conclusion step needs to read: the [ Finding ] section's body. With no [ Finding ]
// marker at all, everything before the first other section marker (or the whole text).
export function getFindingText(text) {
  const finding = findSection(text, "finding");
  if (finding) return text.slice(finding.bodyStart, finding.bodyEnd).trim();
  const first = parseSections(text)[0];
  return (first ? text.slice(0, first.markerStart) : text).trim();
}

// Puts a freshly generated Conclusion list into the report. An existing [ Conclusion ] section
// keeps its marker and the exact newline/blank-line spacing around the old body; only the body
// text itself is replaced. With no such section, one is added right after [ Finding ] (before
// whatever section follows it), or at the end if there's no [ Finding ] either.
export function spliceConclusion(text, newBody) {
  const body = newBody.trim();
  const concl = findSection(text, "conclusion");
  if (concl) {
    const old = text.slice(concl.bodyStart, concl.bodyEnd);
    let lead = old.match(/^\s*/)[0];
    let trail = old.trim() ? old.match(/\s*$/)[0] : "";
    if (!old.trim()) lead = "\n";
    if (!lead.includes("\n")) lead = "\n";
    if (concl.bodyEnd < text.length && !trail) trail = "\n\n";
    return text.slice(0, concl.bodyStart) + lead + body + trail + text.slice(concl.bodyEnd);
  }
  const finding = findSection(text, "finding");
  const at = finding ? finding.bodyEnd : text.length;
  const before = text.slice(0, at).replace(/\s*$/, "");
  const after = text.slice(at);
  return `${before}\n\n[ Conclusion ]\n${body}${after ? `\n\n${after}` : ""}`;
}

// Correction input: every line prefixed with its 1-based number ("  7| text"), blank lines too,
// so the model can point at lines instead of re-typing them.
export function numberLines(text) {
  return text
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(3, " ")}| ${line}`)
    .join("\n");
}

const NUMBER_PREFIX_RE = /^\s*\d+\|\s?/;
const MARKER_LINE_RE = /^\s*\[\s*[A-Za-z][A-Za-z ]*?\s*\]\s*$/;

// Applies the model's list of { line, text } / { line, delete: true } edits to `text`. Lines it
// doesn't mention are left exactly as they are, and blank lines and "[ Section ]" marker lines
// are never editable (they never need correcting, and an edit aimed at one is almost certainly
// the model miscounting a line number -- better to ignore it than damage the layout). `text` may
// contain "\n" (one line split into several); a stray echoed "  7| " prefix is stripped
// defensively. Returns the new text and how many lines actually ended up different (a listed
// line whose text came back identical doesn't count).
export function applyLineChanges(text, changes) {
  const lines = text.split("\n");
  const byLine = new Map();
  for (const c of Array.isArray(changes) ? changes : []) {
    const n = Number(c?.line);
    if (!Number.isInteger(n) || n < 1 || n > lines.length) continue;
    const original = lines[n - 1];
    if (original.trim() === "" || MARKER_LINE_RE.test(original)) continue;
    byLine.set(n, c);
  }
  const out = [];
  let changed = 0;
  lines.forEach((line, i) => {
    const c = byLine.get(i + 1);
    if (!c) {
      out.push(line);
      return;
    }
    if (c.delete === true) {
      changed++;
      return;
    }
    if (typeof c.text !== "string") {
      out.push(line);
      return;
    }
    const replacement = c.text
      .split("\n")
      .map((part) => part.replace(NUMBER_PREFIX_RE, ""))
      .join("\n");
    if (replacement !== line) changed++;
    out.push(replacement);
  });
  return { text: out.join("\n"), changed };
}
