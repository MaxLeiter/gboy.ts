import type { IMemory } from "./mmu";
export type { IMemory };

export class CPU {
  private static readonly ILLEGAL_OPCODES = new Set<number>([
    0xd3, 0xdb, 0xdd, 0xe3, 0xe4, 0xeb, 0xec, 0xed, 0xf4, 0xfc, 0xfd,
  ]);

  private memory: IMemory;

  private _a = 0;
  private _f = 0;
  private _b = 0;
  private _c = 0;
  private _d = 0;
  private _e = 0;
  private _h = 0;
  private _l = 0;

  private _sp = 0;
  private _pc = 0;

  public halted = false;
  public stopped = false;
  public ime = false;
  private imeDelay = 0;
  private haltBug = false;
  private hardLocked = false;

  constructor(memory: IMemory) {
    this.memory = memory;
    this.reset();
  }

  reset(): void {
    // DMG post-boot-ROM register state (hardware state after boot ROM completes)
    this.af = 0x01b0;
    this.bc = 0x0013;
    this.de = 0x00d8;
    this.hl = 0x014d;
    this._sp = 0xfffe;
    this._pc = 0x0100;
    this.ime = false;
    this.imeDelay = 0;
    this.haltBug = false;
    this.hardLocked = false;
    this.halted = false;
    this.stopped = false;
  }

  get a(): number {
    return this._a;
  }
  set a(v: number) {
    this._a = v & 0xff;
  }

  get f(): number {
    return this._f;
  }
  set f(v: number) {
    this._f = v & 0xf0;
  }

  get b(): number {
    return this._b;
  }
  set b(v: number) {
    this._b = v & 0xff;
  }

  get c(): number {
    return this._c;
  }
  set c(v: number) {
    this._c = v & 0xff;
  }

  get d(): number {
    return this._d;
  }
  set d(v: number) {
    this._d = v & 0xff;
  }

  get e(): number {
    return this._e;
  }
  set e(v: number) {
    this._e = v & 0xff;
  }

  get h(): number {
    return this._h;
  }
  set h(v: number) {
    this._h = v & 0xff;
  }

  get l(): number {
    return this._l;
  }
  set l(v: number) {
    this._l = v & 0xff;
  }

  get af(): number {
    return (this._a << 8) | this._f;
  }
  set af(v: number) {
    this._a = (v >> 8) & 0xff;
    this._f = v & 0xf0;
  }

  get bc(): number {
    return (this._b << 8) | this._c;
  }
  set bc(v: number) {
    this._b = (v >> 8) & 0xff;
    this._c = v & 0xff;
  }

  get de(): number {
    return (this._d << 8) | this._e;
  }
  set de(v: number) {
    this._d = (v >> 8) & 0xff;
    this._e = v & 0xff;
  }

  get hl(): number {
    return (this._h << 8) | this._l;
  }
  set hl(v: number) {
    this._h = (v >> 8) & 0xff;
    this._l = v & 0xff;
  }

  get sp(): number {
    return this._sp;
  }
  set sp(v: number) {
    this._sp = v & 0xffff;
  }

  get pc(): number {
    return this._pc;
  }
  set pc(v: number) {
    this._pc = v & 0xffff;
  }

  get flagZ(): boolean {
    return (this._f & 0x80) !== 0;
  }
  set flagZ(v: boolean) {
    this._f = v ? (this._f | 0x80) : (this._f & ~0x80);
  }

  get flagN(): boolean {
    return (this._f & 0x40) !== 0;
  }
  set flagN(v: boolean) {
    this._f = v ? (this._f | 0x40) : (this._f & ~0x40);
  }

  get flagH(): boolean {
    return (this._f & 0x20) !== 0;
  }
  set flagH(v: boolean) {
    this._f = v ? (this._f | 0x20) : (this._f & ~0x20);
  }

  get flagC(): boolean {
    return (this._f & 0x10) !== 0;
  }
  set flagC(v: boolean) {
    this._f = v ? (this._f | 0x10) : (this._f & ~0x10);
  }

  private getR8(index: number): number {
    switch (index) {
      case 0: return this._b;
      case 1: return this._c;
      case 2: return this._d;
      case 3: return this._e;
      case 4: return this._h;
      case 5: return this._l;
      case 6: return this.memory.readByte(this.hl);
      case 7: return this._a;
      default: return 0;
    }
  }

  private setR8(index: number, value: number): void {
    value &= 0xff;
    switch (index) {
      case 0: this._b = value; break;
      case 1: this._c = value; break;
      case 2: this._d = value; break;
      case 3: this._e = value; break;
      case 4: this._h = value; break;
      case 5: this._l = value; break;
      case 7: this._a = value; break;
    }
  }

  private signed8(v: number): number {
    return v > 127 ? v - 256 : v;
  }

  private incR8Flags(index: number): number {
    const old = index === 6 ? this.memory.readByte(this.hl) : this.getR8(index);
    const r = (old + 1) & 0xff;
    this.flagZ = r === 0;
    this.flagN = false;
    this.flagH = (old & 0x0f) === 0x0f;
    if (index === 6) {
      this.memory.writeByte(this.hl, r);
      return 12;
    }
    this.setR8(index, r);
    return 4;
  }

