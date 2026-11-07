# 第二台 Mac／第二块 T5 的 IMU 隔离实验

2026-11-07。29、30 已有其他用途，本记录使用 31，不修改原失败历史。

## 当前阶段

远端 IP 尚未提供，未建立连接、未验证 SSH、未操作第二块板。本机主板串口、SDK、产品配置和固件均未占用或修改。仅准备最小源码基线包与主机协议回归。尚无远端构建或真实识别证据。

## 基线与同步

执行 `python3 scripts/hardware/imu-lab/snapshot.py /tmp/imu-baseline-唯一标识.tar.gz`，生成白名单包；文件已存在时拒绝覆盖。包内 manifest.json 记录本机 base commit、当前工作树每个文件的 SHA256；两次读取不一致则拒绝打包。传输的是已经固定的归档，不继续同步活动工作树。

白名单仅含目标版本锁、现有 IMU 诊断、两个接口头、C 测试替身、两个实验脚本及本记录。无 .env、私有配置、产品运行时、Core、媒体、数据库、SDK、构建产物或 SSH 材料；不因 Git 跟踪而扩大清单。现有诊断包含历史人工 reset/raw 入口，仅供审阅与测试，不是远端自动执行入口，更不是可刷写最小工程。远端最小工程须另建，只接入身份读取；身份未通过前不暴露 reset/raw 命令。

远端目录使用 `~/code/homestash-imu-lab/<唯一快照标识>/`，新建且拒绝覆盖。核对归档整体 SHA256 后，以包内 snapshot.py 的 `--verify` 校验每个成员摘要；只解包已验证普通文件。再建立远端独立 Git 基线，所有实验修改相对该基线生成补丁。禁止镜像整个仓库、双向同步或 rsync --delete。

远端主机回归：`python3 scripts/hardware/imu-lab/verify-host.py`。只使用 cc 和临时目录，不依赖 pnpm，也不接设备。验证覆盖开漏不驱动高电平、ID 位序、NACK 拒绝与 GPIO 错误传播；不验证实际电气时序。

## 连接与硬件前置条件

收到用户指定 IP 后，只检查该目标的 SSH 可达性与本机现有别名/用户名。Tailscale 在线不等于 SSH 可用；确实缺账号或认证再一次询问一个问题，不输出私钥或凭据。当前不猜地址、不探测其他主机。

第二块板需单独确认型号、实际串口、Flash 容量；建立自己的原厂完整备份，核对读取长度、CRC/摘要后才可刷最小镜像。第一块板备份不能代用。不格式化 SD、不清历史 KV。构建只用 targets.json 锁定的 TuyaOpen/T5 工具链；远端核查架构、现有 SDK 与 Python，不自动升级、不用 Docker、ESP 工具或业务密钥。

断电后先确认第二块板 IMU 焊接可靠、无短路，P00=SCL、P01=SDA、CS=3.3V，SA0 决定 0x68/0x69；核对 V1.02 S1 TX1/RX1 隔离，UART0 用于日志/配置/刷写。GPIO13/15 是既有触摸总线。不恢复 shell_set_uart_port 日志迁移。原模块未焊排针、异常 ID 与断续采样的历史结论不能自动套在第二板，也不能忽略。

## 逐级验收与数据要求

1. 可靠连接后只读 WHO_AM_I(0x75)，在同一有效地址重复稳定得到 0x12；保留另一地址 NACK、异常 ID、传输失败和时间戳，不以两个地址全部应答为目标。不将 0x2e/0x1f/0x3f 白名单化。
2. 身份通过才设计配置与连续采样。记录采样序号、单调时间戳、地址、原始六轴数据、量程/滤波/采样配置、有效标记、丢帧/传输错误计数；失败值不得作为有效数据。分段对照静止、慢转、快转、真实开关门与轻碰。核对突发读取一致性，避免逐寄存器读取跨帧拼接。
3. 安装方向、零偏和门关闭基准实际标定后，验证慢开、快开、连开、快开快关、碰撞、静止噪声、重启。六轴原始数据不能直接声称绝对门角。算法阈值必须来自真实样本，不提前编造角度或准确率。
4. 事件来源为 imu，最终复用主线门事件状态机、冷却、监听与取消；按键兜底保留。回传仅 IMU 最小补丁、资源配置、测试与去敏证据，本机先落临时目录审核差异，不覆盖远端旧 app 或主线整文件。

