// macOS 真机 BLE 验收：扫描指定服务，读取初值，写入随机测试串并读回。
import Foundation
import CoreBluetooth

final class Probe: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var central: CBCentralManager!
    var peripheral: CBPeripheral?
    let service = CBUUID(string: "FFF0")
    let uuid = CBUUID(string: "FFF1")
    let payload = Data("Korvo-test-\(UUID().uuidString.prefix(8))".utf8)
    var step = 0
    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: nil)
    }
    func fail(_ text: String) { print("失败：\(text)"); exit(1) }
    func centralManagerDidUpdateState(_ manager: CBCentralManager) {
        print("Mac 蓝牙状态=\(manager.state.rawValue)，授权=\(CBCentralManager.authorization.rawValue)")
        if manager.state == .poweredOn { manager.scanForPeripherals(withServices: [service]) }
        if manager.state == .unauthorized || manager.state == .unsupported { fail("Mac 无法使用蓝牙") }
    }
    func centralManager(_ manager: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard p.name == "HomeStash-Probe" || advertisementData[CBAdvertisementDataLocalNameKey] as? String == "HomeStash-Probe" else { return }
        print("扫描到目标：\(p.name ?? "HomeStash-Probe") RSSI=\(RSSI)")
        manager.stopScan(); peripheral = p; p.delegate = self; manager.connect(p)
    }
    func centralManager(_ manager: CBCentralManager, didConnect p: CBPeripheral) {
        print("连接成功"); p.discoverServices([service])
    }
    func centralManager(_ manager: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) { fail("连接失败 \(String(describing: error))") }
    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil, let s = p.services?.first(where: {$0.uuid == service}) else { fail("服务发现失败"); return }
        p.discoverCharacteristics([uuid], for: s)
    }
    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        guard error == nil, let c = s.characteristics?.first(where: {$0.uuid == uuid}) else { fail("特征发现失败"); return }
        print("服务和读写特征发现成功"); p.readValue(for: c)
    }
    func peripheral(_ p: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        guard error == nil, let value = c.value else { fail("读取失败"); return }
        if step == 0 {
            guard value == Data("Korvo-ready".utf8) else { fail("初值不符"); return }
            print("初值读取通过"); step = 1; p.writeValue(payload, for: c, type: .withResponse)
        } else {
            guard value == payload else { fail("写入读回不一致"); return }
            print("通过：BLE 扫描、连接、GATT 读取、写入和随机数据读回均成功，共 \(value.count) 字节")
            central.cancelPeripheralConnection(p); exit(0)
        }
    }
    func peripheral(_ p: CBPeripheral, didWriteValueFor c: CBCharacteristic, error: Error?) {
        guard error == nil else { fail("写入失败"); return }
        print("写入收到确认"); p.readValue(for: c)
    }
}
let probe = Probe()
DispatchQueue.main.asyncAfter(deadline: .now() + 55) { probe.fail("55 秒超时") }
RunLoop.main.run()
