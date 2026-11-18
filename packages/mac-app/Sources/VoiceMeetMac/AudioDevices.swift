import CoreAudio
import Foundation

/// Reads the names of the system's default audio devices, for the log only. Apple voice processing
/// joins the input and the output device, so a failure often depends on the pair (a headset's
/// microphone with the Mac's speakers, a surround output). Reading a device's properties opens no
/// device and captures nothing.
enum AudioDevices {
    enum Direction {
        case input
        case output
    }

    static func describeDefault(_ direction: Direction) -> String {
        let selector =
            direction == .input ? kAudioHardwarePropertyDefaultInputDevice : kAudioHardwarePropertyDefaultOutputDevice
        var deviceID = AudioDeviceID(kAudioObjectUnknown)
        guard read(AudioObjectID(kAudioObjectSystemObject), selector, into: &deviceID), deviceID != kAudioObjectUnknown
        else { return "none" }

        var sampleRate = Float64(0)
        _ = read(deviceID, kAudioDevicePropertyNominalSampleRate, into: &sampleRate)
        var transport = UInt32(0)
        _ = read(deviceID, kAudioDevicePropertyTransportType, into: &transport)
        return "\"\(name(of: deviceID))\" (id \(deviceID), \(transportLabel(transport)), \(Int(sampleRate)) Hz)"
    }

    private static func name(of deviceID: AudioDeviceID) -> String {
        let pointer = UnsafeMutablePointer<Unmanaged<CFString>?>.allocate(capacity: 1)
        pointer.initialize(to: nil)
        defer { pointer.deallocate() }
        var address = address(kAudioObjectPropertyName)
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, pointer) == noErr,
            let name = pointer.pointee
        else { return "unnamed" }
        return name.takeRetainedValue() as String
    }

    private static func read<Value>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, into value: inout Value) -> Bool {
        var address = address(selector)
        var size = UInt32(MemoryLayout<Value>.size)
        return withUnsafeMutablePointer(to: &value) { pointer in
            AudioObjectGetPropertyData(object, &address, 0, nil, &size, pointer) == noErr
        }
    }

    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
    }

    private static func transportLabel(_ transport: UInt32) -> String {
        switch transport {
        case kAudioDeviceTransportTypeBuiltIn: return "built in"
        case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return "Bluetooth"
        case kAudioDeviceTransportTypeUSB: return "USB"
        case kAudioDeviceTransportTypeAggregate: return "aggregate"
        case kAudioDeviceTransportTypeVirtual: return "virtual"
        case kAudioDeviceTransportTypeHDMI, kAudioDeviceTransportTypeDisplayPort: return "display"
        case kAudioDeviceTransportTypeAirPlay: return "AirPlay"
        case kAudioDeviceTransportTypeContinuityCaptureWired, kAudioDeviceTransportTypeContinuityCaptureWireless:
            return "Continuity"
        default: return "transport \(transport)"
        }
    }
}
