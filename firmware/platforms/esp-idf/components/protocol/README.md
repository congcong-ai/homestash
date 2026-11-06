# ESP-IDF HTTP 适配

负责设备鉴权、心跳、页面、录音/照片上传和播报下载。公共传输契约在 shared/components/device_port/include/hs_transport.h；ESP HTTP 句柄仅在本组件 hs_transport_esp.h 中暴露给平台内部使用。

目录与接入规则见仓库 `firmware/README.md`。
