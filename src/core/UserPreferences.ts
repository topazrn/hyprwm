import { Inset } from "../types/grid.js";
import { ExtensionSettings } from "../types/settings.js";

/**
 * Provides user preferences.
 */
export interface UserPreferencesProvider {
  getInset(): Inset;
  getSpacing(): number;
}

export interface UserPreferencesParams {
  settings: ExtensionSettings;
}

/**
 * A simple store that provides user preferences.
 */
export default class implements UserPreferencesProvider {
  #settings: ExtensionSettings;

  constructor({ settings }: UserPreferencesParams) {
    this.#settings = settings;
  }

  /**
   * The monitor inset to be respected when performing window resize operations.
   *
   * @param primary Whether to request the inset for the primary monitor.
   * @returns The inset for the requested monitor (primary or secondary).
   */
  getInset(): Inset {
    const gapsOut = this.#settings.get_int("general-gaps-out");

    return {
      top: gapsOut,
      bottom: gapsOut,
      left: gapsOut,
      right: gapsOut,
    };
  }

  /**
   * The spacing that is expected to be applied to windows when moved and/or
   * resized. Windows frames are shrunk by the specified spacing unless they are
   * placed at the edge of the screen, in which case spacing has no effect.
   *
   * @returns The window spacing in pixel.
   */
  getSpacing(): number {
    return this.#settings.get_int("general-gaps-in");
  }
}
