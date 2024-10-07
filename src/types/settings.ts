import Gio from "gi://Gio";
import GObject from "gi://GObject";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

/**
 * Key names in the GSettings schema that reference a boolean value.
 */
export type BoolSettingKey =
  "tbd";

/**
 * Key names in the GSettings schema that reference a numeric value.
 */
export type NumberSettingKey =
  "general-gaps-in" |
  "general-gaps-out";

/**
 * Key names in the GSettings schema that reference a string value.
 */
export type StringSettingKey =
  "tbd";

/**
 * Key names in the GSettings schema.
 */
export type SettingKey =
  BoolSettingKey |
  NumberSettingKey |
  StringSettingKey;

type ExtendedSettings<P extends string> = Gio.Settings & {
  // This is only a convenience signature that enables auto-completion. It does
  // not prevent the user from providing any string as sigName and thus does not
  // guarantee type safety.
  connect(sigName: `changed::${P}`, callback: (...args: any[]) => void): number;
};

/**
 * An extension agnostic type-safe variant of {@link Gio.Settings}.
 */
export interface NamedSettings<
  B extends string,
  N extends string,
  S extends string
> extends ExtendedSettings<B | N | S> {
  bind(
    key: B | N | S,
    object: GObject.Object,
    property: string,
    flags: Gio.SettingsBindFlags
  ): void;
  get_boolean(key: B): boolean;
  set_boolean(key: B, value: boolean): boolean;
  get_int(key: N): number;
  set_int(key: N, value: number): boolean;
  get_string(key: S): string;
  set_string(key: S, value: string): boolean;
}

/**
 * Type-safe variant of {@link Gio.Settings}.
 */
export type ExtensionSettings = NamedSettings<
  BoolSettingKey,
  NumberSettingKey,
  StringSettingKey
>;

/**
 * Provides a type-safe {@link Gio.Settings} instance.
 */
export interface ExtensionSettingsProvider extends Extension {
  get settings(): ExtensionSettings;
}
