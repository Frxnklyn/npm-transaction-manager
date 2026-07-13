import type { TrackedFile } from "./TrackedFile.js";
import type { UpdaterInterface } from "../interfaces/UpdaterInterface.js";

/** Default implementation of the existing autoupdate and tracked-file contract. */
export class Updater implements UpdaterInterface {
  private isAutoupdate: boolean;
  private files: TrackedFile[] = [];

  /** Creates an updater with automatic updates enabled by default. */
  constructor(isAutoupdate = true) {
    this.isAutoupdate = isAutoupdate;
    return this;
  }

  /** Enables automatic updates and returns this updater for chaining. */
  enableAutoupdate(): this {
    this.isAutoupdate = true;
    return this;
  }

  /** Disables automatic updates and returns this updater for chaining. */
  disableAutoupdate(): this {
    this.isAutoupdate = false;
    return this;
  }

  /** Returns the current autoupdate setting. */
  getIsAutoupdate(): boolean {
    return this.isAutoupdate;
  }

  /** Indicates whether the owner should automatically update. */
  shouldUpdate(): boolean {
    return this.getIsAutoupdate();
  }

  /** Returns the current boolean updater value. */
  getValue(): boolean {
    return this.getIsAutoupdate();
  }

  /** Returns all files tracked by this updater. */
  getTrackedFiles(): readonly TrackedFile[] {
    return this.files;
  }

  /** Adds a file to the tracked-file collection. */
  addFile(file: TrackedFile): this {
    this.files.push(file);
    return this;
  }

  /** Removes a file from the tracked-file collection. */
  removeFile(file: TrackedFile): this {
    this.files = this.files.filter((trackedFile) => trackedFile !== file);
    return this;
  }
}
