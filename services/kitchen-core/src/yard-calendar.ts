import { CalendarPreferences, calendarDate } from "@homestash/domain";
import type { SQLiteRepository } from "@homestash/database";
import { Solar } from "lunar-typescript";
import { calendarKey } from "./calendar";

const publicDates: Record<string, string> = {
  "01-01": "元旦",
  "05-01": "劳动节",
  "10-01": "国庆节",
};
const westernDates: Record<string, string> = {
  "02-14": "情人节",
  "10-31": "万圣夜",
  "12-24": "平安夜",
  "12-25": "圣诞节",
};
const foodGreetings: Record<string, string> = {
  立冬: "今天立冬啦。有人吃饺子，也有人喝热汤。你家想吃点什么暖暖身？",
  冬至: "今天冬至啦。饺子和汤圆，你家更常吃哪一样？",
  春节: "新年好呀！你家过年最少不了哪道菜？",
  元宵节: "今天元宵节啦。你喜欢芝麻汤圆还是花生汤圆？",
  端午节: "今天端午节啦。你家的粽子爱吃咸口还是甜口？",
  中秋节: "今天中秋节啦。你最喜欢什么馅的月饼？",
  腊八节: "今天腊八节啦。要不要煮碗热乎乎的腊八粥？",
  除夕: "今天是除夕。你最期待年夜饭上的哪道菜？",
};

export function yardCalendar(repo: SQLiteRepository, now = new Date()) {
  const { timeZone } = CalendarPreferences.parse(
    repo.read(calendarKey, { timeZone: "Asia/Shanghai", revision: 1 }),
  );
  const date = calendarDate(timeZone, now);
  const [year, month, day] = date.split("-").map(Number);
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  const traditional = lunar.getFestivals();
  if (
    lunar.getMonth() === 12 &&
    lunar.getDay() === 8 &&
    !traditional.includes("腊八节")
  )
    traditional.push("腊八节");
  const term = lunar.getJieQi();
  const civil = publicDates[date.slice(5)];
  const western = westernDates[date.slice(5)];
  const events = [
    ...new Set([civil, ...traditional, term, western].filter(Boolean)),
  ];
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const event = events[0];
  return {
    date,
    timeZone,
    time,
    events,
    lunar: `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    greeting: event
      ? (foodGreetings[event] ?? `今天是${event}呀。想聊聊今天准备吃什么吗？`)
      : null,
    // 按家庭时区找下一个日期切换点，兼容夏令时。
    validForMs() {
      let low = now.getTime();
      let high = low + 36 * 3600 * 1000;
      while (high - low > 1000) {
        const mid = Math.floor((low + high) / 2);
        if (calendarDate(timeZone, new Date(mid)) === date) low = mid;
        else high = mid;
      }
      return low - now.getTime();
    },
  };
}
