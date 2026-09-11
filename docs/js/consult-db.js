// Conversation storage for the AI 문의 (consult) tab, backed by IndexedDB instead of
// localStorage -- attached images as base64 data URLs can easily blow past localStorage's
// ~5-10MB per-origin cap, and IndexedDB has no such practical limit.
//
// Each record is one provider's copy of a conversation. Records sharing the same `patientId`
// are the "same patient" across GPT/Gemini/Claude tabs, so [Send to X] can find or create the
// matching thread on the other tab.

const DB_NAME = "sh-rad-consult";
const DB_VERSION = 1;
const STORE = "conversations";

let dbPromise = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("provider", "provider", { unique: false });
        store.createIndex("patientId", "patientId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function newConversationId() {
  return uid();
}

export function newPatientId() {
  return uid();
}

export async function listConversations(provider) {
  const db = await getDb();
  const tx = db.transaction(STORE, "readonly");
  const all = await reqToPromise(tx.objectStore(STORE).index("provider").getAll(provider));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(id) {
  if (!id) return null;
  const db = await getDb();
  const tx = db.transaction(STORE, "readonly");
  return reqToPromise(tx.objectStore(STORE).get(id));
}

export async function getConversationByPatient(patientId, provider) {
  const db = await getDb();
  const tx = db.transaction(STORE, "readonly");
  const all = await reqToPromise(tx.objectStore(STORE).index("patientId").getAll(patientId));
  return all.find((c) => c.provider === provider) || null;
}

export async function saveConversation(conv) {
  const db = await getDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(conv);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(conv);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteConversation(id) {
  const db = await getDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
