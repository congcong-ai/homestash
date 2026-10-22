import {
  CalendarPreferences,
  calendarDate,
  DomainError,
  type HouseholdCalendar,
} from "@homestash/domain";
import type { SQLiteRepository } from "@homestash/database";
export const calendarKey = "household-calendar";
export function householdCalendar(
  repo: SQLiteRepository,
  now: () => Date = () => new Date(),
) {
  const current = (): HouseholdCalendar => {
    const preferences = CalendarPreferences.parse(
      repo.read(calendarKey, { timeZone: "UTC", revision: 1 }),
    );
    return { ...preferences, date: calendarDate(preferences.timeZone, now()) };
  };
  const change = (timeZone: string, expectedRevision: number) => {
    const old = current();
    if (old.revision !== expectedRevision)
      throw new DomainError("家庭时区已变化，请刷新后重新核对");
    const next = CalendarPreferences.parse({
      timeZone,
      revision: old.revision + (old.timeZone === timeZone ? 0 : 1),
    });
    repo.write(calendarKey, next);
    return current();
  };
  return { current, change };
}
