import { Spacing } from "../types/grid.js";
import { ExtensionSettings } from "../types/settings.js";
import { SpacingParser } from "../util/parser.js";

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
    return new SpacingParser(this.#settings.get_string("general-gaps-in")).value;
  }

  /**
   * gaps between windows and monitor edges, also supports 
   * css style gaps (top, right, bottom, left -> 5,10,15,20)
   *
   * @returns The spacing for the requested monitor.
   */
  get gapsOut(): Spacing {
    return new SpacingParser(this.#settings.get_string("general-gaps-out")).value;
  }
}
