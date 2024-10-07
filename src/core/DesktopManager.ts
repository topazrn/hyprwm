import Meta from "gi://Meta";
import Shell from "gi://Shell";
import Clutter from "gi://Clutter";

import type {
  LayoutManager,
  Monitor
} from "resource:///org/gnome/shell/ui/layout.js";

import { DesktopEvent, Event, Screen } from "../types/desktop.js";
import { Rectangle } from "../types/grid.js";
import { DispatchFn, Publisher } from "../types/observable.js";
import { Node } from "../types/tree.js";
import { GarbageCollection, GarbageCollector } from "../util/gc.js";
import { UserPreferencesProvider } from "./UserPreferences.js";
import { Container, Tile } from "../util/tile.js";

// splits computed gridspec cell areas in non-dynamic and dynamic cells
type GridSpecAreas = [dedicated: Rectangle[], dynamic: Rectangle[]];

type FrameSize = { width: number; height: number };

export const TitleBlacklist: RegExp[] = [
  // Desktop Icons NG (see https://github.com/HyprWM/HyprWM/issues/336#issuecomment-1804267328)
  // https://gitlab.com/rastersoft/desktop-icons-ng/-/blob/cfe944e2ce7a1d27e47b08c002cd100a1e2cb878/app/desktopManager.js#L396
  // https://gitlab.com/rastersoft/desktop-icons-ng/-/blob/cfe944e2ce7a1d27e47b08c002cd100a1e2cb878/app/desktopGrid.js#L160
  /;BDHF$/,
];

export interface DesktopManagerParams {
  shell: Shell.Global;
  display: Meta.Display;
  layoutManager: LayoutManager;
  monitorManager: Meta.MonitorManager;
  workspaceManager: Meta.WorkspaceManager;
  userPreferences: UserPreferencesProvider;
}

/**
 * Abstracts over a multitude of Gnome APIs to provide a unified interface for
 * desktop-related actions and window manipulation.
 */
export default class implements Publisher<DesktopEvent>, GarbageCollector {
  #gc: GarbageCollection;
  #shell: Shell.Global;
  #display: Meta.Display;
  #layoutManager: LayoutManager;
  #workspaceManager: Meta.WorkspaceManager;
  #userPreferences: UserPreferencesProvider;
  #dispatchCallbacks: DispatchFn<DesktopEvent>[];

  constructor({
    shell,
    display,
    layoutManager,
    monitorManager,
    workspaceManager,
    userPreferences,
  }: DesktopManagerParams) {
    this.#gc = new GarbageCollection();
    this.#shell = shell;
    this.#display = display;
    this.#layoutManager = layoutManager;
    this.#workspaceManager = workspaceManager;
    this.#userPreferences = userPreferences;
    this.#dispatchCallbacks = [];

    {
      const chid = monitorManager.connect("monitors-changed", () => {
        this.#dispatch({ type: Event.MONITORS_CHANGED });
      });
      this.#gc.defer(() => monitorManager.disconnect(chid));
    }
    {
      const chid = display.connect("notify::focus-window", () => {
        this.#dispatch({ type: Event.FOCUS, target: display.focus_window });
      });
      this.#gc.defer(() => display.disconnect(chid));
    }
    {
      const chid = layoutManager.overviewGroup.connect("notify::visible", g => {
        this.#dispatch({ type: Event.OVERVIEW, visible: g.visible });
      });
      this.#gc.defer(() => layoutManager.disconnect(chid));
    }
  }

  /**
   * Must be called prior to disposing the class instance. Cancels subscriptions
   * on the global Gnome singletons. The instance must not be used thereafter.
   */
  release() {
    this.#dispatchCallbacks = [];
    this.#gc.release();
  }

  subscribe(fn: DispatchFn<DesktopEvent>) {
    this.#dispatchCallbacks.push(fn);
  }

  /**
   * The window that is currently in focus.
   */
  get focusedWindow(): Meta.Window | null {
    // current implementation already returns null but since this is not
    // documented, use nullish coalescing for safety.
    return this.#display.focus_window ?? null;
  }

