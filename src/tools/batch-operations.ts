import {
  isGitRepository,
  createSnapshot,
  getRepositoryRoot,
  commitChanges,
  getGitStatus,
} from "./git.js";
import { capture } from "../utils.js";

// Track files pending changes by repository root
const pendingChangesByRepo: Record<string, Set<string>> = {};

// Track when the most recent file change was tracked
let lastTrackTimestamp = 0;
// Default timeout in ms after which snapshots are automatically created (5 seconds)
const DEFAULT_BATCH_TIMEOUT = 5000; // Reduced from 15s to 5s for testing
// Flag to indicate if a commit is in progress
let commitInProgress = false;

/**
 * Track a file that will be modified
 * @param filePath Path to the file being modified
 */
export async function trackFileChange(filePath: string): Promise<void> {
  console.log(`[DEBUG] Starting trackFileChange for ${filePath}`);

  try {
    console.log(`[DEBUG] Checking if ${filePath} is in a Git repository`);
    const isGitRepo = await isGitRepository(filePath);
    console.log(`[DEBUG] Is Git repo: ${isGitRepo}`);

    if (isGitRepo) {
      console.log(`[DEBUG] Getting repository root for ${filePath}`);
      const repoRoot = await getRepositoryRoot(filePath);
      console.log(`[DEBUG] Repository root: ${repoRoot}`);

      // Initialize the set if needed
      if (!pendingChangesByRepo[repoRoot]) {
        pendingChangesByRepo[repoRoot] = new Set<string>();
        console.log(
          `[DEBUG] Initialized new pending changes set for repo ${repoRoot}`
        );
      }

      // Add the file to the pending changes for this repo
      const relativePath = filePath.replace(repoRoot + "/", "");
      pendingChangesByRepo[repoRoot].add(relativePath);
      console.log(
        `[DEBUG] Added file ${relativePath} to pending changes for repo ${repoRoot}`
      );

      // Update the timestamp
      lastTrackTimestamp = Date.now();
      console.log(
        `[DEBUG] Updated lastTrackTimestamp to ${lastTrackTimestamp}`
      );

      console.log(
        `[DEBUG] Tracked file change: ${relativePath} in repo ${repoRoot}`
      );

      // Immediately create snapshots instead of scheduling with timeout
      // to ensure snapshots are created even if process doesn't persist
      console.log(
        `[DEBUG] Creating snapshots immediately instead of scheduling`
      );
      await createSnapshotsForPendingChanges(`Snapshot for ${relativePath}`);
    } else {
      console.log(
        `[DEBUG] File ${filePath} is not in a Git repository, skipping tracking`
      );
    }
  } catch (error) {
    console.error(`[ERROR] Error tracking file change: ${error}`);
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
  console.log(
    `[DEBUG] Scheduling snapshot creation with timeout ${timeoutMs}ms`
  );

  // Clear any existing timeout
  if (snapshotTimeoutId !== null) {
    clearTimeout(snapshotTimeoutId);
    console.log(`[DEBUG] Cleared existing snapshot timeout`);
  }

  // Schedule a new timeout
  snapshotTimeoutId = setTimeout(async () => {
    // Check if there have been no new tracked changes for the timeout period
    const timeSinceLastTrack = Date.now() - lastTrackTimestamp;
    console.log(`[DEBUG] Time since last track: ${timeSinceLastTrack}ms`);

    if (timeSinceLastTrack >= timeoutMs) {
      console.log(
        `[DEBUG] Auto-creating snapshots after ${timeoutMs}ms of inactivity`
      );
      await createSnapshotsForPendingChanges(
        "Auto-snapshot after inactivity period"
      );
    } else {
      // If there were new changes, reschedule
      console.log(
        `[DEBUG] Changes were made recently, rescheduling snapshot creation`
      );
      scheduleSnapshotCreation();
    }
  }, timeoutMs);
  console.log(`[DEBUG] Set timeout ID: ${snapshotTimeoutId}`);
}

/**
 * Count the total number of pending changes across all repositories
 */
export function countPendingChanges(): number {
  let total = 0;
  for (const files of Object.values(pendingChangesByRepo)) {
    total += files.size;
  }
  console.log(`[DEBUG] Counted ${total} pending changes`);
  return total;
}

/**
 * Check if there are any pending changes
 */
export function hasPendingChanges(): boolean {
  const hasPending = countPendingChanges() > 0;
  console.log(`[DEBUG] Has pending changes: ${hasPending}`);
  return hasPending;
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

  console.log(
    `[DEBUG] Generated summary of pending changes: ${JSON.stringify(summary)}`
  );
  return summary;
}

/**
 * Create snapshots for all pending file changes by repository
 * @param message Optional commit message
 */
export async function createSnapshotsForPendingChanges(
  message?: string
): Promise<void> {
  console.log(
    `[DEBUG] Starting createSnapshotsForPendingChanges with message: ${
      message || "none"
    }`
  );

  // If there's already a commit in progress, don't start another one
  if (commitInProgress) {
    console.log(
      `[DEBUG] Commit already in progress, skipping duplicate snapshot creation`
    );
    return;
  }

  // Set the flag to indicate a commit is starting
  commitInProgress = true;
  console.log(`[DEBUG] Set commitInProgress to true`);

  try {
    // Clear any scheduled snapshot creation
    if (snapshotTimeoutId !== null) {
      clearTimeout(snapshotTimeoutId);
      snapshotTimeoutId = null;
      console.log(`[DEBUG] Cleared scheduled snapshot timeout`);
    }

    console.log(
      `[DEBUG] Pending changes by repo: ${JSON.stringify(
        Object.keys(pendingChangesByRepo)
      )}`
    );
    for (const [repoRoot, files] of Object.entries(pendingChangesByRepo)) {
      console.log(
        `[DEBUG] Processing repo ${repoRoot} with ${files.size} files`
      );
      if (files.size > 0) {
        try {
          // Convert Set to Array
          const fileArray = Array.from(files);
          const fileCount = fileArray.length;
          console.log(
            `[DEBUG] Converted ${fileCount} files to array: ${JSON.stringify(
              fileArray
            )}`
          );

          // Create a commit message if not provided
          const commitMessage =
            message ||
            (fileCount === 1
              ? `Project snapshot before editing ${fileArray[0]}`
              : `Project snapshot before editing ${fileCount} files`);
          console.log(`[DEBUG] Using commit message: "${commitMessage}"`);

          // Get all changed files in the repository to commit the entire project state
          console.log(
            `[DEBUG] Getting status of all files in repository ${repoRoot}`
          );
          const status = await getGitStatus(repoRoot);

          // Use all changed files for the commit instead of just the tracked ones
          let allChangedFiles: string[] = [];

          // Include modified files
          if (status.modified && status.modified.length > 0) {
            console.log(
              `[DEBUG] Found ${status.modified.length} modified files`
            );
            allChangedFiles = [...allChangedFiles, ...status.modified];
          }

          // Include new files
          if (status.not_added && status.not_added.length > 0) {
            console.log(`[DEBUG] Found ${status.not_added.length} new files`);
            allChangedFiles = [...allChangedFiles, ...status.not_added];
          }

          // Include staged files
          if (status.staged && status.staged.length > 0) {
            console.log(`[DEBUG] Found ${status.staged.length} staged files`);
            allChangedFiles = [...allChangedFiles, ...status.staged];
          }

          // Remove duplicates
          allChangedFiles = [...new Set(allChangedFiles)];

          console.log(
            `[DEBUG] Committing all ${allChangedFiles.length} changed files in repo ${repoRoot}`
          );

          // If no changes detected, use the tracked files as fallback
          if (allChangedFiles.length === 0) {
            console.log(
              `[DEBUG] No changed files detected, using tracked files as fallback`
            );
            allChangedFiles = fileArray;
          }

          console.log(
            `[DEBUG] Files to commit: ${JSON.stringify(allChangedFiles)}`
          );
          const commitHash = await commitChanges(
            repoRoot,
            allChangedFiles,
            commitMessage
          );

          console.log(
            `[DEBUG] Created Git snapshot for ${allChangedFiles.length} files in repo ${repoRoot} (${commitHash})`
          );

          // Clear the tracked files for this repo
          files.clear();
          console.log(`[DEBUG] Cleared tracked files for repo ${repoRoot}`);

          capture("git_batch_snapshot", {
            repoRoot,
            fileCount: allChangedFiles.length,
            commitHash,
          });
        } catch (error) {
          console.error(
            `[ERROR] Failed to create batch Git snapshot: ${error}`
          );
          capture("git_batch_snapshot_error", {
            error: String(error),
            repoRoot,
            fileCount: files.size,
          });
        }
      } else {
        console.log(`[DEBUG] No files to snapshot for repo ${repoRoot}`);
      }
    }
  } finally {
    // Reset the flag regardless of success or failure
    commitInProgress = false;
    console.log(`[DEBUG] Reset commitInProgress to false`);
  }
}
