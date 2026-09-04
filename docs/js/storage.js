const KEYS = {
  rules: "sh-rad.rules",
  rulesSeededDefaults: "sh-rad.rules.seededDefaults",
  settings: "sh-rad.settings",
  templates: "sh-rad.templates",
};

// Each entry is auto-inserted into the user's rules exactly once, ever, tracked individually
// by find_text (not a single "seeded?" flag) -- so adding a new entry here later still reaches
// existing users on their next load, without re-adding one they deliberately deleted. Punctuation
// -word commands ("period", "comma", 마침표/점찍고) work instantly here rather than waiting on
// Correction, since Correction is slow enough that it's often skipped. mm -> MM is a deliberate
// accepted risk against the millimeter unit -- word-boundary matching already protects the
// attached form ("4mm", "2.5mm": no boundary between a digit and a letter) but not "4 mm".
const DEFAULT_RULES = [
  { find_text: "left", replace_text: "Lt." },
  { find_text: "right", replace_text: "Rt." },
  { find_text: "comma", replace_text: "," },
  { find_text: "period", replace_text: "." },
  { find_text: "마침표", replace_text: "." },
  { find_text: "점찍고", replace_text: "." },
  { find_text: "slash", replace_text: "/" },
  { find_text: "opll", replace_text: "OPLL" },
  { find_text: "acl", replace_text: "ACL" },
  { find_text: "mm", replace_text: "MM" },
  { find_text: "rule out", replace_text: "r/o" },
];

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const storage = {
  // --- Settings (API keys + custom term list) ---
  getSettings() {
    return readJson(KEYS.settings, {
      openaiApiKey: "",
      anthropicApiKey: "",
      geminiApiKey: "",
      groqApiKey: "",
      customTerms: "",
      hotkey: "F6",
      sttModel: "gpt-4o-transcribe",
      theme: "pink",
    });
  },
  saveSettings(settings) {
    writeJson(KEYS.settings, settings);
  },

  // --- Post-processing rules ---
  listRules() {
    const seeded = readJson(KEYS.rulesSeededDefaults, []);
    const seededSet = new Set(seeded);
    const toAdd = DEFAULT_RULES.filter((r) => !seededSet.has(r.find_text));
    if (toAdd.length > 0) {
      const existing = readJson(KEYS.rules, []);
      const added = toAdd.map((r) => ({ ...r, id: uid(), is_active: true }));
      writeJson(KEYS.rules, [...existing, ...added]);
      writeJson(KEYS.rulesSeededDefaults, [...seeded, ...toAdd.map((r) => r.find_text)]);
    }
    return readJson(KEYS.rules, []);
  },
  saveRule(rule) {
    const all = this.listRules();
    if (rule.id) {
      const idx = all.findIndex((r) => r.id === rule.id);
      const updated = { ...all[idx], ...rule };
      all[idx] = updated;
      writeJson(KEYS.rules, all);
      return updated;
    }
    const created = { ...rule, id: uid(), is_active: rule.is_active ?? true };
    all.push(created);
    writeJson(KEYS.rules, all);
    return created;
  },
  deleteRule(id) {
    const all = this.listRules().filter((r) => r.id !== id);
    writeJson(KEYS.rules, all);
  },

  // --- Normal-form templates, keyed by "modality::bodyPart" ---
  templates: {
    get(modality, part) {
      const all = readJson(KEYS.templates, {});
      return all[`${modality}::${part}`] || "";
    },
    save(modality, part, text) {
      const all = readJson(KEYS.templates, {});
      all[`${modality}::${part}`] = text;
      writeJson(KEYS.templates, all);
    },
  },
};

export function applyPostprocessingRules(text) {
  const rules = storage.listRules().filter((r) => r.is_active && r.find_text);
  let result = text;
  for (const rule of rules) {
    // `\b` is ASCII-only in JS regex -- it never fires around a Korean find_text (마침표,
    // 점찍고 etc.) since Hangul isn't a `\w` character, so word-boundary rules would silently
    // never match them. Unicode-aware letter/number lookaround works for both ASCII and Hangul.
    const escaped = rule.find_text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
    result = result.replace(pattern, rule.replace_text);
  }
  // Spoken punctuation words ("comma", "period", 마침표...) leave the space that was
  // separating them from the previous word -- "tear , annular" instead of "tear, annular".
  // No space ever belongs before a comma/period, and a slash-joined level reads as "L4/5",
  // never "L4 / 5", regardless of whether it came from a rule substitution or was already there.
  result = result.replace(/\s+([,.])/g, "$1");
  result = result.replace(/\s*\/\s*/g, "/");
  return result;
}
