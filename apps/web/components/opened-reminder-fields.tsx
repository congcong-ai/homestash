"use client";
import { useState } from "react";
import type { InventoryItem } from "@homestash/domain";
export function OpenedReminderFields({
  item,
}: {
  item?: InventoryItem | null;
}) {
  const [mode, setMode] = useState(
    item?.openedReminderDays === null
      ? "off"
      : typeof item?.openedReminderDays === "number"
        ? "custom"
        : "default",
  );
  return (
    <>
      <label>
        开封提醒规则
        <select
          name="openedReminderMode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="default">默认：食品2天，其余不启用</option>
          <option value="custom">按这批物品自定义天数</option>
          <option value="off">不启用开封提醒</option>
        </select>
      </label>
      <label>
        自定义开封后天数
        <input
          name="openedReminderDays"
          disabled={mode !== "custom"}
          required={mode === "custom"}
          type="number"
          min="0"
          max="3650"
          step="1"
          defaultValue={
            typeof item?.openedReminderDays === "number"
              ? item.openedReminderDays
              : 2
          }
        />
        <small>
          选择自定义后生效；0表示开封当天提醒。仅作提醒，请核对包装与实际保存情况。
        </small>
      </label>
    </>
  );
}