  /**
   * The list of monitors that comprise the desktop.
   */
  get monitors(): Screen[] {
    const monitors = this.#layoutManager.monitors;
    const workAreas = monitors.map(m => this.#workspaceManager
      .get_active_workspace()
      .get_work_area_for_monitor(m.index));

    return this.#layoutManager.monitors.map((m, index) => ({
      index: m.index,
      scale: m.geometryScale,
      resolution: { x: m.x, y: m.y, width: m.width, height: m.height },
      workArea: {
        x: workAreas[index].x,
        y: workAreas[index].y,
        width: workAreas[index].width,
        height: workAreas[index].height,
      }
    }));
  }

  /**
   * The current pointer location as X/Y coordinates.
   */
  get pointer(): [x: number, y: number] {
    const [x, y] = this.#shell.get_pointer();

    return [x, y];
  }

  /**
   * Applies a {@link GridSpec} to the targeted {@link Monitor.index}.
   *
   * The relative-sized cells of the GridSpec are mapped to the work area of the
   * monitor and are then populated with the windows that are located on that
   * monitor. The currently focused window gets placed into the cell with the
   * largest area. Afterwards, the remaining non-dynamic cells are populated
   * (randomly) with the remaining windows until either (1) no windows are left
   * to be placed or (2) no more cells are available to place them in. In the
   * latter case, the remaining windows are then placed in the dynamic cells of
   * the grid, if any. Dynamic cells share their space between the windows that
   * occupy them.
   *
   * @param allTree The {@link Node<Tile | Container>} to be applied.
   */
  autotile(tree: Node<Tile | Container>) {
    const monitorIdx = this.#display.get_current_monitor();
    const workArea = this.workArea(monitorIdx);
    const windows = this.#workspaceManager
      .get_active_workspace()
      .list_windows()
      .filter(win => !(
        win.minimized ||
        win.get_monitor() !== monitorIdx ||
        win.get_frame_type() !== Meta.FrameType.NORMAL ||
        TitleBlacklist.some(p => p.test(win.title ?? ""))
      ));

    this.#fitTree(tree, workArea, windows);
  }

  removeId(tree: Node<Tile | Container>, id: number): Node<Tile | Container> {
    if (tree.data instanceof Container && tree.left && tree.right) {
      if (tree.left.data instanceof Container) tree.left = this.removeId(tree.left, id)
      if (tree.right.data instanceof Container) tree.right = this.removeId(tree.right, id);

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

  #dispatch(event: DesktopEvent) {
    for (const cb of this.#dispatchCallbacks) {
      cb(event);
    }
  }

  #moveResize(target: Meta.Window, x: number, y: number, size?: FrameSize) {
    target.unmaximize(Meta.MaximizeFlags.BOTH);

    // All internal calculations fictively operate as if the actual window frame
    // size would also incorporate the user-defined window spacing. Only when a
    // window is actually moved this spacing gets deducted.
    const spacing = this.#userPreferences.getSpacing();
    x += spacing;
    y += spacing;

    // As of Nov '23 the `move_resize_frame` works for almost all application
    // windows. However, a user report pointed out that for gVim, the window is
    // not moved but only resized. The call to `move_frame` fixes that. There
    // doesn't seem to be any other discriminative variable (e.g. window type or
    // frame type) that could serve as an indicator for whether or not this
    // (usually redundant) call is required.
    // https://github.com/HyprWM/HyprWM/issues/336#issuecomment-1803025082
    target.move_frame(true, x, y);
    if (size) {
      const { width: w, height: h } = size;
      target.move_resize_frame(true, x, y, w - spacing * 2, h - spacing * 2);
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

    this.#moveResize(target, x, y, { width, height });

    actor.scaleX = (window.width / width);
    actor.scaleY = (window.height / height);
    actor.translationX = (window.x - x) + ((1 - actor.scaleX) * actorMargin.width / 2);
    actor.translationY = (window.y - y) + ((1 - actor.scaleY) * actorMargin.height / 2);
    console.log("started", target.title);
    actor.ease({
      translationX: 0,
      translationY: 0,
      scaleX: 1,
      scaleY: 1,
      mode: Clutter.AnimationMode.EASE_OUT_EXPO,
      duration: duration,
      onComplete: () => {
        // For some reason onComplete executes immediately after start.
        // So I had to manually use setTimeout for now.
        setTimeout(() => {
          console.log("completed", target.title);
        }, duration);
      },
    })
  }

  workArea(monitorIdx: number): Rectangle {
    const
      inset = this.#userPreferences.getInset(),
      workArea = this.#workspaceManager
        .get_active_workspace()
        .get_work_area_for_monitor(monitorIdx),
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

  pushTree(tree: Node<Tile | Container>, point: { x: number, y: number }, newTile: Tile, workArea?: Rectangle): void {
    if (!workArea) {
      workArea = this.workArea(this.#display.get_current_monitor());
    }

    if (!this.#pointInRectangle(point, workArea)) return;

    if (tree.data instanceof Container && !tree.left && !tree.right) {
      // Node has no window. Only possible on empty desktop.
      tree.data = newTile;
      return;
    }

    if (tree.data instanceof Tile) {
      if (!this.#pointInRectangle(point, workArea)) return;

      const { left: leftArea, container } = this.#splitArea(workArea);

      const temp = tree.data;
      tree.data = container;
      if (this.#pointInRectangle(point, leftArea)) {
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
      this.pushTree(tree.left, point, newTile, leftArea);
      this.pushTree(tree.right, point, newTile, rightArea);
      return;
    }

    console.error(tree);
    throw new Error("Not handled", { cause: "" });
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

  #pointInRectangle(point: { x: number, y: number }, rectangle: Rectangle) {
    return point.x >= rectangle.x &&
      point.x <= rectangle.x + rectangle.width &&
      point.y >= rectangle.y &&
      point.y <= rectangle.y + rectangle.height;
  }
}
