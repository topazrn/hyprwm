import Adw from "gi://Adw";
import Gio from "gi://Gio";

import {
  ExtensionPreferences
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import {
  BoolSettingKey,
  ExtensionSettings,
  NumberSettingKey,
  StringSettingKey,
} from "./types/settings.js";
import { GarbageCollection } from "./util/gc.js";

export default class extends ExtensionPreferences {
  #gc!: GarbageCollection;
  #settings!: ExtensionSettings;
  #window!: Adw.PreferencesWindow;

  async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    this.#gc = new GarbageCollection();
    this.#settings = this.getSettings();
    this.#window = window;

    window.set_default_size(950, 740);
    window.set_search_enabled(true);

    window.add(this.#buildGeneralPage());
    // window.add(this.#buildAnimationsPage());

    // Listening to the `destroy` signal does not work. The only viable signals
    // to perform destructive operations are `close-request` and `unrealize`.
    window.connect("close-request", this.#release.bind(this));
  }

  #release() {
    this.#gc.release();
    this.#gc = undefined!;
    this.#settings = undefined!;
    // do NOT set #window to undefined! This would cause the GC to dereference
    // and cleanup resources before GJS expects them to be gone (even long after
    // the preference window was closed). Would cause errors like these:
    // - instance with invalid (NULL) class pointer
    // - g_signal_handlers_disconnect_matched: assertion 'G_TYPE_CHECK_INSTANCE (instance)' failed
  }

  #buildGeneralPage() {
    const page = new Adw.PreferencesPage({
      title: "General",
      icon_name: "preferences-other-symbolic",
    });

    {
      const group = new Adw.PreferencesGroup({
        title: "Inset &amp; Spacing",
        description:
          "Note: The window spacing is additive, i.e., two adjacent windows " +
          "will have twice the spacing that is configured below."
      });
      page.add(group);

      group.add(this.#spinRow("general-gaps-in", 0, 500, 1));
      group.add(this.#spinRow("general-gaps-out", 0, 500, 1));
    }

   return page;
  }

  #switchRow(
    schemaKey: BoolSettingKey,
    params: Partial<Adw.SwitchRow.ConstructorProps> = {},
  ) {
    const settingsSchemaKey = this.#settings.settings_schema.get_key(schemaKey);
    const row = new Adw.SwitchRow({
      ...params,
      title: settingsSchemaKey.get_summary() ?? undefined,
    });

    this.#settings.bind(schemaKey, row, "active", Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  #spinRow(
    schemaKey: NumberSettingKey,
    lower: number,
    upper: number,
    step: number,
  ) {
    const settingsSchemaKey = this.#settings.settings_schema.get_key(schemaKey);
    const row = new Adw.SpinRow({
      title: settingsSchemaKey.get_summary() ?? undefined,
    });
    row.adjustment.lower = lower;
    row.adjustment.upper = upper;
    row.adjustment.step_increment = step;
    row.adjustment.page_increment = step * 10;
    this.#settings.bind(schemaKey, row, "value", Gio.SettingsBindFlags.DEFAULT);

    return row;
  }

  #entryRow(schemaKey: StringSettingKey) {
    const settingsSchemaKey = this.#settings.settings_schema.get_key(schemaKey);
    const row = new Adw.EntryRow({
      title: settingsSchemaKey.get_summary() ?? undefined,
      editable: true,
      show_apply_button: true,
    });
    this.#settings.bind(schemaKey, row, "text", Gio.SettingsBindFlags.DEFAULT);

    return row;
  }
}