// Read-only DualSense HID reports. No device writes, driver replacement or
// enhanced-mode negotiation; Bluetooth basic mode exposes fewer buttons.
using System;
using System.Globalization;
using System.Text;

internal class DualSenseInput {
  internal int Buttons, LeftTrigger, RightTrigger;
  internal double LX, LY, RX, RY;
  internal bool Guide, Touchpad;
  internal bool? Mute;
  static double Axis(byte value, bool invert) {
    double n = (value - 128) / (value < 128 ? 128.0 : 127.0);
    return Math.Abs(n) < .10 ? 0 : Math.Round((invert ? -n : n) * 50) / 50;
  }
  internal static DualSenseInput Parse(byte[] data) {
    if (data == null || data.Length < 10) return null;
    bool simple = data[0] == 1 && (data.Length == 10 || data.Length == 78);
    int offset;
    if (simple) offset = 1;
    else if (data[0] == 1 && data.Length >= 64) offset = 1;
    else if (data[0] == 0x31 && data.Length >= 78) offset = 2;
    else return null;
    int buttonOffset = offset + (simple ? 4 : 7);
    int a = data[buttonOffset], b = data[buttonOffset+1], c = data[buttonOffset+2], hat = a & 15;
    int bits = 0;
    if (hat == 7 || hat == 0 || hat == 1) bits |= 1;
    if (hat >= 3 && hat <= 5) bits |= 2;
    if (hat >= 5 && hat <= 7) bits |= 4;
    if (hat >= 1 && hat <= 3) bits |= 8;
    if ((a & 0x10) != 0) bits |= 16384;
    if ((a & 0x20) != 0) bits |= 4096;
    if ((a & 0x40) != 0) bits |= 8192;
    if ((a & 0x80) != 0) bits |= 32768;
    if ((b & 1) != 0) bits |= 256;
    if ((b & 2) != 0) bits |= 512;
    if ((b & 16) != 0) bits |= 32;
    if ((b & 32) != 0) bits |= 16;
    if ((b & 64) != 0) bits |= 64;
    if ((b & 128) != 0) bits |= 128;
    return new DualSenseInput {
      Buttons = bits, LeftTrigger = data[offset+(simple?7:4)], RightTrigger = data[offset+(simple?8:5)],
      LX = Axis(data[offset],false), LY = Axis(data[offset+1],true),
      RX = Axis(data[offset+2],false), RY = Axis(data[offset+3],true),
      Guide = (c & 1) != 0, Touchpad = (c & 2) != 0,
      Mute = simple ? (bool?)null : (c & 4) != 0,
    };
  }
  internal string Json(int id) {
    return "{\"id\":" + id + ",\"kind\":\"dualsense\",\"buttons\":" + Buttons +
      ",\"lt\":" + LeftTrigger + ",\"rt\":" + RightTrigger +
      ",\"lx\":" + LX.ToString(CultureInfo.InvariantCulture) + ",\"ly\":" + LY.ToString(CultureInfo.InvariantCulture) +
      ",\"rx\":" + RX.ToString(CultureInfo.InvariantCulture) + ",\"ry\":" + RY.ToString(CultureInfo.InvariantCulture) +
      ",\"extra\":{\"guide\":" + (Guide?"true":"false") + ",\"touchpad\":" + (Touchpad?"true":"false") +
      ",\"mute\":" + (Mute.HasValue?(Mute.Value?"true":"false"):"null") + "}}";
  }
}
