# T5 原生平台引导工程

T5 的 FatFs 公共头需要原厂 OS 生成的配置及 FreeRTOS 定义。首次产品构建时，`build-tuya.mjs` 会在缺少原生配置的情况下先编译本工程，随后从原厂 `compile_commands.json` 读取 FatFs 的真实头文件目录。产品代码不复制或伪造 SDK 的类型定义。

本工程只用于 SDK 准备，不实现 HomeStash 产品流程，也不会自动烧录。产品入口见 `firmware/boards/tuya-t5-ai`。
