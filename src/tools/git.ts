import { capture } from "../utils.js";
import { execCommand } from "../utils.js";

// Check if path is in a git repository
export async function isGitRepository(path: string): Promise<boolean> {
  console.log(`[DEBUG] Checking if ${path} is a Git repository`);
  try {
    console.log(`[DEBUG] Running git rev-parse to check if in Git workspace`);
    await execCommand("git rev-parse --is-inside-work-tree", path);
    console.log(`[DEBUG] Path ${path} is in a Git repository`);
    return true;
  } catch (error) {
    console.log(`[DEBUG] Path ${path} is not in a Git repository: ${error}`);
    capture("git_operation_error", {
      operation: "isGitRepository",
      error: String(error),
    });
    return false;
  }
}

// Get repository root
export async function getRepositoryRoot(path: string): Promise<string> {
  console.log(`[DEBUG] Getting repository root for ${path}`);
  try {
    console.log(`[DEBUG] Running git rev-parse to get repository root`);
    const result = await execCommand("git rev-parse --show-toplevel", path);
    console.log(`[DEBUG] Repository root for ${path} is ${result}`);
    return result;
  } catch (error) {
    console.error(`[ERROR] Failed to get repository root: ${error}`);
    capture("git_operation_error", {
      operation: "getRepositoryRoot",
      error: String(error),
    });
    throw error;
  }
}

// Get git status for a repository
export async function getGitStatus(repoPath: string): Promise<{
  modified: string[];
  not_added: string[];
  staged: string[];
}> {
  try {
    console.log(`[DEBUG] Getting git status for ${repoPath}`);

    // Get modified files
    const modifiedOutput = await execCommand("git diff --name-only", repoPath);
    const modified = modifiedOutput ? modifiedOutput.split("\n") : [];

    // Get untracked files
    const untrackedOutput = await execCommand(
      "git ls-files --others --exclude-standard",
      repoPath
    );
    const not_added = untrackedOutput ? untrackedOutput.split("\n") : [];

    // Get staged files
    const stagedOutput = await execCommand(
      "git diff --name-only --cached",
      repoPath
    );
    const staged = stagedOutput ? stagedOutput.split("\n") : [];

    console.log(
      `[DEBUG] Found ${modified.length} modified, ${not_added.length} untracked, and ${staged.length} staged files`
    );

    return {
      modified: modified.filter(Boolean),
      not_added: not_added.filter(Boolean),
      staged: staged.filter(Boolean),
    };
  } catch (error) {
    console.error(`[ERROR] Failed to get git status: ${error}`);
    capture("git_operation_error", {
      operation: "getGitStatus",
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
  console.log(
    `[DEBUG] Committing changes for ${files.length} files in ${repoPath}`
  );
  console.log(`[DEBUG] Files to commit: ${JSON.stringify(files)}`);
  try {
    // Add files to staging area
    console.log(`[DEBUG] Adding files to Git staging area`);
    if (files.length > 0) {
      // Quote filenames to handle spaces and special characters
      const quotedFiles = files.map((file) => `"${file}"`).join(" ");
      await execCommand(`git add ${quotedFiles}`, repoPath);
    } else {
      console.log(`[DEBUG] No files to add, skipping git add`);
    }

    // Create commit with the specified message
    console.log(`[DEBUG] Committing with message: "${message}"`);
    await execCommand(
      `git commit -m "${message.replace(/"/g, '\\"')}"`,
      repoPath
    );

    // Get the commit hash
    const commitHash = await execCommand("git rev-parse HEAD", repoPath);
    console.log(`[DEBUG] Successfully created commit: ${commitHash}`);

    return commitHash;
  } catch (error) {
    console.error(`[ERROR] Failed to commit changes: ${error}`);
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
  console.log(
    `[DEBUG] Creating snapshot for ${filePath} with message: "${message}"`
  );
  try {
    console.log(`[DEBUG] Checking if ${filePath} is in a Git repository`);
    if (await isGitRepository(filePath)) {
      console.log(`[DEBUG] Getting repository root for ${filePath}`);
      const repoRoot = await getRepositoryRoot(filePath);
      // Get relative path within the repo
      const relativePath = filePath.replace(repoRoot + "/", "");
      console.log(`[DEBUG] Relative path within repo: ${relativePath}`);
      console.log(`[DEBUG] Creating commit for snapshot`);
      return await commitChanges(repoRoot, [relativePath], message);
    }
    console.log(
      `[DEBUG] File ${filePath} is not in a Git repository, cannot create snapshot`
    );
    return null;
  } catch (error) {
    console.error(`[ERROR] Git snapshot error: ${error}`);
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
    await execCommand(`git reset --hard ${commitHash}`, repoPath);
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
      // Get relative path within the repo
      const relativePath = filePath.replace(repoRoot + "/", "");
      await execCommand(
        `git checkout ${commitHash} -- "${relativePath}"`,
        repoRoot
      );
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
      const relativePath = filePath.replace(repoRoot + "/", "");

      const format = '{"hash":"%h","date":"%ad","message":"%s","author":"%an"}';
      const command = `git log --max-count=${maxCount} --pretty=format:'${format}' --date=iso -- "${relativePath}"`;

      const output = await execCommand(command, repoRoot);
      if (!output) return [];

      return output.split("\n").map((line) => JSON.parse(line));
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
    // Create a revert commit that reverts all changes from the specified commit
    await execCommand(`git revert --no-edit ${commitHash}`, repoPath);

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
