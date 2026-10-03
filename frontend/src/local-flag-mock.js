const STORAGE_KEY = "shorten-url:flagship-local-mock:v1";

function storage() {
  try {
    if (!globalThis.localStorage) throw new Error("Local storage is unavailable");
    return globalThis.localStorage;
  } catch {
    throw new Error("Browser storage is unavailable for the local Flagship mock.");
  }
}

function readFlag() {
  const serialized = storage().getItem(STORAGE_KEY);
  if (!serialized) return null;

  try {
    const flag = JSON.parse(serialized);
    return flag && typeof flag === "object" && !Array.isArray(flag) ? flag : null;
  } catch {
    throw new Error("The local Flagship mock data could not be read.");
  }
}

function writeFlag(flag) {
  try {
    storage().setItem(STORAGE_KEY, JSON.stringify(flag));
  } catch {
    throw new Error("The local Flagship mock could not be saved.");
  }
  return { flag };
}

export function loadLocalFlagMock() {
  return readFlag();
}

export function saveLocalFlagMock(definition) {
  return writeFlag({ ...definition, status: "draft", updatedAt: new Date().toISOString() });
}

export function publishLocalFlagMock(expectedUpdatedAt) {
  const current = readFlag();
  if (!current) throw new Error("Save a local mock draft before publishing.");
  if (current.updatedAt !== expectedUpdatedAt) {
    throw new Error("The local mock changed. Reload it before publishing.");
  }

  const timestamp = new Date().toISOString();
  return writeFlag({
    ...current,
    status: "published",
    updatedAt: timestamp,
    publishedAt: timestamp,
  });
}
