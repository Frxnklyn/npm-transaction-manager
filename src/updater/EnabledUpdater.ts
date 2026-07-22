import type { TrackedFile } from "./TrackedFile.js";
import type { UpdaterInterface } from "../interfaces/UpdaterInterface.js";

/** No-op updater that keeps automatic updates permanently enabled. */
export class EnabledUpdater implements UpdaterInterface {
  /** Keeps automatic updates enabled. */
  enableAutoupdate(): this {
    return this;
  }

  /** Keeps automatic updates enabled. */
  disableAutoupdate(): this {
    return this;
  }

  /** Always reports enabled autoupdate. */
  getIsAutoupdate(): boolean {
    return true;
  }

  /** Always allows automatic updates. */
  shouldUpdate(): boolean {
    return true;
  }

  /** Always returns the enabled boolean value. */
  getValue(): boolean {
    return true;
  }

  /** Never tracks files because this updater is stateless. */
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
