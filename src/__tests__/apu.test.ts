import { describe, expect, it } from "bun:test";
import { APU } from "../apu";

const NR10 = 0xff10;
const NR11 = 0xff11;
const NR12 = 0xff12;
const NR13 = 0xff13;
const NR14 = 0xff14;
const NR50 = 0xff24;
const NR51 = 0xff25;
const NR52 = 0xff26;

describe("APU", () => {
  it("triggers channel 1 and exposes status in NR52", () => {
    const apu = new APU();

    apu.writeRegister(NR12, 0xf3);
    apu.writeRegister(NR11, 0x80);
    apu.writeRegister(NR13, 0x70);
    apu.writeRegister(NR14, 0x87);

    expect(apu.readRegister(NR52) & 0x01).toBe(0x01);
  });

  it("powers down and clears active channel status", () => {
    const apu = new APU();

    apu.writeRegister(NR12, 0xf3);
    apu.writeRegister(NR14, 0x80);
    expect(apu.readRegister(NR52) & 0x01).toBe(0x01);

    apu.writeRegister(NR52, 0x00);

    expect(apu.readRegister(NR52)).toBe(0x70);
    expect(apu.readRegister(NR50)).toBe(0x00);
    expect(apu.readRegister(NR51)).toBe(0x00);
  });

  it("produces PCM samples when output is enabled", () => {
    const apu = new APU();

    apu.setOutputEnabled(true);
    apu.writeRegister(NR50, 0x77);
    apu.writeRegister(NR51, 0x11);
    apu.writeRegister(NR12, 0xf3);
    apu.writeRegister(NR11, 0x80);
    apu.writeRegister(NR13, 0x70);
    apu.writeRegister(NR14, 0x87);

    apu.tick(70224);

    const samples = apu.consumeSamples();
    expect(samples.length).toBeGreaterThan(0);
    expect(Array.from(samples).some((value) => value !== 0)).toBe(true);
  });

  it("round-trips serialize/deserialize state", () => {
    const apu = new APU();

    apu.setOutputEnabled(true);
    apu.writeRegister(NR50, 0x77);
    apu.writeRegister(NR51, 0x11);
    apu.writeRegister(NR12, 0xf3);
    apu.writeRegister(NR11, 0x80);
    apu.writeRegister(NR13, 0x70);
    apu.writeRegister(NR14, 0x87);
    apu.tick(4096);

    const restored = APU.deserialize(apu.serialize());
    expect(restored.readRegister(NR12)).toBe(apu.readRegister(NR12));
    expect(restored.readRegister(NR50)).toBe(apu.readRegister(NR50));
    expect(restored.readRegister(NR52) & 0x8f).toBe(apu.readRegister(NR52) & 0x8f);

    restored.tick(4096);
    const samples = restored.consumeSamples();
    expect(samples.length).toBeGreaterThan(0);
  });
});
