import type { TrackedFile } from "./TrackedFile.js";

export interface UpdaterInterface {
  enableAutoupdate(): this;
  disableAutoupdate(): this;
  getIsAutoupdate(): boolean;
  shouldUpdate(): boolean;
  getValue(): boolean;
  getTrackedFiles(): readonly TrackedFile[];
  addFile(file: TrackedFile): this;
  removeFile(file: TrackedFile): this;
}
