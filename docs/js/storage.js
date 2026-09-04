const KEYS = {
  rules: "sh-rad.rules",
  rulesSeededDefaults: "sh-rad.rules.seededDefaults",
  settings: "sh-rad.settings",
  templates: "sh-rad.templates",
  templatesSeededDefaults: "sh-rad.templates.seededDefaults",
  templateParts: "sh-rad.templateParts",
};

// Starter body-part list per modality, seeded once per modality (not globally) into
// templateParts so the user can rename/add/remove from there afterward without it reverting.
const STARTER_TEMPLATE_PARTS = {
  MR: ["C-spine", "T-L-S-spine", "Knee", "Shoulder", "Wrist", "Ankle", "Hip", "Brain", "Elbow", "Hand"],
  CT: ["C-spine", "L-spine", "Chest", "Abdomen", "Brain", "Facial bone", "Rib"],
  US: ["Thyroid", "Abdomen", "Carotid"],
  "X-ray": ["Knee", "Spine", "Chest"],
};

// From the user's own "ch normal.docx" -- their real normal-form boilerplate per modality/part,
// each a per-structure checklist ending "(-)"/"intact" for normal findings. Seeded individually
// per "modality::part" key (same pattern as DEFAULT_RULES) so it reaches this user's browser
// even though templateParts (just the names) may have already been seeded before this existed,
// and never overwrites a key the user has already saved something into (including on purpose
// clearing it to empty).
const STARTER_TEMPLATE_TEXTS = {
  "MR::C-spine":
    "Clinical information : Neck pain with radiating pain.\n" +
    "Image Protocol : 3P Localizer, SAG T2, SAG T1, SAG T2 STIR, AXL T2, AXL MERGE, Obl. SAG T2 RT, Obl. SAG T2 LT\n" +
    "[ Finding ]\n\n" +
    "C2/3 : (-)\nC3/4 : (-)\nC4/5 : (-)\nC5/6 : (-)\nC6/7 : (-)\nC7/T1 : (-)\n\n" +
    "Neural foraminal narrowing : (-)\nCentral canal stenosis : (-)\n\n" +
    "No significant abnormality at spinal cord.\n\n" +
    "[ Conclusion ]\nNo significant abnormality.\n\n" +
    "[ Recommendation ]\nclinical correlation.",
  "MR::T-L-S-spine":
    "Clinical information : \n" +
    "Image Protocol : L : 3-Plane Localizer, SAG T2, SAG STIR, SAG T1, AXL T2, AXL T1, HIP COR T2, T : 3-Plane Localizer, SAG T2\n" +
    "[ Finding ]\n\n" +
    "L1/2 : (-)\nL2/3 : (-)\nL3/4 : (-)\nL4/5 : (-)\nL5/S1 : (-)\n\n" +
    "Neural foraminal narrowing : (-)\nCentral canal stenosis : (-)\n\n" +
    "Extended Hip (limited evaluation d/t only T2 coronal scan) : no significant abnormality, both hips and both SI joints.\n\n" +
    "[ Conclusion ]\nNo significant abnormality.\n\n" +
    "[ Recommendation ]\nclinical correlation.",
  "CT::L-spine": "Clinical information : \n[ Finding ]\nNo definite visible fracture line.",
  "CT::Rib":
    "Clinical information : Trauma.\n" +
    "[ Finding ]\n" +
    "No acute or healing/remote rib fracture, both sides.\nNo transverse process fracture.\nNo pleural effusion.\n" +
    "Both lungs and mediastinum : no significant abnormality.\n\n" +
    "[ Conclusion ]\nNo significant abnormality.\n\n" +
    "[ Recommendation ]\nclinical correlation.",
  "CT::Brain":
    "[ Finding ]\n" +
    "No definite intracranial hemorrhage, midline shift or mass effect.\n" +
    "Normal size and shape of ventricles and cisterns.\nNo definite acute skull fracture.\nNo remarkable finding of brain.\n\n" +
    "[ Conclusion ]\nNo remarkable finding of brain.\n\n" +
    "[ Recommendation ]\nclinical correlation and MRI if neurologic symptom persists.\n\n" +
    "* 소량의 intracranial hemorrhage는 초기에 본 검사상 나타나지 않을 수도 있습니다.\n" +
    "임상적으로 필요한 경우에는 추적검사, MRI 등이 도움이 될 수 있습니다.",
  "MR::Brain":
    "[ Finding ]\n" +
    "Axial FLAIR, axial T1WI, axial T2WI, axial GRE, sagittal T1WI, coronal T2WI, intracranial TOF MRA, neck TOF MRA 시행함.\n\n" +
    "* Both brain hemisphere : unremarkable\n* Visible sinus, mastoid & orbit : unremarkable\n" +
    "* Epidural & subdural space : unremarkable\n* Sella, Post. fossa, CPA & brain stem : unremarkable\n" +
    "* Ventricle & cisternal space : normal size, no abnormal finding.\n" +
    "* MRA : no stenosis, occlusion, or aneurysm in circle of Willis or cervical arteries.\n\n" +
    "[ Conclusion ]\nUnremarkable finding, brain MRI and MRA.",
  "MR::Shoulder":
    "[ Finding ]\n" +
    "1. Rotator cuff\nSST : (-)\nIST : (-)\nSScT : intact.\n\n" +
    "2. Labrum & capsule\nLabrum : intact\nCapsule : intact\nLHBT : intact.\n\n" +
    "3. AC joint & bursa : Unremarkable\n\n4. Others\n\n" +
    "[ Conclusion ]\nNo significant abnormality.\n\n" +
    "[ Recommendation ]\nclinical correlation.",
  "MR::Knee":
    "[ Finding ]\n" +
    "1. Bone and cartilage\nNo bone marrow edema.\nNo chondral defect (ICRS Gr 0)\n\n" +
    "2. Menisci\nMedial meniscus : intact\nLateral meniscus : intact\n\n" +
    "3. Ligament and tendon\nACL : intact\nPCL : intact\nMCL : intact\nLCL and popliteus tendon : intact\n\n" +
    "4. Misc\n\n" +
    "[ Conclusion ]\nNo significant abnormality.\n\n" +
    "[ Recommendation ]\nclinical correlation.",
  "MR::Ankle":
    "[ Finding ]\n" +
    "1. Ligaments\nAnterior talofibular ligament : intact\nPosterior talofibular ligament : intact\n" +
    "Calcaneofibular ligament : intact\nAnterior inferior tibiofibular ligament : intact\n" +
    "Posterior inferior tibiofibular ligament : intact\nDeltoid ligament : intact\n\n" +
    "2. Tendons\nAchilles tendon : intact\nFlexor tendons : intact\nExtensor tendons : intact\nPeroneal tendons : intact\n\n" +
    "3. Bone & cartilage\nNo fracture. No bone marrow edema. No cartilage defect.\n\n4. Others\n\n" +
    "[ Conclusion ]\nNo significant abnormality.\n\n" +
    "[ Recommendation ]\nclinical correlation.",
  "MR::Wrist":
    "[ Finding ]\n" +
    "1. Triangular fibrocartilage\n- central disk : intact\n- radioulnar lig. : intact\n\n" +
    "2. Interosseous ligaments\n- Scapholunate ligament : intact\n- Lunotriquetral ligament : intact\n\n" +
    "3. Carpal alignment\nNormal\n\n" +
    "4. Bone and cartilage\nNo fracture. No bone marrow edema.\n\n" +
    "5. Tendons\n- Flexor tendons : intact\n- Extensor tendons : intact\n- Extensor carpi ulnaris : intact\n\n" +
    "6. Miscellaneous soft tissues\nUnremarkable.\n\n" +
    "[ Conclusion ]\nNo significant abnormality.",
  "MR::Elbow":
    "[ Finding ]\n" +
    "1. Ligaments\nUlnar collateral ligament (UCL) : intact, no tear\nLateral collateral ligament complex : intact, no tear\n\n" +
    "2. Tendons\nCommon flexor tendon origin : intact.\nCommon extensor tendon origin : intact.\nTriceps tendon : intact\n\n" +
    "3. Bone & cartilage\nNo fracture. No bone marrow edema. No chondral defect.\n\n" +
    "4. Nerve : Intact.\n\n5. Others\n\n" +
    "[ Conclusion ]\nNo significant abnormality.",
  "MR::Hand":
    "[ Finding ]\n" +
    "1. Bone and cartilage\nNo fracture. No bone marrow edema.\n\n" +
    "2. Tendons : Intact\n\n" +
    "3. Ligaments\nCollateral ligaments of MCP and IP joints : intact\n\n" +
    "4. Soft tissue\n\n" +
    "[ Conclusion ]\nNo significant abnormality.",
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
    getParts(modality) {
      const all = readJson(KEYS.templateParts, {});
      if (!all[modality]) {
        all[modality] = [...(STARTER_TEMPLATE_PARTS[modality] || [])];
        writeJson(KEYS.templateParts, all);
      }
      return all[modality];
    },
    addPart(modality, part) {
      const all = readJson(KEYS.templateParts, {});
      if (!all[modality]) all[modality] = [...(STARTER_TEMPLATE_PARTS[modality] || [])];
      if (!all[modality].includes(part)) all[modality].push(part);
      writeJson(KEYS.templateParts, all);
    },
    removePart(modality, part) {
      const all = readJson(KEYS.templateParts, {});
      if (all[modality]) {
        all[modality] = all[modality].filter((p) => p !== part);
        writeJson(KEYS.templateParts, all);
      }
      const texts = readJson(KEYS.templates, {});
      delete texts[`${modality}::${part}`];
      writeJson(KEYS.templates, texts);
    },
    get(modality, part) {
      const key = `${modality}::${part}`;
      const seededTexts = readJson(KEYS.templatesSeededDefaults, []);
      if (!seededTexts.includes(key)) {
        if (STARTER_TEMPLATE_TEXTS[key] !== undefined) {
          const all = readJson(KEYS.templates, {});
          if (all[key] === undefined) {
            all[key] = STARTER_TEMPLATE_TEXTS[key];
            writeJson(KEYS.templates, all);
          }
        }
        writeJson(KEYS.templatesSeededDefaults, [...seededTexts, key]);
      }
      const all = readJson(KEYS.templates, {});
      return all[key] || "";
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
