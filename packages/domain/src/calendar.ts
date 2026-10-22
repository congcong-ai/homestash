import { z } from "zod";
export const TimeZone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "请输入有效的IANA时区，例如Asia/Shanghai");
export const CalendarPreferences = z
  .object({ timeZone: TimeZone, revision: z.number().int().positive() })
  .strict();
export type HouseholdCalendar = {
  timeZone: string;
  revision: number;
  date: string;
};
export function calendarDate(timeZone = "UTC", instant = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    numberingSystem: "latn",
  }).formatToParts(instant);
  const value = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
