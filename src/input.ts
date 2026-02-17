export enum Button {
  Right,
  Left,
  Up,
  Down,
  A,
  B,
  Select,
  Start,
}

const DIRECTION_BUTTONS = [Button.Right, Button.Left, Button.Up, Button.Down];
const ACTION_BUTTONS = [Button.A, Button.B, Button.Select, Button.Start];

export class Joypad {
  private buttons: Uint8Array;
  private interruptPending: boolean;
  private selectedBits: number;
  private lastLowerNibble: number;

  constructor() {
    this.buttons = new Uint8Array(8);
    this.interruptPending = false;
    this.selectedBits = 0x30;
    this.lastLowerNibble = 0x0F;
  }

  private computeLowerNibble(selectedBits = this.selectedBits): number {
    const selectDirections = (selectedBits & 0x10) === 0;
    const selectActions = (selectedBits & 0x20) === 0;

    let lower = 0x0F;

    if (selectDirections) {
      for (let i = 0; i < 4; i++) {
        if (this.buttons[DIRECTION_BUTTONS[i]!]!) {
          lower &= ~(1 << i);
        }
      }
    }

    if (selectActions) {
      for (let i = 0; i < 4; i++) {
        if (this.buttons[ACTION_BUTTONS[i]!]!) {
          lower &= ~(1 << i);
        }
      }
    }

    return lower;
  }

  private updateInterruptFromLowerTransition(nextLowerNibble: number): void {
    const fallingEdgeBits = this.lastLowerNibble & (~nextLowerNibble & 0x0F);
    if (fallingEdgeBits !== 0) {
      this.interruptPending = true;
    }
    this.lastLowerNibble = nextLowerNibble & 0x0F;
  }

  writeSelect(value: number): void {
    this.selectedBits = value & 0x30;
    const nextLowerNibble = this.computeLowerNibble();
    this.updateInterruptFromLowerTransition(nextLowerNibble);
  }

  pressButton(button: Button): void {
    if (!this.buttons[button]) {
      this.buttons[button] = 1;
      const nextLowerNibble = this.computeLowerNibble();
      this.updateInterruptFromLowerTransition(nextLowerNibble);
    }
  }

  releaseButton(button: Button): void {
    if (!this.buttons[button]) return;
    this.buttons[button] = 0;
    this.lastLowerNibble = this.computeLowerNibble();
  }

  read(selectedBits: number): number {
    const latchedSelection = selectedBits & 0x30;
    if (latchedSelection !== this.selectedBits) {
      this.selectedBits = latchedSelection;
      this.lastLowerNibble = this.computeLowerNibble();
    }
    const lower = this.computeLowerNibble();
    const upper = 0xC0 | this.selectedBits;
    return upper | lower;
  }

  isInterruptRequested(): boolean {
    const pending = this.interruptPending;
    this.interruptPending = false;
    return pending;
  }

  reset(): void {
    this.buttons.fill(0);
    this.interruptPending = false;
    this.selectedBits = 0x30;
    this.lastLowerNibble = 0x0F;
  }

  serialize(): Uint8Array {
    const data = new Uint8Array(11);
    data.set(this.buttons, 0);
    data[8] = this.interruptPending ? 1 : 0;
    data[9] = this.selectedBits & 0x30;
    data[10] = this.lastLowerNibble & 0x0F;
    return data;
  }

  static deserialize(data: Uint8Array): Joypad {
    if (data.length < 9) {
      throw new Error(
        `Joypad state buffer too short: expected 9 bytes, got ${data.length}`
      );
    }
    const joypad = new Joypad();
    joypad.buttons.set(data.subarray(0, 8));
    joypad.interruptPending = data[8] === 1;
    if (data.length >= 11) {
      joypad.selectedBits = data[9]! & 0x30;
      joypad.lastLowerNibble = data[10]! & 0x0F;
    } else {
      joypad.selectedBits = 0x30;
      joypad.lastLowerNibble = joypad.computeLowerNibble();
    }
    return joypad;
  }
}
