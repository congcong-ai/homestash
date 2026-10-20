export const githubUrl = "https://github.com/congcong-ai/homestash";
export const faqs = [
  {
    question: "HomeStash 是什么？",
    answer:
      "HomeStash 是采用 MIT 协议的开源、本地优先家庭物品管理平台。FreshMate 智能冰箱贴是它的第一个应用，帮你记库存、看临期、想晚餐。",
  },
  {
    question: "家里的数据会上传吗？",
    answer:
      "库存和操作记录保存在运行服务的本机 SQLite 数据库，不向 HomeStash 官方云同步。默认 Mock 模式不调用外部 AI。主动配置第三方 AI 时，输入文字会发给所选服务；启用云端语音时，音频和播报文本也会发给相应服务。",
  },
  {
    question: "没有智能冰箱贴，也能用吗？",
    answer:
      "可以。先在电脑上启动 HomeStash，通过浏览器管理物品、查看日期提醒、获取本地食谱建议，无需购买硬件。硬件选型与接入说明后续补充。",
  },
  {
    question: "只能管理冰箱里的东西吗？",
    answer:
      "不止。现有模型支持食品、药品、保健品、宠物食品、日用品、护肤品和其他物品，可以记录数量、位置、开封日期和操作历史。药品仅作库存管理，不提供用药建议。",
  },
  {
    question: "能免费使用、修改和商用吗？",
    answer:
      "可以。HomeStash 自有代码采用 MIT 协议，允许使用、修改、分发和商用，需保留版权与许可声明。第三方代码和字体遵循各自许可证。外部 AI 服务可能另外收费。",
  },
];