  private decR8Flags(index: number): number {
    const old = index === 6 ? this.memory.readByte(this.hl) : this.getR8(index);
    const r = (old - 1) & 0xff;
    this.flagZ = r === 0;
    this.flagN = true;
    this.flagH = (old & 0x0f) === 0x00;
    if (index === 6) {
      this.memory.writeByte(this.hl, r);
      return 12;
    }
    this.setR8(index, r);
    return 4;
  }

  private addHL16(val: number): number {
    const hl = this.hl;
    const result = hl + val;
    this.flagN = false;
    this.flagH = ((hl & 0x0fff) + (val & 0x0fff)) > 0x0fff;
    this.flagC = result > 0xffff;
    this.hl = result & 0xffff;
    return 8;
  }

  private fetchByte(): number {
    const v = this.memory.readByte(this._pc);
    this._pc = (this._pc + 1) & 0xffff;
    return v;
  }

  private fetchWord(): number {
    const lo = this.fetchByte();
    const hi = this.fetchByte();
    return (hi << 8) | lo;
  }

  private pushWord(value: number): void {
    this._sp = (this._sp - 1) & 0xffff;
    this.memory.writeByte(this._sp, (value >> 8) & 0xff);
    this._sp = (this._sp - 1) & 0xffff;
    this.memory.writeByte(this._sp, value & 0xff);
  }

  private popWord(): number {
    const lo = this.memory.readByte(this._sp);
    this._sp = (this._sp + 1) & 0xffff;
    const hi = this.memory.readByte(this._sp);
    this._sp = (this._sp + 1) & 0xffff;
    return (hi << 8) | lo;
  }

  private getPendingInterrupts(): number {
    const ie = this.memory.readByte(0xffff);
    const ifReg = this.memory.readByte(0xff0f);
    return ie & ifReg & 0x1f;
  }

  handleInterrupts(): number {
    const ifReg = this.memory.readByte(0xff0f);
    const pending = this.getPendingInterrupts();

    if (pending === 0) return 0;

    // Any pending interrupt wakes from HALT/STOP, even if IME is off.
    this.halted = false;
    this.stopped = false;

    if (!this.ime) return 0;

    // Service highest-priority interrupt (bit 0 = highest)
    this.ime = false;
    this.imeDelay = 0;
    for (let bit = 0; bit < 5; bit++) {
      if (pending & (1 << bit)) {
        this.memory.writeByte(0xff0f, ifReg & ~(1 << bit));
        this.pushWord(this._pc);
        this._pc = 0x0040 + bit * 8;
        return 20;
      }
    }
    return 0;
  }

