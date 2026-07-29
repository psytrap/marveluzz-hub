# Physical ESP32 Hardware Wiring & Pinout Reference

This document provides the hardware reference schematic, bill of materials, and pinout assignments for deploying physical microcontrollers (ESP32-WROOM-32) running firmware that pairs with Marveluzz Hub.

---

## 1. Bill of Materials (BOM)

| Component | Quantity | Purpose | Specs / Part Number |
| :--- | :---: | :--- | :--- |
| **ESP32 Dev Board** | 1 | Microcontroller Core (Wi-Fi + BLE) | ESP32-WROOM-32 (30-pin or 38-pin) |
| **DS18B20 Sensor** | 1 | 1-Wire Temperature Probe | Waterproof Probe or TO-92 Package (-55°C to +125°C) |
| **Pull-Up Resistor** | 1 | 1-Wire Data Line Bus Stabilizer | 4.7kΩ 1/4W Resistor (connected between VCC 3.3V and Data) |
| **5V Relay Module** | 1 | High-Voltage Load Relay (Fan Switch) | Optocoupler Isolated 5V 10A SRD-05VDC-SL-C |
| **Emergency Button** | 1 | Hardware Fault (`E-04`) Trigger | Momentary Push Button Switch (Active LOW) |
| **Status LED** | 1 | Visual State & Heartbeat Indicator | 3.3V Green LED with 220Ω Current Limiting Resistor |

---

## 2. Pinout Assignment Table

| ESP32 Pin | Function / Target | Signal Type | Electrical Specification |
| :--- | :--- | :--- | :--- |
| **3V3** | DS18B20 VCC / Pull-Up | Power Output | 3.3V DC Power Rail |
| **VIN / 5V** | Relay Module VCC | Power Input/Output | 5V DC (Coil Supply from USB / External Supply) |
| **GND** | System Common Ground | Ground Rail | Common GND for ESP32, DS18B20, Relay & Button |
| **GPIO 4** | DS18B20 Data Line | 1-Wire Bi-directional | Requires 4.7kΩ pull-up resistor to 3V3 rail |
| **GPIO 26** | Relay Module Signal (IN) | Digital Output | Active HIGH / LOW (Controls Desk Fan Relay Coil) |
| **GPIO 27** | Emergency Fault Button | Digital Input | Internal Pull-Up Enabled (Active LOW on Press) |
| **GPIO 2** | Network Status LED | Digital Output | Onboard Blue LED / External Indicator (Active HIGH) |

---

## 3. Hardware Circuit Diagram & Wiring Schematic

```
                                    +3.3V Rail
                                      |
                                      +-------+
                                      |       |
                                    [4.7kΩ]   |
                                      |       |
                                      v       v
 +-------------------+             (DATA)   (VCC)
 |                   |               |        |
 |   ESP32-WROOM-32  |      1-Wire   |        |
 |                   |===========>===+        |   +-------------------+
 |            GPIO 4 |------------------------+---| DS18B20 Sensor    |
 |                   |                            | (Red: VCC, Blk: GND|
 |            GPIO 26|--------[ Signal IN ]------>| Yellow/Wht: DATA) |
 |                   |                            +-------------------+
 |            GPIO 27|---[ Push Button ]---| GND
 |                   |                            +-------------------+
 |               VIN |--------------------------->| 5V Relay VCC      |
 |               3V3 |--------------------------->| Sensor VCC        |
 |               GND |--------------------------->| Common Ground     |
 +-------------------+                            +-------------------+
```

---

## 4. Hardware Fault Code (`E-04`) Detection Logic

The microcontroller firmware implements dual hardware fault triggers:

1. **1-Wire Sensor Disconnect Detection**:
   * If the DS18B20 sensor is unplugged or the 4.7kΩ pull-up resistor connection breaks, OneWire returns `-127.00°C` (`DEVICE_DISCONNECTED_C`).
   * The firmware automatically intercepts this value, flags `fault_code: "E-04"`, and sends `status_text: "CRITICAL: Fault Code E-04 (Sensor Disconnected)"`.

2. **Emergency Edge Trigger Button**:
   * Pressing the GPIO 27 push button triggers a hardware interrupt falling edge.
   * The firmware sets `hasFault = true`, immediately issuing an emergency telemetry packet to Marveluzz Hub with `fault_code: "E-04"` and `emergency_stop: true`.
