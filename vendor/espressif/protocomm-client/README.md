# 乐鑫 Security 1 Python 客户端复用

本目录保留来自已真机验证的 `network_provisioning` 1.3.1 工具的 Security 1 实现。`security/security1.py`、`security/security.py` 和 utils 文件原样复制，保留 Apache-2.0 标记；来源归档摘要及文件摘要见 `IMPORT_MANIFEST.json`。

`security/__init__.py`、`proto/__init__.py` 是 HomeStash 适配层，仅加载锁定 ESP-IDF 中生成的 protobuf，不实现或改写密码算法，不接管 Wi-Fi。

上游：https://github.com/espressif/idf-extra-components/tree/master/network_provisioning/tool/esp_prov 。共享SDK只读，版本与本项目固件审计一致。
