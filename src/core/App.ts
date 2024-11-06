import Shell from "gi://Shell";

import {
  ExtensionSettings,
  ExtensionSettingsProvider,
  SettingKey,
} from "../types/settings.js";
import { GarbageCollection, GarbageCollector } from "../util/gc.js";
import DesktopManager from "./DesktopManager.js";
import UserPreferences from "./UserPreferences.js";

type StripPrefix<S extends string> = S extends `${string}-${infer U}` ? U : S;
type StartsWith<S extends string, Prefix extends string> =
  S extends `${Prefix}${string}` ? S : never;
type GeneralSettingKey = StartsWith<SettingKey, "general-">;

/**
 * Represents the HyprTile extension.
 *
 * The class acts as top-level orchestrator. It is responsible to
 * (1) create required instances, e.g. for UI management and keyboard shortcuts
 * (2) listen & react to relevant events, e.g., user inputs, window focus, etc.
 */
export default class App implements GarbageCollector {
  static #instance: App;

  #gc: GarbageCollection;
  #settings: ExtensionSettings;
  #desktopManager: DesktopManager;

  /**
   * Creates a new singleton instance.
   *
   * The {@link release} method must be called when disposing the instance. It
   * releases all resources that are bound globally and would otherwise continue
   * to exist, such as event subscriptions and UI elements. The instance must
   * not be used thereafter.
   *
   * @param extension The extension instance created by the Gnome environment.
   * @returns The app instance.
   */
  static run(extension: ExtensionSettingsProvider) {
    if (this.#instance) {
      throw new Error("App must have at most one instance.");
    }

    return this.#instance = new this(extension);
  }

  private constructor(extension: ExtensionSettingsProvider) {
    // --- initialize ---
    this.#gc = new GarbageCollection();
    this.#settings = extension.settings;
    this.#desktopManager = new DesktopManager({
      shell: Shell.Global.get(),
      display: Shell.Global.get().display,
      workspaceManager: Shell.Global.get().workspace_manager,
      userPreferences: new UserPreferences({ settings: this.#settings }),
    });
    this.#gc.defer(() => this.#desktopManager.release());

    // --- event handlers ---
    const chid = this.#settings.connect("changed", (_, key: SettingKey) => this.#onSettingsChanged(key));
    this.#gc.defer(() => this.#settings.disconnect(chid));
  }

  release() {
    this.#gc.release();
    App.#instance = undefined as any;
  }

  #onSettingsChanged(key: SettingKey) {
    const requiresReTile = (key: string): key is GeneralSettingKey => key.startsWith("general-");

    requiresReTile(key) && this.#onSettingsGeneralChanged(key);
  }

  #onSettingsGeneralChanged(key: GeneralSettingKey) {
    this.#desktopManager.autotile({ all: true })
  }
}