第二板真实通过、本机补丁合并、本机主板实际验收分别记录。正常产品构建 HS_YARD_SENSOR_DIAGNOSTICS=0 保持；本机接线可靠且取得独占窗口之前不启用 IMU。当前唯一下一步是用户提供远端 Tailscale IP。

## 目标已提供：连接初查

用户提供目标 100.79.50.84。Tailscale 报告该目标为在线 macOS，主机名 MacBook Pro-Peter；TCP 22 返回 OpenSSH 服务响应。本机没有 ~/.ssh/config 可复用账号配置，默认本机用户名 susu 的 BatchMode SSH 登录被拒绝（publickey,password,keyboard-interactive），尚未登录远端或创建目录。下一步需确认远端 macOS 登录短用户名；不从主机显示名猜账号，不要求在聊天提供密码或私钥。此前快照仍是生成时的基线，后续传输前重新生成清单。

## SSH 已登录与远端初查

用户提供 peter 并完成公钥安装后，BatchMode SSH 登录成功。远端 Darwin x86_64，macOS 26.7.2，Python/git/Apple clang 可用；非交互 PATH 未找到 cmake/ninja/brew，尚需检查既有安装路径。当前发现 /dev/cu.usbmodem5AAE1651711 与 /dev/cu.usbmodem5AAE1651713，lsof 未发现占用；仅枚举，未打开串口。~/code 当前没有工程，未发现预期路径下 TuyaOpen。第二块板排针可靠性待用户确认，身份/采样/刷写均未执行。

## 第二板连接与环境实际进展

用户确认第二板 IMU 已焊牢，且断电核对 P00/P01、CS/VCC=3.3V、GND 与 S1 TX1/RX1 OFF、TX0/RX0 ON 全部一致。随后用户断电取出 SD 卡并重新供电；实验不需要 SD，备份存远端 Mac。

远端隔离目录 `/Users/peter/code/homestash-imu-lab/20261107-imu-02`；最小工作树快照 SHA256 `e8904bfe57c8124d865322290f999b07223eae8b07e2940c87de11314cb4bf0e`。传输后成员摘要与远端主机 C 回归均通过，独立分支 `codex/remote-imu-lab` 已建立。

远端 GitHub 443 连接失败，改从本机锁定的 SDK/platform 公开提交及四个子模块提交导出源码归档。仅取公开提交中源文件，未带本机 SDK 工作树修改、凭据或编译产物；六个包 SHA256 均在远端核对，明细见远端 `homestash-imu-sdk-transfer-20261107/manifest.json`。SDK 工具依赖 Git 仓库，因此远端 SDK/platform 各有独立“归档来源登记”提交；这些 HEAD **不是**上游原提交，不伪装相同。构建提示版本不同时选择不自动更新，实际源版本以原始公开提交与归档摘要为准。独立 Python 3.9 环境已按 SDK requirements 安装，cryptography 在允许的 >=42 范围内约束 44.0.3，避免新版本源码构建停滞。Intel 工具链 13.3.rel1 的原厂大小/摘要已核对并执行成功；最终安装路径为 sdk/platform/tools，不与本机 SDK 共用。

原厂 tyutool 源码提交 `6fd2a479564dc0270a0cc2b383c494eefa473037`，源码包 SHA256 `d042b9fbc2d92000919fe7a802258601d1eca368976fa3a701c8e8fd029f3db6`。远端枚举 USB Dual_Serial 序列号 5AAE165171；实测下载口 `/dev/cu.usbmodem5AAE1651711`，芯片 ID `0x72360101`，Flash ID `0x1765c8`、67108864 bit（8MB）。首个4KB通过原厂读取/CRC，SHA256 `08b0f938abf5eb70d886db6a97f5ec5ac039901a65527572a992e7a06d1c9b14`。只读探测退出0并关闭串口，没有擦写。原始日志在远端 `t5-readonly-probe-01.log`。

第二板完整双读备份正在远端独立执行，必须等 manifest.double_read_verified=true 才允许刷写。最小身份工程 imu-app 从现有开漏代码仅截取只读部分，没有 reset/raw 入口；UART0 手动发送 i 才读取身份，不启动 UI/业务/Wi-Fi，不访问 SD 或 KV。时间适配暂用毫秒时钟，源码50us等待实际跨至少1ms，不能宣称精确50us总线；后续时序优化需另行测量。当前尚未交叉编译完成、刷写或验证 IMU 身份/采样/门事件。

