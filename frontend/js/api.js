const API_BASE = "";

async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listTemplates: () => apiRequest("/api/templates"),
  listTemplatesByRegion: (modality, bodyRegion) =>
    apiRequest(`/api/templates/by-region?modality=${encodeURIComponent(modality)}&body_region=${encodeURIComponent(bodyRegion)}`),
  getTemplateHistory: (groupId) => apiRequest(`/api/templates/history?group_id=${groupId}`),
  saveTemplate: (payload) =>
    apiRequest("/api/templates", { method: "POST", body: JSON.stringify(payload) }),
  deactivateTemplate: (groupId) => apiRequest(`/api/templates/${groupId}`, { method: "DELETE" }),

  listReports: () => apiRequest("/api/reports"),
  getReport: (id) => apiRequest(`/api/reports/${id}`),
  createReport: (payload) => apiRequest("/api/reports", { method: "POST", body: JSON.stringify(payload) }),
  updateReport: (id, payload) => apiRequest(`/api/reports/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteReport: (id) => apiRequest(`/api/reports/${id}`, { method: "DELETE" }),

  correctGrammar: (text, previousReport = "", mode = "local") =>
    apiRequest("/api/text/correct", {
      method: "POST",
      body: JSON.stringify({ text, previous_report: previousReport, mode }),
    }),
  generateConclusion: (findingsText, modality, bodyRegion, previousReport = "") =>
    apiRequest("/api/text/conclusion", {
      method: "POST",
      body: JSON.stringify({
        findings_text: findingsText,
        modality,
        body_region: bodyRegion,
        previous_report: previousReport,
      }),
    }),
  getCheckpoints: (patientContext, modality, bodyRegion, findingsText, images = []) =>
    apiRequest("/api/text/checkpoints", {
      method: "POST",
      body: JSON.stringify({
        patient_context: patientContext,
        modality,
        body_region: bodyRegion,
        findings_text: findingsText,
        images,
      }),
    }),

  analyzeClinicalContext: (patientContext, modality, bodyRegion) =>
    apiRequest("/api/text/clinical-context", {
      method: "POST",
      body: JSON.stringify({
        patient_context: patientContext,
        modality,
        body_region: bodyRegion,
      }),
    }),

  askAI: (question, modality, bodyRegion, findingsText) =>
    apiRequest("/api/text/ask", {
      method: "POST",
      body: JSON.stringify({
        question,
        modality,
        body_region: bodyRegion,
        findings_text: findingsText,
      }),
    }),

  syncNow: () => apiRequest("/api/sync/run", { method: "POST" }),

  listRules: () => apiRequest("/api/rules"),
  createRule: (payload) => apiRequest("/api/rules", { method: "POST", body: JSON.stringify(payload) }),
  updateRule: (id, payload) => apiRequest(`/api/rules/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteRule: (id) => apiRequest(`/api/rules/${id}`, { method: "DELETE" }),
};

export const MODALITY_REGIONS = {
  MRI: [
    "Brain",
    "Neck",
    "Abdomen",
    "C-spine",
    "T-spine",
    "L-spine",
    "TL-spine",
    "Shoulder",
    "Elbow",
    "Wrist",
    "Hand",
    "Hip",
    "Knee",
    "Ankle",
    "Foot",
  ],
  US: ["Thyroid", "Carotid doppler", "LGP", "Extremity doppler", "KUB", "Echocardiography"],
  "X-ray": ["Chest", "Abdomen", "Skull", "Spine", "Rib", "Extremity", "Knee", "Mammography"],
  CT: ["Brain", "Chest", "Abdomen", "Spine", "Rib", "Extremity", "Shoulder"],
};

export const MODALITIES = Object.keys(MODALITY_REGIONS);

export function getRegionsForModality(modality, includeAll = false) {
  const regions = MODALITY_REGIONS[modality] || [];
  return includeAll ? ["All", ...regions] : regions;
}
