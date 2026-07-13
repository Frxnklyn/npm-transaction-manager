/** Describes a file that can be tracked by an updater. */
export interface TrackedFile {
  /** Optionally returns the display name of the file. */
  getName?(): string;
}
