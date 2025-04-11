import {
  isGitRepository,
  createSnapshot,
  getRepositoryRoot,
  commitChanges,
} from "./git.js";
import { capture } from "../utils.js";

// Track files pending changes by repository root
const pendingChangesByRepo: Record<string, Set<string>> = {};

// Track when the most recent file change was tracked
let lastTrackTimestamp = 0;
// Default timeout in ms after which snapshots are automatically created (15 seconds)
const DEFAULT_BATCH_TIMEOUT = 15000;
// Flag to indicate if a commit is in progress
let commitInProgress = false;

/**
 * Track a file that will be modified
 * @param filePath Path to the file being modified
 */
export async function trackFileChange(filePath: string): Promise<void> {
  try {
    if (await isGitRepository(filePath)) {
      const repoRoot = await getRepositoryRoot(filePath);

      // Initialize the set if needed
      if (!pendingChangesByRepo[repoRoot]) {
        pendingChangesByRepo[repoRoot] = new Set<string>();
      }

      // Add the file to the pending changes for this repo
      const relativePath = filePath.replace(repoRoot + "/", "");
      pendingChangesByRepo[repoRoot].add(relativePath);

      // Update the timestamp
      lastTrackTimestamp = Date.now();

      console.log(`Tracked file change: ${relativePath} in repo ${repoRoot}`);

      // Schedule an automatic snapshot creation after timeout
      // Only schedule if no commit is in progress
      if (!commitInProgress) {
        scheduleSnapshotCreation();
      }
    }
  } catch (error) {
    console.error(`Error tracking file change: ${error}`);
    // Don't throw as this is a non-critical operation
  }
}

// Timeout ID for scheduled snapshot creation
let snapshotTimeoutId: NodeJS.Timeout | null = null;

/**
 * Schedule automatic snapshot creation after a timeout
 * @param timeoutMs Timeout in milliseconds (defaults to DEFAULT_BATCH_TIMEOUT)
 */
function scheduleSnapshotCreation(timeoutMs = DEFAULT_BATCH_TIMEOUT): void {
  // Clear any existing timeout
  if (snapshotTimeoutId !== null) {
    clearTimeout(snapshotTimeoutId);
  }

  // Schedule a new timeout
  snapshotTimeoutId = setTimeout(async () => {
    // Check if there have been no new tracked changes for the timeout period
    const timeSinceLastTrack = Date.now() - lastTrackTimestamp;
    if (timeSinceLastTrack >= timeoutMs) {
      console.log(`Auto-creating snapshots after ${timeoutMs}ms of inactivity`);
      await createSnapshotsForPendingChanges(
        "Auto-snapshot after inactivity period"
      );
    } else {
      // If there were new changes, reschedule
      scheduleSnapshotCreation();
    }
  }, timeoutMs);
}

/**
 * Count the total number of pending changes across all repositories
 */
export function countPendingChanges(): number {
  let total = 0;
  for (const files of Object.values(pendingChangesByRepo)) {
    total += files.size;
  }
  return total;
}

/**
 * Check if there are any pending changes
 */
export function hasPendingChanges(): boolean {
  return countPendingChanges() > 0;
}

/**
 * Get a summary of pending changes by repository
 */
export function getPendingChangesSummary(): Record<string, string[]> {
  const summary: Record<string, string[]> = {};

  for (const [repoRoot, files] of Object.entries(pendingChangesByRepo)) {
    if (files.size > 0) {
      summary[repoRoot] = Array.from(files);
    }
  }

  return summary;
}

/**
 * Create snapshots for all pending file changes by repository
 * @param message Optional commit message
 */
export async function createSnapshotsForPendingChanges(
  message?: string
): Promise<void> {
  // If there's already a commit in progress, don't start another one
  if (commitInProgress) {
    console.log(
      "Commit already in progress, skipping duplicate snapshot creation"
    );
    return;
  }

  // Set the flag to indicate a commit is starting
  commitInProgress = true;

  try {
    // Clear any scheduled snapshot creation
    if (snapshotTimeoutId !== null) {
      clearTimeout(snapshotTimeoutId);
      snapshotTimeoutId = null;
    }

    for (const [repoRoot, files] of Object.entries(pendingChangesByRepo)) {
      if (files.size > 0) {
        try {
          // Convert Set to Array
          const fileArray = Array.from(files);
          const fileCount = fileArray.length;

          // Create a commit message if not provided
          const commitMessage =
            message ||
            (fileCount === 1
              ? `Snapshot before editing ${fileArray[0]}`
              : `Snapshot before editing ${fileCount} files`);

          const commitHash = await commitChanges(
            repoRoot,
            fileArray,
            commitMessage
          );

          console.log(
            `Created Git snapshot for ${fileCount} files in repo ${repoRoot} (${commitHash})`
          );

          // Clear the tracked files for this repo
          files.clear();

          capture("git_batch_snapshot", {
            repoRoot,
            fileCount,
            commitHash,
          });
        } catch (error) {
          console.error(`Failed to create batch Git snapshot: ${error}`);
          capture("git_batch_snapshot_error", {
            error: String(error),
            repoRoot,
            fileCount: files.size,
          });
        }
      }
    }
  } finally {
    // Reset the flag regardless of success or failure
    commitInProgress = false;
  }
}
