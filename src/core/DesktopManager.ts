import Meta from "gi://Meta";
import Shell from "gi://Shell";
import Clutter from "gi://Clutter";

import { Rectangle } from "../types/grid.js";
import { Node } from "../types/tree.js";
import { GarbageCollection, GarbageCollector } from "../util/gc.js";
import { UserPreferencesProvider } from "./UserPreferences.js";
import { Container, Tile } from "../util/tile.js";
import { EasingParamsWithProperties } from "@girs/gnome-shell/extensions/global";

export const TitleBlacklist: RegExp[] = [
  // Desktop Icons NG (see https://github.com/gTile/gTile/issues/336#issuecomment-1804267328)
  // https://gitlab.com/rastersoft/desktop-icons-ng/-/blob/cfe944e2ce7a1d27e47b08c002cd100a1e2cb878/app/desktopManager.js#L396
  // https://gitlab.com/rastersoft/desktop-icons-ng/-/blob/cfe944e2ce7a1d27e47b08c002cd100a1e2cb878/app/desktopGrid.js#L160
  // /;BDHF$/,
];

export interface DesktopManagerParams {
  shell: Shell.Global;
  display: Meta.Display;
  workspaceManager: Meta.WorkspaceManager;
  userPreferences: UserPreferencesProvider;
}

/**
 * Abstracts over a multitude of Gnome APIs to provide a unified interface for
 * desktop-related actions and window manipulation.
 */
