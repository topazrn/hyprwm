import Shell from "gi://Shell";
import Meta from "gi://Meta";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import {
  ExtensionSettings,
  ExtensionSettingsProvider,
  SettingKey,
} from "../types/settings.js";
import { Node } from "../types/tree.js";
import { GarbageCollection, GarbageCollector } from "../util/gc.js";
import DesktopManager, { TitleBlacklist } from "./DesktopManager.js";
import UserPreferences from "./UserPreferences.js";
import { Container, Tile } from "../util/tile.js";
import { Config } from "../types/config.js";

type StripPrefix<S extends string> = S extends `${string}-${infer U}` ? U : S;
type StartsWith<S extends string, Prefix extends string> =
  S extends `${Prefix}${string}` ? S : never;
type GeneralSettingKey = StartsWith<SettingKey, "general-">;

/**
 * Represents the HyprWM extension.
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
  #config: Config;
  // this.#tree[workspace][monitor]
  #tree: Node<Tile | Container>[][];

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

    const display = Shell.Global.get().display;
    const workspaceManager = Shell.Global.get().workspace_manager;
    this.#desktopManager = new DesktopManager({
      shell: Shell.Global.get(),
      display: display,
      layoutManager: Main.layoutManager,
      monitorManager: Shell.Global.get().backend.get_monitor_manager(),
      workspaceManager: workspaceManager,
      userPreferences: new UserPreferences({ settings: this.#settings }),
    });
    this.#gc.defer(() => this.#desktopManager.release());

    this.#config = {
      general: {
        ["gaps-in"]: this.#settings.get_int("general-gaps-in"),
        ["gaps-out"]: this.#settings.get_int("general-gaps-out"),
      }
    }

    this.#tree = this.#initTree();

    // --- event handlers ---
    const windowEntered = display.connect("window-created",
      (display, windowNotShown) => {
        const windowShown = windowNotShown.connect("shown",
          (window) => {
            display.disconnect(windowShown);
            this.#pushTree(display, window, new Tile(window.get_id()))
          }
        );
      }
    );
    const windowReleased = display.connect("grab-op-end",
      (display, window) => this.#pushTree(display, window, new Tile(window.get_id()))
    );
    const windowLeft = display.connect("window-left-monitor",
      (display, _, window) => this.#popTree(display, window)
    );
    const windowGrabbed = display.connect("grab-op-begin",
      (display, window) => this.#popTree(display, window)
    );

    this.#gc.defer(() => display.disconnect(windowEntered));
    this.#gc.defer(() => display.disconnect(windowLeft));
    this.#gc.defer(() => display.disconnect(windowGrabbed));
    this.#gc.defer(() => display.disconnect(windowReleased));

    const chid = this.#settings.connect("changed", (_, key: SettingKey) => this.#onSettingsChanged(key));
    this.#gc.defer(() => this.#settings.disconnect(chid));
  }

  #initTree() {
    const workspaceManager = Shell.Global.get().workspace_manager;
    const display = Shell.Global.get().display;
    const workspaceCount = workspaceManager.nWorkspaces;
    const monitorCount = display.get_n_monitors();

    const tree = [...Array(workspaceCount)]
      .map(_ => Array(monitorCount)
        .fill({ data: new Container("Horizontal") }));

    for (let monitorIdx = 0; monitorIdx < monitorCount; monitorIdx++) {
      const workArea = this.#desktopManager.workArea(monitorIdx);
      for (let workspaceIdx = 0; workspaceIdx < workspaceCount; workspaceIdx++) {
        const windows = workspaceManager
          .get_workspace_by_index(workspaceIdx)!
          .list_windows()
          .filter(win => !(
            win.minimized ||
            win.get_monitor() !== monitorIdx ||
            win.get_frame_type() !== Meta.FrameType.NORMAL ||
            TitleBlacklist.some(p => p.test(win.title ?? ""))
          ));

        let root = tree[workspaceIdx][monitorIdx];
        for (let index = 0; index < windows.length; index++) {
          const window = windows[index];

          if (root.data instanceof Container) {
            if (!root.right) {
              root.data = new Tile(window.get_id());
            } else {
              root = root.right;
            }
          } else {
            root.left = { data: new Tile(root.data.id) };
            root.right = { data: new Tile(window.get_id()) };
            root.data = new Container(index % 2 === 0 && workArea.width > workArea.height ? "Horizontal" : "Vertical");
            root = root.right;
          }
        }
        this.#desktopManager.autotile(tree[workspaceIdx][monitorIdx]);
      }
    }
    return tree;
  }

  release() {
    this.#gc.release();
    App.#instance = undefined as any;
  }

  #pushTree(display: Meta.Display, window: Meta.Window, tile: Tile) {
    if (window.windowType !== Meta.WindowType.NORMAL) return;

    const currentWorkspace = Shell.Global.get().workspace_manager.get_active_workspace();
    const [x, y, _] = Shell.Global.get().get_pointer();

    this.#desktopManager.pushTree(
      this.#tree[currentWorkspace.index()][display.get_current_monitor()],
      { x, y },
      tile,
    );
    this.#desktopManager.autotile(this.#tree[currentWorkspace.index()][display.get_current_monitor()]);
    console.log(this.#tree);
  }

  #popTree(display: Meta.Display, window: Meta.Window) {
    if (window.windowType !== Meta.WindowType.NORMAL) return;

    const currentWorkspace = Shell.Global.get().workspace_manager.get_active_workspace();
    this.#tree[currentWorkspace.index()][display.get_current_monitor()] = this.#desktopManager.removeId(
      this.#tree[currentWorkspace.index()][display.get_current_monitor()],
      window.get_id(),
    )
    this.#desktopManager.autotile(this.#tree[currentWorkspace.index()][display.get_current_monitor()]);
  }

  #onSettingsChanged(key: SettingKey) {
    const requiresReTile = (key: string): key is GeneralSettingKey => key.startsWith("general-");

    requiresReTile(key) && this.#onSettingsGeneralChanged(key);
  }

  #onSettingsGeneralChanged(key: GeneralSettingKey) {
    const prop = key.replace("general-", "") as StripPrefix<GeneralSettingKey>
    this.#config.general[prop] = this.#settings.get_int(key) ?? 0;
    
    const currentWorkspace = Shell.Global.get().workspace_manager.get_active_workspace();
    this.#desktopManager.autotile(this.#tree[currentWorkspace.index()][currentWorkspace.get_display().get_current_monitor()])
  }
}
