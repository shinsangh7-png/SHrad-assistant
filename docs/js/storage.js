const KEYS = {
  templates: "sh-rad.templates",
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

function nowIso() {
  return new Date().toISOString();
}

export const storage = {
  // --- Settings (API keys) ---
  getSettings() {
    return readJson(KEYS.settings, { anthropicApiKey: "", geminiApiKey: "" });
  },
  saveSettings(settings) {
    writeJson(KEYS.settings, settings);
  },

  // --- Templates ---
  listTemplates() {
    return readJson(KEYS.templates, []);
  },
  listTemplatesByRegion(modality, bodyRegion) {
    const all = this.listTemplates();
    return all.filter(
      (t) => t.modality === modality && (t.body_region === bodyRegion || t.body_region === "All")
    );
  },
  saveTemplate(template) {
    const all = this.listTemplates();
    if (template.id) {
      const idx = all.findIndex((t) => t.id === template.id);
      const updated = { ...all[idx], ...template, updated_at: nowIso() };
      all[idx] = updated;
      writeJson(KEYS.templates, all);
      return updated;
    }
    const created = { ...template, id: uid(), created_at: nowIso(), updated_at: nowIso() };
    all.push(created);
    writeJson(KEYS.templates, all);
    return created;
  },
  deleteTemplate(id) {
    const all = this.listTemplates().filter((t) => t.id !== id);
    writeJson(KEYS.templates, all);
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

  // --- Export / Import (manual cross-machine transfer) ---
  exportData() {
    return {
      templates: this.listTemplates(),
      rules: this.listRules(),
      exported_at: nowIso(),
    };
  },
  importData(data, { merge = true } = {}) {
    if (merge) {
      const templates = this.listTemplates();
      const existingIds = new Set(templates.map((t) => t.id));
      (data.templates || []).forEach((t) => {
        if (!existingIds.has(t.id)) templates.push(t);
      });
      writeJson(KEYS.templates, templates);

      const rules = this.listRules();
      const existingRuleIds = new Set(rules.map((r) => r.id));
      (data.rules || []).forEach((r) => {
        if (!existingRuleIds.has(r.id)) rules.push(r);
      });
      writeJson(KEYS.rules, rules);
    } else {
      writeJson(KEYS.templates, data.templates || []);
      writeJson(KEYS.rules, data.rules || []);
    }
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