export default class implements GarbageCollector {
  #gc: GarbageCollection;
  #shell: Shell.Global;
  #display: Meta.Display;
  #workspaceManager: Meta.WorkspaceManager;
  #userPreferences: UserPreferencesProvider;
  #workspaceIdx: number;
  #monitorIdx: number;
  #tree: {
    [workspace: number]: {
      [monitor: number]: Node<Tile | Container>
    }
  };

  constructor({
    shell,
    display,
    workspaceManager,
    userPreferences,
  }: DesktopManagerParams) {
    this.#gc = new GarbageCollection();
    this.#shell = shell;
    this.#display = display;
    this.#workspaceManager = workspaceManager;
    this.#userPreferences = userPreferences;
    this.#workspaceIdx = workspaceManager.get_active_workspace_index();
    this.#monitorIdx = display.get_current_monitor();
    this.#tree = {
      [this.#workspaceIdx]: {
        [this.#monitorIdx]: this.#initTree()
      }
    };

    const workspaceChanged = this.#workspaceManager.connect("active-workspace-changed",
      () => {
        this.#workspaceIdx = this.#workspaceManager.get_active_workspace_index();
        this.#monitorIdx = this.#display.get_current_monitor();

        const tree = this.#initTree();

        if (!this.#tree[this.#workspaceIdx]) {
          this.#tree[this.#workspaceIdx] = { [this.#monitorIdx]: tree }
        } else if (!this.#tree[this.#workspaceIdx][this.#monitorIdx]) {
          this.#tree[this.#workspaceIdx][this.#monitorIdx] = tree;
        }
      }
    );

    const windowEntered = this.#display.connect("window-entered-monitor",
      (display, _, windowNotShown) => {
        const windowShown = windowNotShown.connect("shown",
          (window) => {
            display.disconnect(windowShown);
            this.#onEntered(display, window)
          }
        );
      }
    );
    const windowReleased = this.#display.connect("grab-op-end",
      (display, window) => this.#onEntered(display, window)
    );
    const windowLeft = this.#display.connect("window-left-monitor",
      (display, _, window) => this.#onLeft(display, window)
    );
    const windowGrabbed = this.#display.connect("grab-op-begin",
      (display, window) => this.#onLeft(display, window)
    );

    this.#gc.defer(() => this.#workspaceManager.disconnect(workspaceChanged));
    this.#gc.defer(() => this.#display.disconnect(windowEntered));
    this.#gc.defer(() => this.#display.disconnect(windowLeft));
    this.#gc.defer(() => this.#display.disconnect(windowGrabbed));
    this.#gc.defer(() => this.#display.disconnect(windowReleased));
  }

  /**
   * Must be called prior to disposing the class instance. Cancels subscriptions
   * on the global Gnome singletons. The instance must not be used thereafter.
   */
  release() {
    this.#gc.release();
  }

  autotile(options?: { specific?: { workspaceIdx: number, monitorIdx: number }, all?: boolean }) {
    const w = this.#workspaceIdx;
    const m = this.#monitorIdx;

    if (options?.specific) {
      this.#workspaceIdx = options.specific.workspaceIdx;
      this.#monitorIdx = options.specific.monitorIdx;
    }

    if (options?.all) {
      for (const workspaceIdx in this.#tree) {
        if (Object.prototype.hasOwnProperty.call(this.#tree, workspaceIdx)) {
          const monitor = this.#tree[workspaceIdx];
          for (const monitorIdx in monitor) {
            if (Object.prototype.hasOwnProperty.call(monitor, monitorIdx)) {
              this.autotile({ specific: { workspaceIdx: parseInt(workspaceIdx), monitorIdx: parseInt(monitorIdx) } })
            }
          }
        }
      }
    } else {
      this.#autotile();
    }

    this.#workspaceIdx = w;
    this.#monitorIdx = m;
  }

  #autotile() {
    const workArea = this.#workArea();
    const windows = this.#workspaceManager
      .get_workspace_by_index(this.#workspaceIdx)!
      .list_windows()
      .filter(win => !(
        win.minimized ||
        win.get_monitor() !== this.#monitorIdx ||
        win.get_frame_type() !== Meta.FrameType.NORMAL ||
        TitleBlacklist.some(p => p.test(win.title ?? ""))
      ));

    this.#fitTree(this.#tree[this.#workspaceIdx][this.#monitorIdx], workArea, windows);
  }

  #moveResize(target: Meta.Window, size: Rectangle) {
    target.unmaximize(Meta.MaximizeFlags.BOTH);

    // All internal calculations fictively operate as if the actual window frame
    // size would also incorporate the user-defined window spacing. Only when a
    // window is actually moved this spacing gets deducted.
    const spacing = this.#userPreferences.getSpacing();
    size.x += spacing;
    size.y += spacing;

    // As of Nov '23 the `move_resize_frame` works for almost all application
    // windows. However, a user report pointed out that for gVim, the window is
    // not moved but only resized. The call to `move_frame` fixes that. There
    // doesn't seem to be any other discriminative variable (e.g. window type or
    // frame type) that could serve as an indicator for whether or not this
    // (usually redundant) call is required.
    // https://github.com/HyprTile/HyprTile/issues/336#issuecomment-1803025082
    target.move_frame(true, size.x, size.y);
    if (size) {
      const { width: w, height: h } = size;
      target.move_resize_frame(true, size.x, size.y, w - spacing * 2, h - spacing * 2);
    }
  }

  #fit(target: Meta.Window, { x, y, width, height }: Rectangle) {
    const window: Rectangle = target.get_frame_rect();
    if (
      window.x === x &&
      window.y === y &&
      window.width === width &&
      window.height === height
    ) return;

    const actor: Meta.WindowActor = target.get_compositor_private();
    const actorMargin = { width: actor.width - window.width, height: actor.height - window.height }
    const duration = 700;

    this.#moveResize(target, { x, y, width, height });

    actor.scaleX = (window.width / width);
    actor.scaleY = (window.height / height);
    actor.translationX = (window.x - x) + ((1 - actor.scaleX) * actorMargin.width / 2);
    actor.translationY = (window.y - y) + ((1 - actor.scaleY) * actorMargin.height / 2);
    
    const easeParams: EasingParamsWithProperties = {
      translationX: 0,
      translationY: 0,
      scaleX: 1,
      scaleY: 1,
      mode: Clutter.AnimationMode.EASE_OUT_EXPO,
      duration: duration,
    }

    // Somehow TS Server does not acknowledge the existence of the ease
    // method from Clutter.Actor: "Property 'ease' does not exist on 
    // type 'WindowActor'.ts(2339)""
    // @ts-ignore
    actor.ease(easeParams)
  }

  #workArea(): Rectangle {
    const
      inset = this.#userPreferences.getInset(),
      workArea = this.#workspaceManager
        .get_workspace_by_index(this.#workspaceIdx)!
        .get_work_area_for_monitor(this.#monitorIdx),
      top = Math.clamp(inset.top, 0, Math.floor(workArea.height / 2)),
      bottom = Math.clamp(inset.bottom, 0, Math.floor(workArea.height / 2)),
      left = Math.clamp(inset.left, 0, Math.floor(workArea.width / 2)),
      right = Math.clamp(inset.right, 0, Math.floor(workArea.width / 2)),
      spacing = this.#userPreferences.getSpacing();

    // The fictitious expansion of the workarea by the user-configured spacing
    // effectively acts as a countermeasure so that windows do always align with
    // the screen edge, i.e., unless the user explicitly configured an inset.
    workArea.x += left - spacing;
    workArea.y += top - spacing;
    workArea.width -= left + right - spacing * 2;
    workArea.height -= top + bottom - spacing * 2;

    return workArea;
  }

  #fitTree(tree: Node<Tile | Container>, workArea: Rectangle, windows: Meta.Window[]) {
    if (tree.data instanceof Container && !tree.left && !tree.right) {
      // Node has no window. Only possible on empty desktop.
      return;
    }

    if (tree.data instanceof Tile) {
      const id = tree.data.id;
      this.#fit(windows.find(window => window.get_id() === id)!, workArea);
      return;
    }

    if (tree.data instanceof Container && tree.left && tree.right) {
      const leftArea: Rectangle = {
        x: workArea.x,
        y: workArea.y,
        width: workArea.width,
        height: workArea.height,
      };
      const rightArea: Rectangle = {
        x: workArea.x,
        y: workArea.y,
        width: workArea.width,
        height: workArea.height,
      };
      const dimension = tree.data.split === "Horizontal" ? "height" : "width";
      const position = tree.data.split === "Horizontal" ? "y" : "x";

      if (tree.data.constraint) {
        const left = tree.data.constraint;
        leftArea[dimension] = left;
        rightArea[dimension] = workArea[dimension] - left;
        rightArea[position] = rightArea[position] + left;
      } else {
        const half = workArea[dimension] / 2;
        leftArea[dimension] = half;
        rightArea[dimension] = half;
        rightArea[position] = rightArea[position] + half;
      }

      if (tree.left.data instanceof Tile) {
        const leftId = tree.left.data.id;
        const leftWindow = windows.find(window => window.get_id() === leftId)!;
        this.#fit(leftWindow, leftArea);
      } else {
        this.#fitTree(tree.left, leftArea, windows);
      }

      if (tree.right.data instanceof Tile) {
        const rightId = tree.right.data.id;
        const rightWindow = windows.find(window => window.get_id() === rightId)!;
        this.#fit(rightWindow, rightArea);
      } else {
        this.#fitTree(tree.right, rightArea, windows);
      }

      return;
    }

    console.error(tree);
    throw new Error("Not handled", { cause: "" });
  }

  #exists(tree: Node<Tile | Container>, id: number): boolean {
    let exists = false;

    if (tree.data instanceof Container && tree.left && tree.right) {
      if (tree.left.data instanceof Container) exists = exists || this.#exists(tree.left, id)
      if (tree.right.data instanceof Container) exists = exists || this.#exists(tree.right, id);

      if (tree.left.data instanceof Tile && tree.left.data.id === id) {
        return true;
      }
      if (tree.right.data instanceof Tile && tree.right.data.id === id) {
        return true;
      }
    }

    if (tree.data instanceof Tile && tree.data.id === id) {
      return true;
    }

    return exists;
  }

  #onEntered(display: Meta.Display, window: Meta.Window) {
    if (window.windowType !== Meta.WindowType.NORMAL) return;

    this.#workspaceIdx = display.get_workspace_manager().get_active_workspace_index();
    this.#monitorIdx = display.get_current_monitor();

    if (this.#exists(this.#tree[this.#workspaceIdx][this.#monitorIdx], window.get_id())) return;

    this.#insert(
      this.#tree[this.#workspaceIdx][this.#monitorIdx],
      new Tile(window.get_id()),
      this.#workArea()
    );

    this.autotile();
  }

  #onLeft(display: Meta.Display, window: Meta.Window) {
    if (window.windowType !== Meta.WindowType.NORMAL) return;

    this.#workspaceIdx = display.get_workspace_manager().get_active_workspace_index();
    this.#monitorIdx = display.get_current_monitor();

    this.#tree[this.#workspaceIdx][this.#monitorIdx] = this.#delete(
      this.#tree[this.#workspaceIdx][this.#monitorIdx],
      window.get_id(),
    )

    this.autotile();
  }

  #insert(tree: Node<Tile | Container>, newTile: Tile, workArea: Rectangle): void {
    if (!this.#cursorInArea(workArea)) return;

    if (tree.data instanceof Container && !tree.left && !tree.right) {
      // Node has no window. Only possible on empty desktop.
      tree.data = newTile;
      return;
    }

    if (tree.data instanceof Tile) {
      if (!this.#cursorInArea(workArea)) return;

      const { left: leftArea, container } = this.#splitArea(workArea);

      const temp = tree.data;
      tree.data = container;
      if (this.#cursorInArea(leftArea)) {
        tree.left = { data: newTile };
        tree.right = { data: temp };
      } else {
        tree.left = { data: temp };
        tree.right = { data: newTile };
      }
      return;
    }

    if (tree.data instanceof Container && tree.left && tree.right) {
      const { left: leftArea, right: rightArea } = this.#splitArea(workArea, tree.data);
      this.#insert(tree.left, newTile, leftArea);
      this.#insert(tree.right, newTile, rightArea);
      return;
    }

    console.error(tree);
    throw new Error("Not handled", { cause: "" });
  }

  #delete(tree: Node<Tile | Container>, id: number): Node<Tile | Container> {
    if (tree.data instanceof Container && tree.left && tree.right) {
      if (tree.left.data instanceof Container) tree.left = this.#delete(tree.left, id)
      if (tree.right.data instanceof Container) tree.right = this.#delete(tree.right, id);

      if (tree.left.data instanceof Tile && tree.left.data.id === id) {
        return tree.right;
      }
      if (tree.right.data instanceof Tile && tree.right.data.id === id) {
        return tree.left;
      }
    }

    if (tree.data instanceof Tile && tree.data.id === id) {
      tree.data = new Container("Horizontal")
    }

    return tree;
  }

  #splitArea(area: Rectangle, container?: Container): { left: Rectangle, right: Rectangle, container: Container } {
    const leftArea: Rectangle = {
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    };
    const rightArea: Rectangle = {
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    };

    if (!container) {
      container = new Container(area.height > area.width ? "Horizontal" : "Vertical")
    }

    const dimension = container.split === "Horizontal" ? "height" : "width";
    const position = container.split === "Horizontal" ? "y" : "x";

    if (container.constraint) {
      const left = container.constraint;
      leftArea[dimension] = left;
      rightArea[dimension] = area[dimension] - left;
      rightArea[position] = rightArea[position] + left;
    } else {
      const half = area[dimension] / 2;
      leftArea[dimension] = half;
      rightArea[dimension] = half;
      rightArea[position] = rightArea[position] + half;
    }

    return { left: leftArea, right: rightArea, container: container }
  }

  #initTree(): Node<Tile | Container> {
    const tree: Node<Tile | Container> = { data: new Container("Horizontal") };
    const workArea = this.#workArea();

    const windows = this.#workspaceManager
      .get_workspace_by_index(this.#workspaceIdx)!
      .list_windows()
      .filter(win => !(
        win.minimized ||
        win.get_monitor() !== this.#monitorIdx ||
        win.get_frame_type() !== Meta.FrameType.NORMAL ||
        TitleBlacklist.some(p => p.test(win.title ?? ""))
      ));

    let root = tree;
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

    return tree;
  }

  #cursorInArea(rectangle: Rectangle) {
    const [x, y, _] = this.#shell.get_pointer();

    return x >= rectangle.x &&
      x <= rectangle.x + rectangle.width &&
      y >= rectangle.y &&
      y <= rectangle.y + rectangle.height;
  }
}
