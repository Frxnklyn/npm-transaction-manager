import type { TrackedFile } from "./TrackedFile.js";
import type { UpdaterInterface } from "../interfaces/UpdaterInterface.js";

/** No-op updater installed while a participant is attached to a transaction. */
export class DisabledUpdater implements UpdaterInterface {
  /** Suppresses an optional concrete persistence hook. */
  update(): void {
    // Optional runtime persistence hook deliberately suppressed.
  }

  /** Keeps automatic updates disabled. */
  enableAutoupdate(): this {
    return this;
  }

  /** Keeps automatic updates disabled. */
  disableAutoupdate(): this {
    return this;
  }

  /** Always reports disabled autoupdate. */
  getIsAutoupdate(): boolean {
    return false;
  }

  /** Always prevents automatic updates. */
  shouldUpdate(): boolean {
    return false;
  }

  /** Always returns the disabled boolean value. */
  getValue(): boolean {
    return false;
  }

  /** Never exposes tracked files while disabled. */
  getTrackedFiles(): readonly TrackedFile[] {
    return [];
  }

  /** Ignores attempts to add a tracked file. */
  addFile(_file: TrackedFile): this {
    return this;
  }

  /** Ignores attempts to remove a tracked file. */
  removeFile(_file: TrackedFile): this {
    return this;
  }
}
