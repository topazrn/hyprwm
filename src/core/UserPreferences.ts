import { Spacing } from "../types/grid.js";
import { ExtensionSettings } from "../types/settings.js";

/**
 * Provides user preferences.
 */
export interface UserPreferencesProvider {
  get gapsOut(): Spacing;
  get gapsIn(): Spacing;
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
   * gaps between windows, also supports 
   * css style gaps (top, right, bottom, left -> 5,10,15,20)
   *
   * @returns The spacing for the requested monitor.
   */
  get gapsIn(): Spacing {
    const gapsIn = parseInt(this.#settings.get_string("general-gaps-in"));

    return {
      top: gapsIn,
      bottom: gapsIn,
      left: gapsIn,
      right: gapsIn,
    };
  }

  /**
   * gaps between windows and monitor edges, also supports 
   * css style gaps (top, right, bottom, left -> 5,10,15,20)
   *
   * @returns The spacing for the requested monitor.
   */
  get gapsOut(): Spacing {
    const gapsOut = parseInt(this.#settings.get_string("general-gaps-out"));

    return {
      top: gapsOut,
      bottom: gapsOut,
      left: gapsOut,
      right: gapsOut,
    };
  }
}
