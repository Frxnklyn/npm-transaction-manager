import type { TrackedFile } from "./TrackedFile.js";
import type { UpdaterInterface } from "./UpdaterInterface.js";

export class Updater implements UpdaterInterface {
  private isAutoupdate: boolean;
  private files: TrackedFile[] = [];

  constructor(isAutoupdate = true) {
    this.isAutoupdate = isAutoupdate;
    return this;
  }

  enableAutoupdate(): this {
    this.isAutoupdate = true;
    return this;
  }

  disableAutoupdate(): this {
    this.isAutoupdate = false;
    return this;
  }

  getIsAutoupdate(): boolean {
    return this.isAutoupdate;
  }

  shouldUpdate(): boolean {
    return this.getIsAutoupdate();
  }

  getValue(): boolean {
    return this.getIsAutoupdate();
  }

  getTrackedFiles(): readonly TrackedFile[] {
    return this.files;
  }

  addFile(file: TrackedFile): this {
    this.files.push(file);
    return this;
  }

  removeFile(file: TrackedFile): this {
    this.files = this.files.filter((trackedFile) => trackedFile !== file);
    return this;
  }
}
