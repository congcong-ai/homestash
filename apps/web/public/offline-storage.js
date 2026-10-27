const prefix = "homestash.offline.v1.";
const key = (name) => prefix + name;
const maximumAge = 12 * 60 * 60 * 1000;
function storage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
function changed() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("homestash:offline-changed"));
}
export function offlineEnabled() {
  return storage()?.getItem(key("enabled")) === "true";
}
export function pendingLogout() {
  return storage()?.getItem(key("logout")) === "true";
}
export function offlineSessionVersion() {
  return storage()?.getItem(key("session")) ?? "initial";
}
export function clearOffline() {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key("snapshot"));
    s.removeItem(key("enabled"));
    s.setItem(key("session"), `${Date.now()}-${Math.random()}`);
  } catch {
    /* 浏览器禁用存储时仍允许退出 */
  }
  changed();
}
export function enableOffline() {
  storage()?.setItem(key("enabled"), "true");
  changed();
}
export function beginLogout() {
  try {
    storage()?.setItem(key("logout"), "true");
  } catch {
    /* 无可用存储 */
  }
  clearOffline();
}
export function completeLogout() {
  try {
    storage()?.removeItem(key("logout"));
  } catch {
    /* 无可用存储 */
  }
  changed();
}
let logoutTask = null;
export function flushLogout(force = false) {
  if (logoutTask) return logoutTask;
  if (!force && !pendingLogout()) return Promise.resolve();
  logoutTask = (async () => {
    const r = await fetch("/api/auth/logout", {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok && r.status !== 401) throw Error("请连接Core完成退出后再登录");
    completeLogout();
  })().finally(() => {
    logoutTask = null;
  });
  return logoutTask;
}
const text = (v, size = 300) => typeof v === "string" && v.length <= size;
export function validSnapshot(v, now = Date.now()) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v?.timeZone });
  } catch {
    return false;
  }
  return (
    !!v &&
    v.version === 1 &&
    text(v.scope, 100) &&
    text(v.timeZone, 100) &&
    text(v.date, 10) &&
    Number.isFinite(v.savedAt) &&
    Number.isFinite(v.expiresAt) &&
    v.savedAt <= now + 60000 &&
    v.savedAt <= v.expiresAt &&
    v.expiresAt > now &&
    v.expiresAt - v.savedAt <= maximumAge + 60000 &&
    Array.isArray(v.items) &&
    v.items.length <= 10000 &&
    v.items.every(
      (i) =>
        text(i.name, 80) &&
        text(i.category, 40) &&
        Number.isFinite(i.quantity) &&
        i.quantity >= 0 &&
        text(i.unit, 20) &&
        text(i.location, 100) &&
        text(i.status, 100) &&
        (i.deadline === null || text(i.deadline, 10)),
    ) &&
    Array.isArray(v.shopping) &&
    v.shopping.length <= 5000 &&
    v.shopping.every(
      (i) =>
        text(i.name, 80) &&
        Number.isFinite(i.quantity) &&
        i.quantity >= 0 &&
        text(i.unit, 20) &&
        typeof i.checked === "boolean",
    ) &&
    Array.isArray(v.recipes) &&
    v.recipes.length <= 100 &&
    v.recipes.every(
      (r) =>
        text(r.name, 80) &&
        Array.isArray(r.steps) &&
        r.steps.length <= 100 &&
        r.steps.every((s) => text(s, 1000)),
    ) &&
    (v.cooking === null ||
      (text(v.cooking.name, 80) && text(v.cooking.step, 1000)))
  );
}
export function saveSnapshot(value) {
  const s = storage();
  if (!s || !offlineEnabled() || pendingLogout() || !validSnapshot(value))
    return false;
  try {
    const raw = JSON.stringify(value);
    if (raw.length > 2000000) return false;
    s.setItem(key("snapshot"), raw);
    changed();
    return true;
  } catch {
    return false;
  }
}
export function readSnapshot(now = Date.now()) {
  if (!offlineEnabled() || pendingLogout()) return null;
  const s = storage();
  const raw = s?.getItem(key("snapshot"));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (raw.length <= 2000000 && validSnapshot(v, now)) return v;
  } catch {
    /* 损坏副本不显示 */
  }
  try {
    s.removeItem(key("snapshot"));
  } catch {
    /* 无可用存储 */
  }
  changed();
  return null;
}