## 实测结果：双读备份、三版只读镜像与地址 NACK

第二板完整8MB读取两次一致：SHA256 `cec6d75f51c04589399cec59aa3eb3cc35dd4a80372839559f175d3192081396`、CRC32 `d2118bdd`。完整备份保留远端 `second-board-factory-backup/`，未回传含历史设备内容的二进制。三版最小镜像均写入后逐字节回读一致，未格式化SD、未清KV、未覆盖用户配置分区；没有接触本机主板。

初版重启指令后UART0日志为空，用户短按RESET后诊断恢复，不能把回读一致单独当启动成功。后两版在协议重启后追加原厂硬件RESET线动作，均实际收到UART0探测日志，无需再请用户重复按键。

加入ACK阶段日志，主机回归实际编译执行通过：开漏不主动驱动高、0x12位序、地址/指针/读取地址三个阶段NACK拒绝、GPIO错误传播。加入时间戳，确认失败均在 address-write，error=nack，不是读到有效WHO=0x00（传输失败时0x00只是初始化值）。用户确认SA0接GND，因此预期有效地址为0x68。

对照时序：初版/ACK版采用毫秒时钟；最终版通过锁定SDK原生 bk_aon_rtc_get_us 获得约正负30us精度的RTC时间，避免将毫秒等待说成50us。该内部API的函数签名经 ap/include/driver/aon_rtc.h 与实现核对；因头文件引入原生sdkconfig依赖，实验适配器使用相同签名声明，不改SDK或主线运行时。最终版交叉编译成功、写入/逐字节回读通过、启动/命令输出实际通过；镜像 SHA256 `0993e5e007839143bc7168193638e788f0a607f54d0b16777e66a741b960206d`。

最终两轮20个样本，0x68/0x69均 address-write NACK，空闲SCL/SDA均为1，io_ok=1；没有有效身份，没有运动采样，没有门事件。不能断言模块损坏，也不能认为物理波形已经测量通过。停止盲刷；下一步测模块VCC-GND实际电压，再根据结果查连接导通。用户已确认有万用表，电压读数待提供。

可审查补丁与去敏结果在本记录同目录 `evidence/remote-imu/`：remote-imu-lab-identity.patch、identity-result.json、flash-identity-rtc.log。补丁在本机 git apply --check 通过，保留在证据目录，没有应用到主线；补丁是独立实验工程，不是已通过的产品IMU驱动。串口与所有刷写/备份进程已结束，lsof复核远端两串口无占用。正常主线诊断默认关闭保持不变，本机合并和本机真机验收均未完成。

## 无万用表时继续：信号线与微秒延时对照

用户暂时找不到万用表并要求继续；用户另确认模块自身电源灯亮着。灯亮只作为观察记录，不认定芯片端电压正常。

重新核对锁定SDK：GPIO0/1映射不变；原厂软件I2C使用推挽高电平，ACK低电平轮询在SCL升高之前，不能作为独立开漏方案的可靠替身。没有套用原厂实现或改SDK。使用经源码签名/实现核对的 bk_delay_us，按5/50/500us参数做对照；参数不等于已实测总线频率。增加ACK前与SCL高电平时的SDA取值。拉低前先用 tkl_gpio_write 预置输出锁存为0，避免GPIO方向切换时出现主动高电平瞬态。

增加两根线互相影响检查：分别拉低一根，读取另一根已释放输入的电平，最后释放两根；只产生无数据的START/STOP，不写设备工作寄存器。它只能发现可见的互相拉低，不能证明模块端每根线连通或供电正常。主机新增对应通过/互相拉低拒绝测试，全部实际编译执行通过。

专用对照固件交叉编译、刷写、逐字节回读及启动/命令输出均通过，SHA256 `06192a1c1c066d25a839413caa770bbba4238acff26d39f27a6f844123e2fbc1`。两轮信号线检查均 check_ok=1；三组等待参数各20次，共60个样本，0x68/0x69均在 address-write 阶段 NACK，ack_pre=1、ack_high=1，没有有效芯片身份。不推断模块损坏，不启用采样或门事件；不将GPIO读数当示波器波形。