  step(): number {
    if (this.hardLocked) {
      return 4;
    }

    if (this.stopped) {
      // STOP exits when an interrupt becomes pending.
      if (this.getPendingInterrupts() === 0) {
        return 4;
      }
      this.stopped = false;
    }

    const interruptCycles = this.handleInterrupts();
    if (interruptCycles !== 0) return interruptCycles;

    if (this.halted) {
      // HALT still consumes cycles while waiting for an interrupt edge.
      return 4;
    }

    const promoteIMEAfterInstruction = this.imeDelay > 0;
    const opcode = this.haltBug ? this.memory.readByte(this._pc) : this.fetchByte();
    this.haltBug = false;

    try {
      switch (opcode) {
      case 0x00:
        return 4;

      case 0x01:
        this.bc = this.fetchWord();
        return 12;

      case 0x07: {
        const bit7 = (this._a >> 7) & 1;
        this._a = ((this._a << 1) | bit7) & 0xff;
        this._f = bit7 ? 0x10 : 0x00;
        return 4;
      }

      case 0x0f: {
        const bit0 = this._a & 1;
        this._a = ((this._a >> 1) | (bit0 << 7)) & 0xff;
        this._f = bit0 ? 0x10 : 0x00;
        return 4;
      }

      case 0x17: {
        const oldCarry = this._f & 0x10 ? 1 : 0;
        const bit7 = (this._a >> 7) & 1;
        this._a = ((this._a << 1) | oldCarry) & 0xff;
        this._f = bit7 ? 0x10 : 0x00;
        return 4;
      }

      case 0x18: {
        const offset = this.fetchByte();
        this._pc = (this._pc + this.signed8(offset)) & 0xffff;
        return 12;
      }

      case 0x1f: {
        const oldCarry = this._f & 0x10 ? 1 : 0;
        const bit0 = this._a & 1;
        this._a = ((this._a >> 1) | (oldCarry << 7)) & 0xff;
        this._f = bit0 ? 0x10 : 0x00;
        return 4;
      }

      case 0x20: {
        const offset = this.fetchByte();
        if (!(this._f & 0x80)) {
          this._pc = (this._pc + this.signed8(offset)) & 0xffff;
          return 12;
        }
        return 8;
      }

      case 0x28: {
        const offset = this.fetchByte();
        if (this._f & 0x80) {
          this._pc = (this._pc + this.signed8(offset)) & 0xffff;
          return 12;
        }
        return 8;
      }

      case 0x30: {
        const offset = this.fetchByte();
        if (!(this._f & 0x10)) {
          this._pc = (this._pc + this.signed8(offset)) & 0xffff;
          return 12;
        }
        return 8;
      }

      case 0x38: {
        const offset = this.fetchByte();
        if (this._f & 0x10) {
          this._pc = (this._pc + this.signed8(offset)) & 0xffff;
          return 12;
        }
        return 8;
      }

      case 0x03:
        this.bc = (this.bc + 1) & 0xffff;
        return 8;
      case 0x13:
        this.de = (this.de + 1) & 0xffff;
        return 8;
      case 0x23:
        this.hl = (this.hl + 1) & 0xffff;
        return 8;
      case 0x33:
        this._sp = (this._sp + 1) & 0xffff;
        return 8;

      case 0x0b:
        this.bc = (this.bc - 1) & 0xffff;
        return 8;
      case 0x1b:
        this.de = (this.de - 1) & 0xffff;
        return 8;
      case 0x2b:
        this.hl = (this.hl - 1) & 0xffff;
        return 8;
      case 0x3b:
        this._sp = (this._sp - 1) & 0xffff;
        return 8;

      case 0x04: return this.incR8Flags(0); // INC B
      case 0x0c: return this.incR8Flags(1); // INC C
      case 0x14: return this.incR8Flags(2); // INC D
      case 0x1c: return this.incR8Flags(3); // INC E
      case 0x24: return this.incR8Flags(4); // INC H
      case 0x2c: return this.incR8Flags(5); // INC L
      case 0x3c: return this.incR8Flags(7); // INC A

      case 0x05: return this.decR8Flags(0); // DEC B
      case 0x0d: return this.decR8Flags(1); // DEC C
      case 0x15: return this.decR8Flags(2); // DEC D
      case 0x1d: return this.decR8Flags(3); // DEC E
      case 0x25: return this.decR8Flags(4); // DEC H
      case 0x2d: return this.decR8Flags(5); // DEC L
      case 0x3d: return this.decR8Flags(7); // DEC A

      case 0x02:
        this.memory.writeByte(this.bc, this._a);
        return 8;

      case 0x06:
        this._b = this.fetchByte();
        return 8;

      case 0x08: {
        const addr08 = this.fetchWord();
        this.memory.writeByte(addr08, this._sp & 0xff);
        this.memory.writeByte((addr08 + 1) & 0xffff, (this._sp >> 8) & 0xff);
        return 20;
      }

      case 0x0a:
        this._a = this.memory.readByte(this.bc);
        return 8;

      case 0x0e:
        this._c = this.fetchByte();
        return 8;

      case 0x10:
        this.fetchByte();
        this.stopped = true;
        return 4;

      case 0x11:
        this.de = this.fetchWord();
        return 12;

      case 0x12:
        this.memory.writeByte(this.de, this._a);
        return 8;

      case 0x16:
        this._d = this.fetchByte();
        return 8;

      case 0x1a:
        this._a = this.memory.readByte(this.de);
        return 8;

      case 0x1e:
        this._e = this.fetchByte();
        return 8;

      case 0x21:
        this.hl = this.fetchWord();
        return 12;

      case 0x22:
        this.memory.writeByte(this.hl, this._a);
        this.hl = (this.hl + 1) & 0xffff;
        return 8;

      case 0x26:
        this._h = this.fetchByte();
        return 8;

      case 0x27: {
        let a = this._a;
        if (!this.flagN) {
          if (this.flagC || a > 0x99) {
            a += 0x60;
            this.flagC = true;
          }
          if (this.flagH || (a & 0x0f) > 0x09) {
            a += 0x06;
          }
        } else {
          if (this.flagC) {
            a -= 0x60;
          }
          if (this.flagH) {
            a -= 0x06;
          }
        }
        a &= 0xff;
        this.flagZ = a === 0;
        this.flagH = false;
        this._a = a;
        return 4;
      }

      case 0x09: {
        const hl = this.hl;
        const val = this.bc;
        const result = hl + val;
        this.flagN = false;
        this.flagH = ((hl & 0x0fff) + (val & 0x0fff)) > 0x0fff;
        this.flagC = result > 0xffff;
        this.hl = result & 0xffff;
        return 8;
      }
      case 0x19: {
        const hl = this.hl;
        const val = this.de;
        const result = hl + val;
        this.flagN = false;
        this.flagH = ((hl & 0x0fff) + (val & 0x0fff)) > 0x0fff;
        this.flagC = result > 0xffff;
        this.hl = result & 0xffff;
        return 8;
      }
      case 0x29: {
        const hl = this.hl;
        const result = hl + hl;
        this.flagN = false;
        this.flagH = ((hl & 0x0fff) + (hl & 0x0fff)) > 0x0fff;
        this.flagC = result > 0xffff;
        this.hl = result & 0xffff;
        return 8;
      }
      case 0x39: {
        const hl = this.hl;
        const val = this._sp;
        const result = hl + val;
        this.flagN = false;
        this.flagH = ((hl & 0x0fff) + (val & 0x0fff)) > 0x0fff;
        this.flagC = result > 0xffff;
        this.hl = result & 0xffff;
        return 8;
      }

      case 0x2a:
        this._a = this.memory.readByte(this.hl);
        this.hl = (this.hl + 1) & 0xffff;
        return 8;

      case 0x2e:
        this._l = this.fetchByte();
        return 8;

      case 0x2f:
        this._a = (~this._a) & 0xff;
        this.flagN = true;
        this.flagH = true;
        return 4;

      case 0x31:
        this._sp = this.fetchWord();
        return 12;

      case 0x32:
        this.memory.writeByte(this.hl, this._a);
        this.hl = (this.hl - 1) & 0xffff;
        return 8;

      case 0x34: {
        const addr = this.hl;
        const val = this.memory.readByte(addr);
        const r = (val + 1) & 0xff;
        this.flagZ = r === 0;
        this.flagN = false;
        this.flagH = (val & 0x0f) === 0x0f;
        this.memory.writeByte(addr, r);
        return 12;
      }
      case 0x35: {
        const addr = this.hl;
        const val = this.memory.readByte(addr);
        const r = (val - 1) & 0xff;
        this.flagZ = r === 0;
        this.flagN = true;
        this.flagH = (val & 0x0f) === 0x00;
        this.memory.writeByte(addr, r);
        return 12;
      }

      case 0x36:
        this.memory.writeByte(this.hl, this.fetchByte());
        return 12;

      case 0x37:
        this.flagN = false;
        this.flagH = false;
        this.flagC = true;
        return 4;

      case 0x3a:
        this._a = this.memory.readByte(this.hl);
        this.hl = (this.hl - 1) & 0xffff;
        return 8;

      case 0x3e:
        this._a = this.fetchByte();
        return 8;

      case 0x3f:
        this.flagN = false;
        this.flagH = false;
        this.flagC = !this.flagC;
        return 4;

      case 0x40: return 4;
      case 0x41: this._b = this._c; return 4;
      case 0x42: this._b = this._d; return 4;
      case 0x43: this._b = this._e; return 4;
      case 0x44: this._b = this._h; return 4;
      case 0x45: this._b = this._l; return 4;
      case 0x46: this._b = this.memory.readByte(this.hl); return 8;
      case 0x47: this._b = this._a; return 4;

      case 0x48: this._c = this._b; return 4;
      case 0x49: return 4;
      case 0x4a: this._c = this._d; return 4;
      case 0x4b: this._c = this._e; return 4;
      case 0x4c: this._c = this._h; return 4;
      case 0x4d: this._c = this._l; return 4;
      case 0x4e: this._c = this.memory.readByte(this.hl); return 8;
      case 0x4f: this._c = this._a; return 4;

      case 0x50: this._d = this._b; return 4;
      case 0x51: this._d = this._c; return 4;
      case 0x52: return 4;
      case 0x53: this._d = this._e; return 4;
      case 0x54: this._d = this._h; return 4;
      case 0x55: this._d = this._l; return 4;
      case 0x56: this._d = this.memory.readByte(this.hl); return 8;
      case 0x57: this._d = this._a; return 4;

      case 0x58: this._e = this._b; return 4;
      case 0x59: this._e = this._c; return 4;
      case 0x5a: this._e = this._d; return 4;
      case 0x5b: return 4;
      case 0x5c: this._e = this._h; return 4;
      case 0x5d: this._e = this._l; return 4;
      case 0x5e: this._e = this.memory.readByte(this.hl); return 8;
      case 0x5f: this._e = this._a; return 4;

      case 0x60: this._h = this._b; return 4;
      case 0x61: this._h = this._c; return 4;
      case 0x62: this._h = this._d; return 4;
      case 0x63: this._h = this._e; return 4;
      case 0x64: return 4;
      case 0x65: this._h = this._l; return 4;
      case 0x66: this._h = this.memory.readByte(this.hl); return 8;
      case 0x67: this._h = this._a; return 4;

      case 0x68: this._l = this._b; return 4;
      case 0x69: this._l = this._c; return 4;
      case 0x6a: this._l = this._d; return 4;
      case 0x6b: this._l = this._e; return 4;
      case 0x6c: this._l = this._h; return 4;
      case 0x6d: return 4;
      case 0x6e: this._l = this.memory.readByte(this.hl); return 8;
      case 0x6f: this._l = this._a; return 4;

      case 0x70: this.memory.writeByte(this.hl, this._b); return 8;
      case 0x71: this.memory.writeByte(this.hl, this._c); return 8;
      case 0x72: this.memory.writeByte(this.hl, this._d); return 8;
      case 0x73: this.memory.writeByte(this.hl, this._e); return 8;
      case 0x74: this.memory.writeByte(this.hl, this._h); return 8;
      case 0x75: this.memory.writeByte(this.hl, this._l); return 8;

      case 0x76: {
        // HALT bug: if IME=0 and an interrupt is pending, HALT does not enter
        // halted state and the next opcode fetch re-reads the same byte.
        if (!this.ime && this.getPendingInterrupts() !== 0) {
          this.haltBug = true;
          return 4;
        }
        this.halted = true;
        return 4;
      }

      case 0x77: this.memory.writeByte(this.hl, this._a); return 8;

      case 0x78: this._a = this._b; return 4;
      case 0x79: this._a = this._c; return 4;
      case 0x7a: this._a = this._d; return 4;
      case 0x7b: this._a = this._e; return 4;
      case 0x7c: this._a = this._h; return 4;
      case 0x7d: this._a = this._l; return 4;
      case 0x7e: this._a = this.memory.readByte(this.hl); return 8;
      case 0x7f: return 4;

      case 0x80: case 0x81: case 0x82: case 0x83:
      case 0x84: case 0x85: case 0x87: {
        const val = this.getR8(opcode & 0x07);
        const result = this._a + val;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = false;
        this.flagH = ((this._a & 0x0f) + (val & 0x0f)) > 0x0f;
        this.flagC = result > 0xff;
        this._a = result & 0xff;
        return 4;
      }

      case 0x86: {
        const val = this.memory.readByte(this.hl);
        const result = this._a + val;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = false;
        this.flagH = ((this._a & 0x0f) + (val & 0x0f)) > 0x0f;
        this.flagC = result > 0xff;
        this._a = result & 0xff;
        return 8;
      }

      case 0x88: case 0x89: case 0x8a: case 0x8b:
      case 0x8c: case 0x8d: case 0x8f: {
        const val = this.getR8(opcode & 0x07);
        const carry = this.flagC ? 1 : 0;
        const result = this._a + val + carry;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = false;
        this.flagH = ((this._a & 0x0f) + (val & 0x0f) + carry) > 0x0f;
        this.flagC = result > 0xff;
        this._a = result & 0xff;
        return 4;
      }

      case 0x8e: {
        const val = this.memory.readByte(this.hl);
        const carry = this.flagC ? 1 : 0;
        const result = this._a + val + carry;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = false;
        this.flagH = ((this._a & 0x0f) + (val & 0x0f) + carry) > 0x0f;
        this.flagC = result > 0xff;
        this._a = result & 0xff;
        return 8;
      }

      case 0x90: case 0x91: case 0x92: case 0x93:
      case 0x94: case 0x95: case 0x97: {
        const val = this.getR8(opcode & 0x07);
        const result = this._a - val;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = true;
        this.flagH = (this._a & 0x0f) < (val & 0x0f);
        this.flagC = this._a < val;
        this._a = result & 0xff;
        return 4;
      }

      case 0x96: {
        const val = this.memory.readByte(this.hl);
        const result = this._a - val;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = true;
        this.flagH = (this._a & 0x0f) < (val & 0x0f);
        this.flagC = this._a < val;
        this._a = result & 0xff;
        return 8;
      }

      case 0x98: case 0x99: case 0x9a: case 0x9b:
      case 0x9c: case 0x9d: case 0x9f: {
        const val = this.getR8(opcode & 0x07);
        const carry = this.flagC ? 1 : 0;
        const result = this._a - val - carry;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = true;
        this.flagH = (this._a & 0x0f) < (val & 0x0f) + carry;
        this.flagC = this._a < val + carry;
        this._a = result & 0xff;
        return 4;
      }

      case 0x9e: {
        const val = this.memory.readByte(this.hl);
        const carry = this.flagC ? 1 : 0;
        const result = this._a - val - carry;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = true;
        this.flagH = (this._a & 0x0f) < (val & 0x0f) + carry;
        this.flagC = this._a < val + carry;
        this._a = result & 0xff;
        return 8;
      }

      case 0xa0: case 0xa1: case 0xa2: case 0xa3:
      case 0xa4: case 0xa5: case 0xa7: {
        this._a &= this.getR8(opcode & 0x07);
        this.flagZ = this._a === 0;
        this.flagN = false;
        this.flagH = true;
        this.flagC = false;
        return 4;
      }

      case 0xa6: {
        this._a &= this.memory.readByte(this.hl);
        this.flagZ = this._a === 0;
        this.flagN = false;
        this.flagH = true;
        this.flagC = false;
        return 8;
      }

      case 0xa8: case 0xa9: case 0xaa: case 0xab:
      case 0xac: case 0xad: case 0xaf: {
        this._a ^= this.getR8(opcode & 0x07);
        this._f = this._a === 0 ? 0x80 : 0x00;
        return 4;
      }

      case 0xae: {
        this._a ^= this.memory.readByte(this.hl);
        this._f = this._a === 0 ? 0x80 : 0x00;
        return 8;
      }

      case 0xb0: case 0xb1: case 0xb2: case 0xb3:
      case 0xb4: case 0xb5: case 0xb7: {
        this._a |= this.getR8(opcode & 0x07);
        this._f = this._a === 0 ? 0x80 : 0x00;
        return 4;
      }

      case 0xb6: {
        this._a |= this.memory.readByte(this.hl);
        this._f = this._a === 0 ? 0x80 : 0x00;
        return 8;
      }

      case 0xb8: case 0xb9: case 0xba: case 0xbb:
      case 0xbc: case 0xbd: case 0xbf: {
        const val = this.getR8(opcode & 0x07);
        this.flagZ = ((this._a - val) & 0xff) === 0;
        this.flagN = true;
        this.flagH = (this._a & 0x0f) < (val & 0x0f);
        this.flagC = this._a < val;
        return 4;
      }

      case 0xbe: {
        const val = this.memory.readByte(this.hl);
        this.flagZ = ((this._a - val) & 0xff) === 0;
        this.flagN = true;
        this.flagH = (this._a & 0x0f) < (val & 0x0f);
        this.flagC = this._a < val;
        return 8;
      }

      case 0xc0:
        if (!(this._f & 0x80)) {
          this._pc = this.popWord();
          return 20;
        }
        return 8;

      case 0xc1:
        this.bc = this.popWord();
        return 12;

      case 0xc2: {
        const addrC2 = this.fetchWord();
        if (!(this._f & 0x80)) {
          this._pc = addrC2;
          return 16;
        }
        return 12;
      }

      case 0xc3:
        this._pc = this.fetchWord();
        return 16;

      case 0xc4: {
        const addrC4 = this.fetchWord();
        if (!(this._f & 0x80)) {
          this.pushWord(this._pc);
          this._pc = addrC4;
          return 24;
        }
        return 12;
      }

      case 0xc5:
        this.pushWord(this.bc);
        return 16;

      case 0xc6: {
        const val = this.fetchByte();
        const result = this._a + val;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = false;
        this.flagH = ((this._a & 0x0f) + (val & 0x0f)) > 0x0f;
        this.flagC = result > 0xff;
        this._a = result & 0xff;
        return 8;
      }

      case 0xc7:
        this.pushWord(this._pc);
        this._pc = 0x00;
        return 16;

      case 0xc8:
        if (this._f & 0x80) {
          this._pc = this.popWord();
          return 20;
        }
        return 8;

      case 0xc9:
        this._pc = this.popWord();
        return 16;

      case 0xca: {
        const addrCA = this.fetchWord();
        if (this._f & 0x80) {
          this._pc = addrCA;
          return 16;
        }
        return 12;
      }

      case 0xcb:
        return this.executeCB();

      case 0xcc: {
        const addrCC = this.fetchWord();
        if (this._f & 0x80) {
          this.pushWord(this._pc);
          this._pc = addrCC;
          return 24;
        }
        return 12;
      }

      case 0xcd: {
        const addrCD = this.fetchWord();
        this.pushWord(this._pc);
        this._pc = addrCD;
        return 24;
      }

      case 0xce: {
        const val = this.fetchByte();
        const carry = this.flagC ? 1 : 0;
        const result = this._a + val + carry;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = false;
        this.flagH = ((this._a & 0x0f) + (val & 0x0f) + carry) > 0x0f;
        this.flagC = result > 0xff;
        this._a = result & 0xff;
        return 8;
      }

      case 0xcf:
        this.pushWord(this._pc);
        this._pc = 0x08;
        return 16;

      case 0xd0:
        if (!(this._f & 0x10)) {
          this._pc = this.popWord();
          return 20;
        }
        return 8;

      case 0xd1:
        this.de = this.popWord();
        return 12;

      case 0xd2: {
        const addrD2 = this.fetchWord();
        if (!(this._f & 0x10)) {
          this._pc = addrD2;
          return 16;
        }
        return 12;
      }

      case 0xd4: {
        const addrD4 = this.fetchWord();
        if (!(this._f & 0x10)) {
          this.pushWord(this._pc);
          this._pc = addrD4;
          return 24;
        }
        return 12;
      }

      case 0xd5:
        this.pushWord(this.de);
        return 16;

      case 0xd6: {
        const val = this.fetchByte();
        const result = this._a - val;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = true;
        this.flagH = (this._a & 0x0f) < (val & 0x0f);
        this.flagC = this._a < val;
        this._a = result & 0xff;
        return 8;
      }

      case 0xd7:
        this.pushWord(this._pc);
        this._pc = 0x10;
        return 16;

      case 0xd8:
        if (this._f & 0x10) {
          this._pc = this.popWord();
          return 20;
        }
        return 8;

      case 0xd9:
        this._pc = this.popWord();
        this.ime = true;
        this.imeDelay = 0;
        return 16;

      case 0xda: {
        const addrDA = this.fetchWord();
        if (this._f & 0x10) {
          this._pc = addrDA;
          return 16;
        }
        return 12;
      }

      case 0xdc: {
        const addrDC = this.fetchWord();
        if (this._f & 0x10) {
          this.pushWord(this._pc);
          this._pc = addrDC;
          return 24;
        }
        return 12;
      }

      case 0xde: {
        const val = this.fetchByte();
        const carry = this.flagC ? 1 : 0;
        const result = this._a - val - carry;
        this.flagZ = (result & 0xff) === 0;
        this.flagN = true;
        this.flagH = (this._a & 0x0f) < (val & 0x0f) + carry;
        this.flagC = this._a < val + carry;
        this._a = result & 0xff;
        return 8;
      }

      case 0xdf:
        this.pushWord(this._pc);
        this._pc = 0x18;
        return 16;

      case 0xe0:
        this.memory.writeByte(0xff00 + this.fetchByte(), this._a);
        return 12;

      case 0xe1:
        this.hl = this.popWord();
        return 12;

      // LD (C), A
      case 0xe2:
        this.memory.writeByte(0xff00 + this._c, this._a);
        return 8;

      // PUSH HL
      case 0xe5:
        this.pushWord(this.hl);
        return 16;

      // AND d8
      case 0xe6: {
        this._a &= this.fetchByte();
        this.flagZ = this._a === 0;
        this.flagN = false;
        this.flagH = true;
        this.flagC = false;
        return 8;
      }

      // RST 20
      case 0xe7:
        this.pushWord(this._pc);
        this._pc = 0x20;
        return 16;

      // ADD SP, r8
      case 0xe8: {
        const rawE8 = this.fetchByte();
        const signedE8 = this.signed8(rawE8);
        const resultE8 = (this._sp + signedE8) & 0xffff;
        const spLoE8 = this._sp & 0xff;
        this._f = 0;
        if (((spLoE8 & 0x0f) + (rawE8 & 0x0f)) & 0x10) this._f |= 0x20;
        if ((spLoE8 + rawE8) & 0x100) this._f |= 0x10;
        this._sp = resultE8;
        return 16;
      }

      // JP (HL)
      case 0xe9:
        this._pc = (this._h << 8) | this._l;
        return 4;

      // LD (a16), A
      case 0xea:
        this.memory.writeByte(this.fetchWord(), this._a);
        return 16;

      // XOR d8
      case 0xee: {
        this._a ^= this.fetchByte();
        this._f = this._a === 0 ? 0x80 : 0x00;
        return 8;
      }

      // RST 28
      case 0xef:
        this.pushWord(this._pc);
        this._pc = 0x28;
        return 16;

      // LDH A, (a8)
      case 0xf0:
        this._a = this.memory.readByte(0xff00 + this.fetchByte());
        return 12;

      // POP AF
      case 0xf1: {
        const valF1 = this.popWord();
        this._a = (valF1 >> 8) & 0xff;
        this._f = valF1 & 0xf0;
        return 12;
      }

      // LD A, (C)
      case 0xf2:
        this._a = this.memory.readByte(0xff00 + this._c);
        return 8;

      // DI
      case 0xf3:
        this.ime = false;
        this.imeDelay = 0;
        return 4;

      // PUSH AF
      case 0xf5:
        this.pushWord(this.af);
        return 16;

      // OR d8
      case 0xf6: {
        this._a |= this.fetchByte();
        this._f = this._a === 0 ? 0x80 : 0x00;
        return 8;
      }

      // RST 30
      case 0xf7:
        this.pushWord(this._pc);
        this._pc = 0x30;
        return 16;

      // LD HL, SP+r8
      case 0xf8: {
        const offsetF8 = this.fetchByte();
        const signedF8 = (offsetF8 ^ 0x80) - 0x80;
        const resultF8 = (this._sp + signedF8) & 0xffff;
        const spLo = this._sp & 0xff;
        const offLo = offsetF8 & 0xff;
        this._f = 0;
        if (((spLo & 0xf) + (offLo & 0xf)) > 0xf) this._f |= 0x20;
        if ((spLo + offLo) > 0xff) this._f |= 0x10;
        this.hl = resultF8;
        return 12;
      }

      // LD SP, HL
      case 0xf9:
        this._sp = this.hl;
        return 8;

      // LD A, (a16)
      case 0xfa:
        this._a = this.memory.readByte(this.fetchWord());
        return 16;

      // EI - delayed: IME is set after the NEXT instruction
      case 0xfb:
        this.imeDelay = 1;
        return 4;

      // CP d8
      case 0xfe: {
        const val = this.fetchByte();
        this.flagZ = ((this._a - val) & 0xff) === 0;
        this.flagN = true;
        this.flagH = (this._a & 0x0f) < (val & 0x0f);
        this.flagC = this._a < val;
        return 8;
      }

      // RST 38
      case 0xff:
        this.pushWord(this._pc);
        this._pc = 0x38;
        return 16;

      default:
        if (CPU.ILLEGAL_OPCODES.has(opcode)) {
          // LR35902 illegal opcodes hard-lock the CPU until reset.
          this.hardLocked = true;
          return 4;
        }
        throw new Error(
          `Unimplemented opcode: 0x${opcode.toString(16).toUpperCase().padStart(2, "0")} at 0x${(this._pc - 1).toString(16).toUpperCase().padStart(4, "0")}`
        );
      }
    } finally {
      if (promoteIMEAfterInstruction && this.imeDelay > 0) {
        this.imeDelay--;
        if (this.imeDelay === 0) {
          this.ime = true;
        }
      }
    }
  }

