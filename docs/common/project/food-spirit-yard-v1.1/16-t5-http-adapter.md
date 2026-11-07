# T5独立Wi-Fi的HTTP适配

2026-11-06。用户确认连接XM的手机能够打开电脑LAN网页，继续排查设备HTTP。

## 代码依据

锁定SDK的tcp_transporter.c在连接前调用netmgr_conn_get(NETCONN_AUTO, NETCONN_CMD_IP,...)，未检查返回值就将nw_ip.ip转为绑定地址。当前产品使用tal_wifi独立管理Wi-Fi，未初始化netmgr；netmgr_conn_get因此返回OPRT_RESOURCE_NOT_READY。T5 tkl_net_str2addr对空字符串使用inet_addr，结果为0xffffffff，导致后续错误绑定。该链路与设备result=2/http=0且服务端未收到TCP的现象吻合，真机结果仍需验证。

## 实施

新增platforms/tuyaopen/hs_http.c，HTTP直接使用TAL socket建立连接，不读取netmgr绑定地址；非阻塞connect与select设置等待期限，复用锁定SDK coreHTTP序列化和解析，保留鉴权头和响应处理，不打印头部或正文。HTTPS保留原SDK证书验证路径，本轮未进行HTTPS验收。

CMake仅加入项目适配与锁定SDK头文件路径，未修改SDK或历史数据。没有重新初始化Wi-Fi管理器、清除凭据、绕过鉴权或模拟心跳。

## 验证

实际T5交叉编译通过。已完成刷前备份、写入与逐字节回读。14项固件/会话/网络启动回归通过。

QIO SHA256：ff0f11fd460d39f71e20918ad994fc404b6cbf371965a1760ed7b8b86a6a3ca9。归档food-spirit-yard-1.1.0-http-direct。

## 真机结果

修复镜像重启后自动连接XM，设备IP192.168.66.8。后台首次收到真实T5心跳，online=true，硬件上报T5AI/V1.02、Wi-Fi、屏幕、录音播放及持久存储能力。随后UART0 screen 0实际请求result=0、http=200。没有发送主机模拟心跳。Core HTTP主链通过，空地址绑定缺口已由实际修复结果验证。证据见evidence/rehearsal/core-connection-acceptance.json，用户点击服务图标并重新检查后明确回复“已连接”，屏幕服务状态真机确认通过。

本次通过不涵盖ASR/TTS云服务、真实相机或IMU；HTTPS路径未实测。