最新结果在 evidence/remote-imu/identity-suite-result.json、flash-identity-suite.log，源码补丁 remote-imu-lab-identity.patch 已刷新。回传补丁已在本机独立临时基线实际应用、cc编译并运行通过，未应用到产品主线。远端串口已关闭、构建/刷写均结束；下一步无需万用表的具体动作是断电后重新插紧SCL/SDA信号线两端、保持原针脚，再上电直接重新发诊断指令，无需再次刷固件。此前三版镜像与失败记录保留。

## 信号线重插后复测

用户确认已按上一轮指导断电、重插SCL/SDA并重新供电。原串口重新枚举存在且无占用，未刷写，直接发两轮 d。信号线检查两轮均 check_ok=1；5/50/500us参数各20次，共60个样本，0x68/0x69各30次，全部 address-write NACK、verified=0，与重插前一致。串口采集完成后关闭，lsof复核无占用。

证据在 evidence/remote-imu/retest-reseat-result.json、retest-after-reseat-result.log；远端原始日志目录 retest-reseat-20261107-122746。不宣称芯片损坏，不启用采样。下一步核对实物接线照片中的模块引脚文字、面包板插孔、T5 P00/P01及S1实际位置；暂缺万用表不能用LED亮替代电压和导通测量。

## 用户确认接错线并调整：通信读通，身份仍为0x2e

用户发现此前插错线并重新调整，具体哪根线错误尚未说明。本次直接在原最小镜像发两轮 d，未刷写。60个样本中：0x68在5/50/500us各组共30次 transfer_ok=1、phase=complete、WHO_AM_I=0x2e；0x69共30次地址NACK。连接调整后已由“两个地址均NACK”变为“0x68稳定应答”，但未得到0x12，仍不启用采样或门事件。

重新查看TDK官方 DS-000176 v1.1：WHO_AM_I(0x75)只读默认值0x12，CONFIG默认0x80、PWR_MGMT_1默认0x41；其I2C时序表给出的频率范围为100–400kHz。先前软件延时对照没有示波器频率证据，也不能当作符合该范围的证明。来源：https://product.tdk.com/system/files/dam/doc/product/sensor/mortion-inertial/imu/data_sheet/ds-000176-icm-20602-v1.1.pdf 。不将0x2e加为已支持身份。

锁定SDK原生bk7258_ap/hal/i2c_ll.h确认硬件I2C1固定P00/P01；原生硬件驱动已启用CONFIG_I2C与双实例支持。准备独立native-i2c.c，用硬件I2C1配置100kHz与400kHz，仅读取0x75及白名单0x1a/0x6b/0x6c/0x70，不访问未列明、FIFO或读清除寄存器，不写工作模式。原生bk_i2c_memory_read忽略内部信号量超时返回，因此保留数据哨兵0xa5、返回码和耗时，绝不单凭result=0判成功。主机已实测固定I2C1/地址与寄存器白名单、错误ID拒绝、数据未更新拒绝及初始化失败停止，全部通过；交叉构建正在完成原厂打包。

## 重要纠正：原生硬件I2C对照无效，已停止并恢复

上一节根据公共头文件与未实际链接的i2c_driver.c判断“可用硬件I2C1”不充分。实际实验40次WHO与16次配置寄存器读取均result=0但哨兵0xa5未更新，不能作为任何寄存器内容。检查最终AP ELF反汇编才确认：bk_i2c_memory_read调用I2cMemRead并直接返回0；最终绑定的是sim_i2c_driver.c，而不是核查的硬件i2c_driver.c。

实际替身固定GPIO13/15，忽略id与速率配置，bk_i2c_init会重配该总线，deinit会拉低两根线。这违反本实验只操作P00/P01的目标，因此本轮不能作为100/400kHz或IMU硬件I2C证据，不据此推断传感器异常。本次漏查最终链接实现是实验准备失误；后续硬件适配必须同时核查最终链接符号与源文件选择。没有操作本机主板，但确实触及第二板GPIO13/15，不能写成“所有实验都只访问P00/P01”。

已停止该路径并从可构建app移除h入口与native-i2c.c，错误实验代码移至远端invalid-native-i2c-experiment隔离留证。正在恢复已验证的P00/P01专用镜像（从此前逐字节回读中还原1844416字节QIO，SHA256 06192a1c1c066d25a839413caa770bbba4238acff26d39f27a6f844123e2fbc1），恢复后硬件RESET并复测。第二板自身完整双读备份仍可用。实际有效结论仍是用户调整错误接线后，P00/P01开漏方案稳定读到0x68/WHO=0x2e，身份尚未通过。未新增或修改任何器件工作配置，也未将0x2e接受为ICM-20602身份。

