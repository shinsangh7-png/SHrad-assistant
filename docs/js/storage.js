const KEYS = {
  rules: "sh-rad.rules",
  settings: "sh-rad.settings",
};

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
    return readJson(KEYS.settings, { openaiApiKey: "", anthropicApiKey: "", customTerms: "", hotkey: "F6" });
  },
  saveSettings(settings) {
    writeJson(KEYS.settings, settings);
  },

  // --- Post-processing rules ---
  listRules() {
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
};

export function applyPostprocessingRules(text) {
  const rules = storage.listRules().filter((r) => r.is_active && r.find_text);
  let result = text;
  for (const rule of rules) {
    const pattern = new RegExp(`\\b${rule.find_text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    result = result.replace(pattern, rule.replace_text);
  }
  return result;
}
