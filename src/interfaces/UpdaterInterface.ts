import type { TrackedFile } from "../updater/TrackedFile.js";

/** Describes the existing autoupdate and tracked-file contract of an updater. */
export interface UpdaterInterface {
  /** Enables automatic updates for the updater. */
  enableAutoupdate(): this;

  /** Disables automatic updates for the updater. */
  disableAutoupdate(): this;

  /** Returns whether automatic updates are enabled. */
  getIsAutoupdate(): boolean;

  /** Indicates whether the owner should perform an automatic update. */
  shouldUpdate(): boolean;

  /** Returns the updater's current boolean value. */
  getValue(): boolean;

  /** Lists the files currently tracked by this updater. */
  getTrackedFiles(): readonly TrackedFile[];

  /** Adds a file to the tracked-file collection. */
  addFile(file: TrackedFile): this;

  /** Removes a file from the tracked-file collection. */
  removeFile(file: TrackedFile): this;
}