  // ─── CB-prefix helpers ──────────────────────────────────────────

  private getCBTarget(index: number): number {
    switch (index) {
      case 0: return this._b;
      case 1: return this._c;
      case 2: return this._d;
      case 3: return this._e;
      case 4: return this._h;
      case 5: return this._l;
      case 6: return this.memory.readByte((this._h << 8) | this._l);
      case 7: return this._a;
      default: return 0;
    }
  }

  private setCBTarget(index: number, value: number): void {
    value &= 0xff;
    switch (index) {
      case 0: this._b = value; break;
      case 1: this._c = value; break;
      case 2: this._d = value; break;
      case 3: this._e = value; break;
      case 4: this._h = value; break;
      case 5: this._l = value; break;
      case 6: this.memory.writeByte((this._h << 8) | this._l, value); break;
      case 7: this._a = value; break;
    }
  }

  private executeCB(): number {
    const op = this.fetchByte();
    const target = op & 0x07;
    const isHL = target === 6;

    if (op < 0x40) {
      // Rotate/shift group
      let value = this.getCBTarget(target);
      let result: number;
      let carry: boolean;

      switch (op & 0xf8) {
        case 0x00: { // RLC
          carry = (value & 0x80) !== 0;
          result = ((value << 1) | (carry ? 1 : 0)) & 0xff;
          break;
        }
        case 0x08: { // RRC
          carry = (value & 0x01) !== 0;
          result = ((value >> 1) | (carry ? 0x80 : 0)) & 0xff;
          break;
        }
        case 0x10: { // RL
          const oldCarry = this.flagC ? 1 : 0;
          carry = (value & 0x80) !== 0;
          result = ((value << 1) | oldCarry) & 0xff;
          break;
        }
        case 0x18: { // RR
          const oldCarry = this.flagC ? 1 : 0;
          carry = (value & 0x01) !== 0;
          result = ((value >> 1) | (oldCarry << 7)) & 0xff;
          break;
        }
        case 0x20: { // SLA
          carry = (value & 0x80) !== 0;
          result = (value << 1) & 0xff;
          break;
        }
        case 0x28: { // SRA
          carry = (value & 0x01) !== 0;
          result = ((value >> 1) | (value & 0x80)) & 0xff;
          break;
        }
        case 0x30: { // SWAP
          carry = false;
          result = ((value & 0x0f) << 4) | ((value & 0xf0) >> 4);
          break;
        }
        case 0x38: { // SRL
          carry = (value & 0x01) !== 0;
          result = (value >> 1) & 0xff;
          break;
        }
        default:
          throw new Error(`Unreachable CB opcode: 0x${op.toString(16)}`);
      }

      this.setCBTarget(target, result);
      this._f =
        (result === 0 ? 0x80 : 0) |
        (carry ? 0x10 : 0);
      return isHL ? 16 : 8;
    }

    if (op < 0x80) {
      // BIT b, r
      const bit = (op >> 3) & 7;
      const value = this.getCBTarget(target);
      const isZero = (value & (1 << bit)) === 0;
      // Z: set if bit is 0, N: 0, H: 1, C: unchanged
      this._f =
        (isZero ? 0x80 : 0) |
        0x20 | // H always set
        (this._f & 0x10); // preserve C
      return isHL ? 12 : 8;
    }

    if (op < 0xc0) {
      // RES b, r
      const bit = (op >> 3) & 7;
      const value = this.getCBTarget(target);
      this.setCBTarget(target, value & ~(1 << bit));
      return isHL ? 16 : 8;
    }

    // SET b, r
    const bit = (op >> 3) & 7;
    const value = this.getCBTarget(target);
    this.setCBTarget(target, value | (1 << bit));
    return isHL ? 16 : 8;
  }

