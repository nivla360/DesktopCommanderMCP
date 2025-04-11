import { simpleGit, SimpleGit } from "simple-git";
import { capture } from "../utils.js";

// Get git instance for a specific path
export function getGit(workingDir: string): SimpleGit {
  return simpleGit(workingDir);
}

// Check if path is in a git repository
export async function isGitRepository(path: string): Promise<boolean> {
  try {
    const git = getGit(path);
    await git.revparse(["--is-inside-work-tree"]);
    return true;
  } catch (error) {
    capture("git_operation_error", {
      operation: "isGitRepository",
      error: String(error),
    });
    return false;
  }
}

// Get repository root
export async function getRepositoryRoot(path: string): Promise<string> {
  try {
    const git = getGit(path);
    const result = await git.revparse(["--show-toplevel"]);
    return result.trim();
  } catch (error) {
    capture("git_operation_error", {
      operation: "getRepositoryRoot",
      error: String(error),
    });
    throw error;
  }
}

// Commit changes
export async function commitChanges(
  repoPath: string,
  files: string[],
  message: string
): Promise<string> {
  try {
    const git = getGit(repoPath);
    await git.add(files);
    const commitResult = await git.commit(message);
    return commitResult.commit;
  } catch (error) {
    capture("git_operation_error", {
      operation: "commitChanges",
      error: String(error),
    });
    throw error;
  }
}

// Create snapshot before making changes
export async function createSnapshot(
  filePath: string,
  message: string
): Promise<string | null> {
  try {
    if (await isGitRepository(filePath)) {
      const repoRoot = await getRepositoryRoot(filePath);
      // Get relative path within the repo
      const relativePath = filePath.replace(repoRoot + "/", "");
      return await commitChanges(repoRoot, [relativePath], message);
    }
    return null;
  } catch (error) {
    capture("git_operation_error", {
      operation: "createSnapshot",
      error: String(error),
    });
    console.error(`Git snapshot error: ${error}`);
    return null;
  }
}

// Revert to a specific commit
export async function revertToCommit(
  repoPath: string,
  commitHash: string
): Promise<void> {
  try {
    const git = getGit(repoPath);
    await git.reset(["--hard", commitHash]);
  } catch (error) {
    capture("git_operation_error", {
      operation: "revertToCommit",
      error: String(error),
    });
    throw error;
  }
}

// Revert a specific file to a previous state
export async function revertFile(
  filePath: string,
  commitHash: string
): Promise<void> {
  try {
    if (await isGitRepository(filePath)) {
      const repoRoot = await getRepositoryRoot(filePath);
      const git = getGit(repoRoot);
      // Get relative path within the repo
      const relativePath = filePath.replace(repoRoot + "/", "");
      await git.checkout([commitHash, "--", relativePath]);
    }
  } catch (error) {
    capture("git_operation_error", {
      operation: "revertFile",
      error: String(error),
    });
    console.error(`Git revert error: ${error}`);
    throw error;
  }
}

// Get commit history for a file
export async function getFileHistory(
  filePath: string,
  maxCount = 10
): Promise<any[]> {
  try {
    if (await isGitRepository(filePath)) {
      const repoRoot = await getRepositoryRoot(filePath);
      const git = getGit(repoRoot);
      const relativePath = filePath.replace(repoRoot + "/", "");

      const logOptions = [
        "--max-count=" + maxCount,
        '--pretty=format:{"hash":"%h","date":"%ad","message":"%s","author":"%an"}',
        "--date=iso",
        "--",
        relativePath,
      ];

      const logs = await git.log(logOptions);
      return logs.all.map((commit) => JSON.parse(commit.hash));
    }
    return [];
  } catch (error) {
    capture("git_operation_error", {
      operation: "getFileHistory",
      error: String(error),
    });
    console.error(`Git log error: ${error}`);
    return [];
  }
}

// Revert all changes from a specific commit
export async function revertCommit(
  repoPath: string,
  commitHash: string
): Promise<void> {
  try {
    const git = getGit(repoPath);

    // Create a revert commit that reverts all changes from the specified commit
    await git.revert(commitHash);

    capture("git_operation_success", {
      operation: "revertCommit",
      commitHash,
    });
  } catch (error) {
    capture("git_operation_error", {
      operation: "revertCommit",
      error: String(error),
    });
    console.error(`Git revert commit error: ${error}`);
    throw error;
  }
}
