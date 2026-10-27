import {
  readSnapshot,
  clearOffline,
  beginLogout,
  flushLogout,
  pendingLogout,
} from "/offline-storage.js";
const byId = (id) => document.getElementById(id);
let tab = "items";
const element = (tag, value) => {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  return node;
};
const names = {
  fresh: "日期尚未临近",
  eat_soon: "建议尽快吃",
  urgent: "建议今天核对",
  expired: "日期已过，请核查",
};
function render() {
  const data = readSnapshot();
  const list = byId("items");
  list.replaceChildren();
  byId("tabs").hidden = !data;
  byId("search-label").hidden = !data || tab !== "items";
  if (!data) {
    byId("summary").textContent = pendingLogout()
      ? "已清除副本。重连后将先完成退出，再允许重新登录。"
      : "没有可用副本：尚未开启、已经过期或已被清除。请重连Core后重新同步。";
    return;
  }
  const format = (n) =>
    new Date(n).toLocaleString("zh-CN", { timeZone: data.timeZone });
  byId("summary").textContent =
    `最后同步：${format(data.savedAt)}；副本到期：${format(data.expiresAt)}。提醒以同步时家庭日期 ${data.date} 为准。`;
  if (tab === "items") {
    const search = byId("search").value.trim().toLowerCase();
    for (const item of data.items.filter(
      (i) =>
        i.quantity > 0 &&
        `${i.name} ${i.location}`.toLowerCase().includes(search),
    )) {
      const card = element("article");
      card.append(
        element("h2", `${item.name} ${item.quantity}${item.unit}`),
        element("p", item.location),
        element(
          "small",
          `${names[item.status] ?? "请核对日期"}${item.deadline ? " · " + item.deadline : " · 未记录提醒日期"}`,
        ),
      );
      list.append(card);
    }
  } else if (tab === "shopping") {
    for (const item of data.shopping.filter((i) => !i.checked)) {
      const card = element("article");
      card.append(
        element("h2", `${item.name} ${item.quantity}${item.unit}`),
        element("small", "同步时尚待核对；当前可能已有变化"),
      );
      list.append(card);
    }
  } else {
    if (data.cooking) {
      const card = element("article");
      card.append(
        element("h2", `做饭快照 · ${data.cooking.name}`),
        element("p", data.cooking.step),
        element("small", "离线不能推进步骤或确认消耗"),
      );
      list.append(card);
    }
    for (const recipe of data.recipes) {
      const card = element("article");
      const steps = element("ol");
      for (const step of recipe.steps) steps.append(element("li", step));
      card.append(
        element("h2", recipe.name),
        steps,
        element("small", "这是同步时的食谱，不代表当前库存可用"),
      );
      list.append(card);
    }
  }
  if (!list.childElementCount)
    list.append(element("p", "这份快照没有匹配记录。"));
}
document.querySelectorAll("[data-tab]").forEach((button) =>
  button.addEventListener("click", () => {
    tab = button.dataset.tab;
    render();
  }),
);
byId("search").addEventListener("input", render);
byId("forget").addEventListener("click", () => {
  clearOffline();
  render();
});
byId("logout").addEventListener("click", async () => {
  beginLogout();
  render();
  try {
    await flushLogout(true);
    byId("message").textContent = "已退出并清除副本。";
  } catch {
    byId("message").textContent = "本机副本已清除；Core恢复后会先完成退出。";
  }
});
window.addEventListener("storage", render);
window.addEventListener("homestash:offline-changed", render);
setInterval(render, 5000);
render();