  // ─── Serialization ──────────────────────────────────────────────

  serialize(): Uint8Array {
    // Layout: a, f, b, c, d, e, h, l (8 bytes)
    //         sp_hi, sp_lo, pc_hi, pc_lo (4 bytes)
    //         state byte: bit0=ime, bit1=halted, bit2=imeDelay, bit3=stopped, bit4=haltBug, bit5=hardLocked (1 byte)
    // Total: 13 bytes
    const data = new Uint8Array(13);
    data[0] = this._a;
    data[1] = this._f;
    data[2] = this._b;
    data[3] = this._c;
    data[4] = this._d;
    data[5] = this._e;
    data[6] = this._h;
    data[7] = this._l;
    data[8] = (this._sp >> 8) & 0xff;
    data[9] = this._sp & 0xff;
    data[10] = (this._pc >> 8) & 0xff;
    data[11] = this._pc & 0xff;
    data[12] =
      (this.ime ? 1 : 0)
      | (this.halted ? 2 : 0)
      | (this.imeDelay > 0 ? 4 : 0)
      | (this.stopped ? 8 : 0)
      | (this.haltBug ? 16 : 0)
      | (this.hardLocked ? 32 : 0);
    return data;
  }

  static deserialize(data: Uint8Array, memory: IMemory): CPU {
    if (data.length < 13) {
      throw new Error(`CPU state buffer too short: expected 13 bytes, got ${data.length}`);
    }
    const cpu = new CPU(memory);
    cpu._a = data[0]!;
    cpu._f = data[1]! & 0xf0;
    cpu._b = data[2]!;
    cpu._c = data[3]!;
    cpu._d = data[4]!;
    cpu._e = data[5]!;
    cpu._h = data[6]!;
    cpu._l = data[7]!;
    cpu._sp = (data[8]! << 8) | data[9]!;
    cpu._pc = (data[10]! << 8) | data[11]!;
    cpu.ime = (data[12]! & 1) !== 0;
    cpu.halted = (data[12]! & 2) !== 0;
    cpu.imeDelay = (data[12]! & 4) !== 0 ? 1 : 0;
    cpu.stopped = (data[12]! & 8) !== 0;
    cpu.haltBug = (data[12]! & 16) !== 0;
    cpu.hardLocked = (data[12]! & 32) !== 0;
    return cpu;
  }
}