## 关闭替身后的真实硬件驱动对照

进一步定位AP平台项目配置原有CONFIG_SIM_I2C=y；middleware/driver/CMakeLists.txt在此配置下选择sim_i2c_driver.c/v2，而不是i2c_driver.c。仅在远端隔离SDK将该配置改为未启用，形成native-hardware-config.patch，不改本机SDK、不升级版本。GPIO_DEFAULT_SET_SUPPORT保持不变；实验程序显式仅unmap/map GPIO0/I2C1_SCL和GPIO1/I2C1_SDA，并配置其上拉，不改GPIO13/15。

实验源码添加编译期CONFIG_SIM_I2C保护。首次构建被该保护正确拦截，因为旧原生头尚未重生成；通过从不刷写的独立sdk-hardware-bootstrap先生成新底层配置，再重建实验程序。不得把该引导空应用刷入设备。

受保护实验构建成功后，已进一步实际核查最终AP编译数据库和ELF：i2c_driver.c编入，sim_i2c_driver未编入；bk_i2c_memory_read函数156字节，含rtos_get_semaphore调用，不含I2cMemRead，与此前10字节的替身封装不同。证明文件real-hardware-i2c-link.json/.txt；ELF SHA256 ffc73ca6f6c653c659894dec1825df21e772005b765a1f2a4e7f6ebe9acb8a37，SDK资源配置补丁SHA256 491be1f36999f9561ab07e8c7a14705ae9b36cd2839ae702efb81d61a1dfb0de。

这才是实际进入硬件对照的候选镜像，QIO SHA256 0311be7025754a3c74e1cfd41a2611e13b3b5ffda0490c49b187f738383010e4。刷前仍核对第二板自身双读备份、芯片/Flash与写入边界。当前写入/回读与采集在执行，身份结果待记录。该SDK资源配置仅用于隔离实验，不自动套到本机产品；最终仍需主线审核和本机硬件窗口验证。

## 本轮最终实测与交付边界

真实硬件I2C两轮采集完成：100/400kHz配置下，0x68共20次均result=0、changed=1、WHO_AM_I=0x2e、verified=0；0x69共20次返回-11524且哨兵未改，未计为有效读数。配置寄存器共16次有效读取，均为CONFIG(0x1a)=0x80、PWR_MGMT_1(0x6b)=0x41、PWR_MGMT_2(0x6c)=0、I2C_IF(0x70)=0。只有默认配置相符不能替代WHO身份验证；未唤醒、未复位、未采样、未发门事件。

软件开漏与最终链接核查过的真实硬件路径均返回0x2e，暂不能认定ICM-20602身份通过，也不能仅凭此断言损坏/假货。下一步核对当前芯片本体丝印与模块实际型号，必要时让供应商确认异常ID；不能把0x2e加入支持白名单来推进产品。

最终第二板为只读诊断镜像0311be70…，手动i/d/h命令才探测，不运行UI或业务网络。SDK仅远端隔离副本的AP配置SIM_I2C关闭；本机SDK与主板未修改。远端所有构建、刷写、采集结束且两串口无占用。第二板真实身份、连续采样、门判定、本机合并、本机主板实测仍分别为未通过/未执行。

证据已回传evidence/remote-imu/：real-hardware-i2c-result.json、flash-real-hardware-i2c.log、real-hardware-i2c-link.json/.txt、native-hardware-config.patch；无效实验的flash-native-i2c.log及恢复日志单独保留，不作为硬件验证通过证据。wiring-fixed-result.json与对应日志记录用户修正接错线后的变化。源码补丁remote-imu-lab-identity.patch已刷新，包括独立诊断工程、白名单主机测试和SDK资源补丁；包内SDK补丁为零上下文形式，需git apply --unidiff-zero，实验根原始资源补丁保留上下文。

本机已用新的临时基线实际应用回传源码补丁、编译执行开漏/阶段诊断和原生适配两套C回归，并对原锁定SDK配置实际应用资源补丁，全部通过。未应用到本机产品或本机SDK，没有git add/commit/push主线改动。这些测试只证明软件与补丁可用，不把真实0x2e身份失败改写为通过。
