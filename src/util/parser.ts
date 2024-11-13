import { Spacing } from "../types/grid.js";

export interface Stringifiable {
  toString(): string;
}

export interface Parser<T> {
  value: T;
}

export class SpacingParser implements Parser<Spacing>, Stringifiable {
  value: Spacing;
  toString(): string {
    return `${this.value.top}, ${this.value.right}, ${this.value.bottom}, ${this.value.left}`;
  }

  constructor(public input: string) {
    try {
      input = input.replaceAll(" ", "");
      const spaces = input.split(',');
      if (spaces.length === 1) {
        const space = tParseInt(spaces[0])
        this.value = { top: space, right: space, bottom: space, left: space };
      } else if (spaces.length === 2) {
        const v = tParseInt(spaces[0]);
        const h = tParseInt(spaces[1]);
        this.value = { top: v, right: h, bottom: v, left: h };
      } else if (spaces.length === 4) {
        this.value = {
          top: tParseInt(spaces[0]),
          right: tParseInt(spaces[1]),
          bottom: tParseInt(spaces[2]),
          left: tParseInt(spaces[3]),
        }
      } else {
        throw Error("Format unsupported.")
      }
    } catch (e) {
      this.value = { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }
}

function tParseInt(input: string): number {
  const result = parseInt(input);
  if (isNaN(result)) {
    throw Error("isNAN");
  }
  return result;
}
