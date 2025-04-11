import {
  isGitRepository,
  createSnapshot,
  revertFile,
  getFileHistory,
  getRepositoryRoot,
  revertCommit,
} from "../tools/git.js";

import {
  IsGitRepositoryArgsSchema,
  CreateSnapshotArgsSchema,
  RevertFileArgsSchema,
  GetFileHistoryArgsSchema,
} from "../tools/schemas.js";

import { ServerResult } from "../types.js";
import { capture } from "../utils.js";
import { createErrorResponse } from "../error-handlers.js";
import {
  createSnapshotsForPendingChanges,
  hasPendingChanges,
  getPendingChangesSummary,
} from "../tools/batch-operations.js";

/**
 * Handle is_git_repository command
 */
export async function handleIsGitRepository(
  args: unknown
): Promise<ServerResult> {
  try {
    const parsed = IsGitRepositoryArgsSchema.parse(args);
    const result = await isGitRepository(parsed.path);
    return {
      content: [{ type: "text", text: String(result) }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(errorMessage);
  }
}

/**
 * Handle create_snapshot command
 */
export async function handleCreateSnapshot(
  args: unknown
): Promise<ServerResult> {
  try {
    const parsed = CreateSnapshotArgsSchema.parse(args);
    const commitHash = await createSnapshot(parsed.path, parsed.message);

    if (commitHash) {
      return {
        content: [
          {
            type: "text",
            text: `Successfully created snapshot with commit hash: ${commitHash}`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `Could not create snapshot. The file may not be in a git repository.`,
          },
        ],
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(errorMessage);
  }
}

/**
 * Handle revert_file command
 */
export async function handleRevertFile(args: unknown): Promise<ServerResult> {
  try {
    const parsed = RevertFileArgsSchema.parse(args);

    if (parsed.revertAllFiles) {
      // For reverting all files, we need the repository root
      if (await isGitRepository(parsed.path)) {
        const repoRoot = await getRepositoryRoot(parsed.path);
        await revertCommit(repoRoot, parsed.commitHash);

        return {
          content: [
            {
              type: "text",
              text: `Successfully reverted all changes from commit ${parsed.commitHash}`,
            },
          ],
        };
      } else {
        return createErrorResponse(
          "The specified path is not in a git repository."
        );
      }
    } else {
      // Just revert the single file
      await revertFile(parsed.path, parsed.commitHash);
      return {
        content: [
          {
            type: "text",
            text: `Successfully reverted ${parsed.path} to commit ${parsed.commitHash}`,
          },
        ],
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(errorMessage);
  }
}

/**
 * Handle get_file_history command
 */
export async function handleGetFileHistory(
  args: unknown
): Promise<ServerResult> {
  try {
    const parsed = GetFileHistoryArgsSchema.parse(args);
    const history = await getFileHistory(parsed.path, parsed.maxCount);

    if (history.length === 0) {
      return {
        content: [
          { type: "text", text: "No commit history found for this file." },
        ],
      };
    }

    const historyText = history
      .map(
        (entry) =>
          `${entry.hash} - ${entry.date} - ${entry.author}: ${entry.message}`
      )
      .join("\n");

    return {
      content: [{ type: "text", text: historyText }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(errorMessage);
  }
}

/**
 * Handle force_create_snapshots command
 */
export async function handleForceCreateSnapshots(
  args: unknown
): Promise<ServerResult> {
  try {
    // Check if there are any pending changes
    if (!hasPendingChanges()) {
      return {
        content: [
          {
            type: "text",
            text: "No pending changes to snapshot.",
          },
        ],
      };
    }

    // Get a summary of pending changes for display
    const summary = getPendingChangesSummary();
    let summaryText = "Creating snapshots for pending changes:\n";

    for (const [repoRoot, files] of Object.entries(summary)) {
      summaryText += `\nRepository: ${repoRoot}\n`;
      summaryText += files.map((file) => `- ${file}`).join("\n");
    }

    // Force creating snapshots for all pending changes
    await createSnapshotsForPendingChanges("Manually triggered snapshot");

    return {
      content: [
        {
          type: "text",
          text: `${summaryText}\n\nSuccessfully created snapshots for pending changes.`,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(errorMessage);
  }
}
