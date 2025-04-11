# Implementation Plan for Desktop Commander Enhancements

This document outlines a detailed plan for implementing three key enhancements to the DesktopCommanderMCP project:

1. State Management: Re-reading files before editing
2. Git Integration: Implementing version control operations
3. VSCode Extension: Creating a diff viewing and selective application tool

## Phase 1: State Management Enhancement

**Objective**: Ensure Claude always works with the latest file version by re-reading files before modification.

### Step 1: Identify File Modification Points

- [ ] Review the codebase to identify all handlers that modify files:
  - Check in `src/tools/edit.ts` and `src/handlers/edit-search-handlers.ts`
  - Look at `writeFile` function in `src/tools/filesystem.ts`
  - Check `handleWriteFile` in `src/handlers/filesystem-handlers.ts`
  - Look at `performSearchReplace` in `src/tools/edit.ts`

### Step 2: Implement Pre-Edit File Reading

- [ ] Modify the `handleEditBlock` handler to read the current file content first:

  ```typescript
  // In src/handlers/edit-search-handlers.ts
  export async function handleEditBlock(args: unknown): Promise<ServerResult> {
    const parsed = EditBlockArgsSchema.parse(args);
    const { filePath, searchReplace, error } = await parseEditBlock(
      parsed.blockContent
    );

    if (error) {
      return createErrorResponse(error);
    }

    // Add this: Read current file content before applying changes
    try {
      await readFile(filePath, false);
      // File exists, continue with edit
    } catch (error) {
      return createErrorResponse(
        `File ${filePath} could not be read: ${error}`
      );
    }

    return performSearchReplace(filePath, searchReplace);
  }
  ```

- [ ] Modify the `performSearchReplace` function to handle content mismatches:

  ```typescript
  // In src/tools/edit.ts
  export async function performSearchReplace(
    filePath: string,
    block: SearchReplace
  ): Promise<ServerResult> {
    // Read file as plain string
    const content = await readFile(filePath);

    // Make sure content is a string
    const contentStr = typeof content === "string" ? content : content.content;

    // Find first occurrence
    const searchIndex = contentStr.indexOf(block.search);
    if (searchIndex === -1) {
      // Add this: Check for fuzzy matches if exact match isn't found
      // This could help detect if the file has been modified externally
      return {
        content: [
          {
            type: "text",
            text: `Search content not found in ${filePath}. The file may have been modified since Claude last saw it.`,
          },
        ],
        isError: true,
      };
    }

    // Replace content
    const newContent =
      contentStr.substring(0, searchIndex) +
      block.replace +
      contentStr.substring(searchIndex + block.search.length);

    await writeFile(filePath, newContent);

    return {
      content: [
        { type: "text", text: `Successfully applied edit to ${filePath}` },
      ],
    };
  }
  ```

- [ ] Modify the `handleWriteFile` handler similarly:

  ```typescript
  // In src/handlers/filesystem-handlers.ts
  export async function handleWriteFile(args: unknown): Promise<ServerResult> {
    try {
      const parsed = WriteFileArgsSchema.parse(args);

      // Add this: Check if file exists first
      let fileExists = false;
      let currentContent = "";
      try {
        const result = await readFile(parsed.path);
        fileExists = true;
        currentContent = typeof result === "string" ? result : result.content;
      } catch (error) {
        // File doesn't exist yet, that's okay
        fileExists = false;
      }

      // If file exists, log info about overwriting
      if (fileExists) {
        console.log(`File ${parsed.path} exists and will be updated.`);
      }

      await writeFile(parsed.path, parsed.content);

      return {
        content: [
          {
            type: "text",
            text: fileExists
              ? `Successfully updated ${parsed.path}`
              : `Successfully created ${parsed.path}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return createErrorResponse(errorMessage);
    }
  }
  ```

### Step 3: Add Conflict Detection

- [ ] Add function to detect file changes in `src/tools/filesystem.ts`:

  ```typescript
  /**
   * Detects significant differences between expected and actual file content
   */
  export async function detectFileChanges(
    filePath: string,
    expectedContent: string
  ): Promise<boolean> {
    try {
      const currentContent = await readFile(filePath);
      const contentStr =
        typeof currentContent === "string"
          ? currentContent
          : currentContent.content;

      // Simple detection - check if files are different
      return contentStr !== expectedContent;
    } catch (error) {
      return false; // File doesn't exist
    }
  }
  ```

### Step 4: Notify About Changes

- [ ] Modify handlers to inform Claude about detected changes:
  ```typescript
  // Add to handlers when file changes are detected
  return {
    content: [
      {
        type: "text",
        text: "The file has been modified since Claude last saw it. Changes have been applied to the current version.",
      },
    ],
  };
  ```

### Step 5: Testing

- [ ] Write tests for file re-reading functionality
- [ ] Test manually by modifying files between Claude operations
- [ ] Verify correct behavior when files are unchanged and when changed

## Phase 2: Git Integration

**Objective**: Implement Git operations to enable version control and code reverting capabilities.

### Step 1: Add Dependencies

- [ ] Add simple-git package to the project:
  ```bash
  npm install --save simple-git
  npm install --save-dev @types/simple-git
  ```

### Step 2: Create Git Tools Module

- [ ] Create a new file `src/tools/git.ts`:

  ```typescript
  import simpleGit, { SimpleGit } from "simple-git";
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
      await git.revert([commitHash]);

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
  ```

### Step 3: Create Git Schema Definitions

- [ ] Add Zod schemas for Git operations in `src/tools/schemas.ts`:

  ```typescript
  // Git tools schemas
  export const IsGitRepositoryArgsSchema = z.object({
    path: z.string(),
  });

  export const CreateSnapshotArgsSchema = z.object({
    path: z.string(),
    message: z.string(),
  });

  export const RevertFileArgsSchema = z.object({
    path: z.string(),
    commitHash: z.string(),
    revertAllFiles: z.boolean().optional().default(false),
  });

  export const GetFileHistoryArgsSchema = z.object({
    path: z.string(),
    maxCount: z.number().optional(),
  });
  ```

### Step 4: Create Git Handlers

- [ ] Create a new file `src/handlers/git-handlers.ts`:

  ```typescript
  import {
    isGitRepository,
    createSnapshot,
    revertFile,
    getFileHistory,
    getRepositoryRoot,
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return createErrorResponse(errorMessage);
    }
  }
  ```

### Step 5: Register Git Handlers in server.ts

- [ ] Update `src/server.ts` to include the new Git tools:

  ```typescript
  // Add to tools list
  {
    name: "is_git_repository",
    description:
      "Check if a path is inside a git repository.",
    inputSchema: zodToJsonSchema(IsGitRepositoryArgsSchema),
  },
  {
    name: "create_snapshot",
    description:
      "Create a git commit snapshot of the current state of a file.",
    inputSchema: zodToJsonSchema(CreateSnapshotArgsSchema),
  },
  {
    name: "revert_file",
    description:
      "Revert a file to a previous git commit state. When revertAllFiles is true, reverts all files changed in the commit.",
    inputSchema: zodToJsonSchema(RevertFileArgsSchema),
  },
  {
    name: "get_file_history",
    description:
      "Get the git commit history for a file.",
    inputSchema: zodToJsonSchema(GetFileHistoryArgsSchema),
  },
  ```

- [ ] Register the handler functions in the request handler callback:

  ```typescript
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      // Add to the tools object
      const tools = {
        // Existing tools...

        // Git tools
        is_git_repository: handleIsGitRepository,
        create_snapshot: handleCreateSnapshot,
        revert_file: handleRevertFile,
        get_file_history: handleGetFileHistory,
      };

      // Existing implementation...
    }
  );
  ```

### Step 6: Integrate with Edit Operations

- [ ] Modify edit handlers to create snapshots before changes:

  ```typescript
  // In edit-search-handlers.ts - handleEditBlock
  import { isGitRepository, createSnapshot } from "../tools/git.js";

  export async function handleEditBlock(args: unknown): Promise<ServerResult> {
    const parsed = EditBlockArgsSchema.parse(args);
    const { filePath, searchReplace, error } = await parseEditBlock(
      parsed.blockContent
    );

    if (error) {
      return createErrorResponse(error);
    }

    // Read current file content
    let currentContent = "";
    try {
      const result = await readFile(filePath);
      currentContent = typeof result === "string" ? result : result.content;
    } catch (error) {
      return createErrorResponse(
        `File ${filePath} could not be read: ${error}`
      );
    }

    // Find where to apply the change
    const searchIndex = currentContent.indexOf(searchReplace.search);
    if (searchIndex === -1) {
      return createErrorResponse(
        `Search content not found in ${filePath}. The file may have been modified.`
      );
    }

    // Prepare the modified content
    const modifiedContent =
      currentContent.substring(0, searchIndex) +
      searchReplace.replace +
      currentContent.substring(searchIndex + searchReplace.search.length);

    // Create a diff for VSCode instead of directly applying
    try {
      const diffId = await notifyVSCodeOfDiff(
        filePath,
        currentContent,
        modifiedContent,
        `Edit block changes for ${filePath}`
      );

      // Apply changes directly too (could be made configurable)
      await writeFile(filePath, modifiedContent);

      return {
        content: [
          {
            type: "text",
            text: `Applied changes to ${filePath}. Diff ID: ${diffId}. Run 'desktop-commander-vscode.showDiff ${diffId}' in VSCode to review.`,
          },
        ],
      };
    } catch (error) {
      // If VSCode integration fails, fall back to direct application
      await writeFile(filePath, modifiedContent);
      return {
        content: [
          {
            type: "text",
            text: `Applied changes to ${filePath}. VSCode integration failed: ${error}`,
          },
        ],
      };
    }
  }
  ```

### Step 7: Testing

- [ ] Write tests for Git operations
- [ ] Test on files in Git repositories
- [ ] Test creating snapshots, viewing history, and reverting files

## Phase 3: VSCode Extension

**Objective**: Create a VSCode extension that works with Desktop Commander to show diffs and allow selective application of changes, including support for multi-file diffs.

### Step 1: Set Up Extension Project

- [ ] Create a new VSCode extension project:
  ```bash
  npm install -g yo generator-code
  yo code
  ```
  - Select "New Extension (TypeScript)"
  - Name it "desktop-commander-vscode"
  - Add necessary metadata

### Step 2: Define Communication Protocol

- [ ] Create a new file `src/vscode-integration.ts` for the integration server:

  ```typescript
  import * as http from "http";
  import * as fs from "fs/promises";
  import * as path from "path";
  import { z } from "zod";
  import { capture } from "./utils.js";

  const PORT = 8732; // Arbitrary port

  // Define Zod schema for individual file diff
  const FileDiffSchema = z.object({
    originalFile: z.string(),
    modifiedContent: z.string(),
  });

  // Define Zod schema for multi-file diff requests
  const DiffRequestSchema = z.object({
    description: z.string(),
    files: z.array(FileDiffSchema),
  });

  type DiffRequest = z.infer<typeof DiffRequestSchema>;

  // Track active diff requests
  const diffRequests: Record<string, DiffRequest> = {};

  // Generate a unique ID for each diff request
  function generateDiffId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  export function startVSCodeIntegrationServer() {
    const server = http.createServer((req, res) => {
      // Set CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Handle POST request to create a new diff
      if (req.method === "POST" && req.url === "/diff") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const parsedData = JSON.parse(body);
            const parseResult = DiffRequestSchema.safeParse(parsedData);

            if (!parseResult.success) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: "Invalid request format",
                  details: parseResult.error.format(),
                })
              );
              return;
            }

            const diffRequest = parseResult.data;
            const diffId = generateDiffId();
            diffRequests[diffId] = diffRequest;

            capture("vscode_diff_created", {
              diffId,
              fileCount: diffRequest.files.length,
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ diffId }));
          } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid request" }));
          }
        });
        return;
      }

      // Handle GET request to fetch a diff
      if (req.method === "GET" && req.url?.startsWith("/diff/")) {
        const diffId = req.url.substring(6);
        const diffRequest = diffRequests[diffId];

        if (diffRequest) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(diffRequest));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Diff not found" }));
        }
        return;
      }

      // Handle all other requests
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    server.listen(PORT, () => {
      console.log(`VSCode integration server running on port ${PORT}`);
    });

    return server;
  }

  // Function to notify VSCode about a pending multi-file diff
  export async function notifyVSCodeOfMultiFileDiff(
    fileDiffs: Array<{
      filePath: string;
      originalContent: string;
      modifiedContent: string;
    }>,
    description: string
  ): Promise<string> {
    // Prepare the files array for the diff request
    const files = [];

    // Process each file diff
    for (const diff of fileDiffs) {
      const { filePath, originalContent, modifiedContent } = diff;

      // Check if current file content matches original content
      let currentContent = "";
      try {
        currentContent = await fs.readFile(filePath, "utf8");
      } catch (error) {
        // File might not exist
      }

      // Create diff files
      const originalFilePath = path.join(
        path.dirname(filePath),
        `${path.basename(filePath)}.original`
      );

      const modifiedFilePath = path.join(
        path.dirname(filePath),
        `${path.basename(filePath)}.modified`
      );

      // If current content doesn't match original content from Claude's perspective
      if (currentContent !== originalContent) {
        // Save original content as reference
        await fs.writeFile(originalFilePath, originalContent);
      }

      // Write out the modified content to a temporary file
      await fs.writeFile(modifiedFilePath, modifiedContent);

      // Add to files array
      files.push({
        originalFile: filePath,
        modifiedContent,
      });
    }

    // Save diff information
    const diffId = generateDiffId();
    diffRequests[diffId] = {
      description,
      files,
    };

    console.log(`Created multi-file diff ${diffId} with ${files.length} files`);
    console.log(
      `Run 'desktop-commander-vscode.showDiff ${diffId}' command in VSCode to view and apply changes`
    );

    return diffId;
  }

  // Backward compatibility for single file diffs
  export async function notifyVSCodeOfDiff(
    filePath: string,
    originalContent: string,
    modifiedContent: string,
    description: string
  ): Promise<string> {
    return notifyVSCodeOfMultiFileDiff(
      [
        {
          filePath,
          originalContent,
          modifiedContent,
        },
      ],
      description
    );
  }
  ```

### Step 3: Create VSCode Extension Core

- [ ] Implement the main extension functionality with multi-file support:

  ```typescript
  // In VSCode extension project: src/extension.ts
  import * as vscode from "vscode";
  import * as fs from "fs";
  import * as path from "path";
  import axios from "axios";

  const DESKTOP_COMMANDER_URL = "http://localhost:8732";

  export function activate(context: vscode.ExtensionContext) {
    console.log("Desktop Commander VSCode extension is now active");

    // Register command to show diff by ID
    let disposable = vscode.commands.registerCommand(
      "desktop-commander-vscode.showDiff",
      async (diffId: string) => {
        // If no diffId was provided, ask the user
        if (!diffId) {
          diffId =
            (await vscode.window.showInputBox({
              placeHolder: "Enter the diff ID provided by Desktop Commander",
            })) || "";

          if (!diffId) {
            vscode.window.showErrorMessage("No diff ID provided");
            return;
          }
        }

        try {
          // Fetch diff information
          const response = await axios.get(
            `${DESKTOP_COMMANDER_URL}/diff/${diffId}`
          );
          const diffInfo = response.data;

          const { description, files } = diffInfo;

          if (!files || !Array.isArray(files) || files.length === 0) {
            vscode.window.showErrorMessage("Invalid diff data: No files found");
            return;
          }

          // Show information message with description
          vscode.window.showInformationMessage(
            `Claude's proposed changes: ${description}`
          );

          // Handle multi-file diffs
          if (files.length === 1) {
            // Single file case
            await showSingleFileDiff(files[0]);
          } else {
            // Multi-file case
            await showMultiFileDiff(files, description);
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Error fetching diff: ${error}`);
        }
      }
    );

    context.subscriptions.push(disposable);
  }

  // Helper function to show diff for a single file
  async function showSingleFileDiff(fileDiff: any) {
    const { originalFile, modifiedContent } = fileDiff;

    // Get current file content
    let currentContent = "";
    try {
      currentContent = fs.readFileSync(originalFile, "utf8");
    } catch (error) {
      vscode.window.showErrorMessage(`Could not read file: ${originalFile}`);
      return;
    }

    // Create temp file with modified content
    const tempFile = path.join(
      path.dirname(originalFile),
      `${path.basename(originalFile)}.claude-modified`
    );
    fs.writeFileSync(tempFile, modifiedContent);

    // Show diff
    const uri1 = vscode.Uri.file(originalFile);
    const uri2 = vscode.Uri.file(tempFile);

    // Show diff view
    await vscode.commands.executeCommand(
      "vscode.diff",
      uri1,
      uri2,
      `Current vs Claude's Proposed Changes: ${path.basename(originalFile)}`
    );

    // Ask if user wants to apply changes
    const choice = await vscode.window.showQuickPick(
      ["Apply Changes", "Reject Changes"],
      { placeHolder: "What would you like to do with Claude's changes?" }
    );

    if (choice === "Apply Changes") {
      // Apply changes
      fs.writeFileSync(originalFile, modifiedContent);
      vscode.window.showInformationMessage("Changes applied successfully");

      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (error) {
        // Ignore cleanup errors
      }
    } else {
      vscode.window.showInformationMessage("Changes rejected");

      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }

  // Helper function to show diff for multiple files
  async function showMultiFileDiff(files: any[], description: string) {
    // Create list of files with their status
    const fileItems = files.map((file) => ({
      label: path.basename(file.originalFile),
      description: file.originalFile,
      picked: true, // Default to selected
      file,
    }));

    // Let user select which files to review
    const selectedItems = await vscode.window.showQuickPick(fileItems, {
      canPickMany: true,
      placeHolder: "Select files to review (all files selected by default)",
    });

    if (!selectedItems || selectedItems.length === 0) {
      vscode.window.showInformationMessage("No files selected for review");
      return;
    }

    // Track which files were approved
    const approvedFiles = new Set<string>();

    // Show diff for each selected file
    for (const item of selectedItems) {
      const { originalFile, modifiedContent } = item.file;

      // Get current file content
      let currentContent = "";
      try {
        currentContent = fs.readFileSync(originalFile, "utf8");
      } catch (error) {
        vscode.window.showErrorMessage(`Could not read file: ${originalFile}`);
        continue;
      }

      // Create temp file with modified content
      const tempFile = path.join(
        path.dirname(originalFile),
        `${path.basename(originalFile)}.claude-modified`
      );
      fs.writeFileSync(tempFile, modifiedContent);

      // Show diff view
      const uri1 = vscode.Uri.file(originalFile);
      const uri2 = vscode.Uri.file(tempFile);

      await vscode.commands.executeCommand(
        "vscode.diff",
        uri1,
        uri2,
        `File ${selectedItems.indexOf(item) + 1}/${
          selectedItems.length
        }: ${path.basename(originalFile)}`
      );

      // Ask if user wants to apply changes to this file
      const choice = await vscode.window.showQuickPick(
        ["Apply Changes", "Reject Changes", "Skip (decide later)"],
        { placeHolder: `Apply changes to ${path.basename(originalFile)}?` }
      );

      if (choice === "Apply Changes") {
        // Apply changes to this file
        fs.writeFileSync(originalFile, modifiedContent);
        approvedFiles.add(originalFile);

        // Clean up temp file
        try {
          fs.unlinkSync(tempFile);
        } catch (error) {
          // Ignore cleanup errors
        }
      } else if (choice === "Reject Changes") {
        // Clean up temp file only
        try {
          fs.unlinkSync(tempFile);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      // For "Skip", we just continue to the next file
    }

    // Final summary
    if (approvedFiles.size > 0) {
      vscode.window.showInformationMessage(
        `Applied changes to ${approvedFiles.size} of ${selectedItems.length} files`
      );
    } else {
      vscode.window.showInformationMessage("No changes were applied");
    }
  }
  ```

### Step 4: Update VSCode Extension Manifest

- [ ] Configure package.json for the extension:
  ```json
  {
    "name": "desktop-commander-vscode",
    "displayName": "Desktop Commander Integration",
    "description": "Integration with Claude's Desktop Commander MCP",
    "version": "0.0.1",
    "engines": {
      "vscode": "^1.60.0"
    },
    "categories": ["Other"],
    "activationEvents": ["onCommand:desktop-commander-vscode.showDiff"],
    "main": "./out/extension.js",
    "contributes": {
      "commands": [
        {
          "command": "desktop-commander-vscode.showDiff",
          "title": "Desktop Commander: Show Diff"
        }
      ],
      "keybindings": [
        {
          "command": "desktop-commander-vscode.showDiff",
          "key": "ctrl+shift+d",
          "mac": "cmd+shift+d",
          "when": "editorTextFocus"
        }
      ]
    },
    "scripts": {
      "vscode:prepublish": "npm run compile",
      "compile": "tsc -p ./",
      "watch": "tsc -watch -p ./",
      "test": "node ./out/test/runTest.js"
    },
    "dependencies": {
      "axios": "^0.27.2"
    }
  }
  ```

### Step 5: Add Schemas for VSCode Integration

- [ ] Add schema for VSCode diff in `src/tools/schemas.ts`:

  ```typescript
  // Single file diff schema
  export const FileDiffSchema = z.object({
    filePath: z.string(),
    originalContent: z.string(),
    modifiedContent: z.string(),
  });

  // Multi-file diff schema
  export const CreateMultiFileDiffArgsSchema = z.object({
    files: z.array(FileDiffSchema),
    description: z.string().optional(),
  });

  // For backward compatibility
  export const CreateDiffArgsSchema = z.object({
    path: z.string(),
    originalContent: z.string(),
    modifiedContent: z.string(),
    description: z.string().optional(),
  });
  ```

### Step 6: Create VSCode Integration Handler

- [ ] Add handlers for creating diffs in a new file `src/handlers/vscode-handlers.ts`:

  ```typescript
  import { ServerResult } from "../types.js";
  import {
    CreateDiffArgsSchema,
    CreateMultiFileDiffArgsSchema,
  } from "../tools/schemas.js";
  import {
    notifyVSCodeOfDiff,
    notifyVSCodeOfMultiFileDiff,
  } from "../vscode-integration.js";
  import { createErrorResponse } from "../error-handlers.js";

  /**
   * Handle create_diff command (single file)
   */
  export async function handleCreateDiff(args: unknown): Promise<ServerResult> {
    try {
      const parsed = CreateDiffArgsSchema.parse(args);
      const diffId = await notifyVSCodeOfDiff(
        parsed.path,
        parsed.originalContent,
        parsed.modifiedContent,
        parsed.description || `Changes to ${parsed.path}`
      );

      return {
        content: [
          {
            type: "text",
            text: `Created diff with ID ${diffId}. Run 'desktop-commander-vscode.showDiff ${diffId}' in VSCode to view and apply changes.`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return createErrorResponse(errorMessage);
    }
  }

  /**
   * Handle create_multi_file_diff command
   */
  export async function handleCreateMultiFileDiff(
    args: unknown
  ): Promise<ServerResult> {
    try {
      const parsed = CreateMultiFileDiffArgsSchema.parse(args);

      // Transform to the format expected by notifyVSCodeOfMultiFileDiff
      const fileDiffs = parsed.files.map((file) => ({
        filePath: file.filePath,
        originalContent: file.originalContent,
        modifiedContent: file.modifiedContent,
      }));

      const diffId = await notifyVSCodeOfMultiFileDiff(
        fileDiffs,
        parsed.description || `Multi-file changes (${fileDiffs.length} files)`
      );

      return {
        content: [
          {
            type: "text",
            text: `Created multi-file diff with ID ${diffId} containing ${fileDiffs.length} files. Run 'desktop-commander-vscode.showDiff ${diffId}' in VSCode to view and apply changes.`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return createErrorResponse(errorMessage);
    }
  }
  ```

- [ ] Register the new tools in `src/server.ts`:

  ```typescript
  // Add to tools list
  {
    name: "create_diff",
    description:
      "Create a diff for a single file for VSCode to display and potentially apply.",
    inputSchema: zodToJsonSchema(CreateDiffArgsSchema),
  },
  {
    name: "create_multi_file_diff",
    description:
      "Create a diff for multiple files for VSCode to display and potentially apply.",
    inputSchema: zodToJsonSchema(CreateMultiFileDiffArgsSchema),
  },
  ```

- [ ] Add to the tools handler

  ```typescript
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      // Add to the tools object
      const tools = {
        // Existing tools...

        // VSCode integration
        create_diff: handleCreateDiff,
        create_multi_file_diff: handleCreateMultiFileDiff,
      };

      // Existing implementation...
    }
  );
  ```

### Step 7: Documentation

- [ ] Create documentation for users on how to use the VSCode integration:

  ```markdown
  # Desktop Commander VSCode Integration

  This extension allows you to view and selectively apply changes made by Claude through Desktop Commander.

  ## Usage

  1. When Claude makes changes through Desktop Commander, it will provide a Diff ID
  2. In VSCode, run the command "Desktop Commander: Show Diff" (Ctrl+Shift+P or Cmd+Shift+D)
  3. Enter the Diff ID when prompted
  4. A diff view will open showing the changes Claude has made

  ### Single File Changes

  - For single file changes, you'll be shown the diff and can choose to apply or reject changes

  ### Multi-file Changes

  - For multi-file changes, you'll first select which files to review
  - Each file will be presented sequentially for review
  - For each file, you can choose to:
    - Apply Changes: Accept the changes for this file
    - Reject Changes: Discard the changes for this file
    - Skip: Move to the next file without deciding yet
  ```

### Step 8: Testing Multi-file Functionality

- [ ] Test the multi-file integration end-to-end:
  - Make changes to multiple files through Claude using Desktop Commander
  - Verify that a diff ID is provided with multiple files
  - Use the VSCode extension to view and selectively apply changes
  - Verify that changes are correctly applied or rejected for each file

## Integration and Final Steps

### Step 1: Update README

- [ ] Update the main project README to include information about the new features:

  ```markdown
  ## New Features

  ### State Management

  Claude now re-reads files before editing them, ensuring that any manual changes you've made are preserved.

  ### Git Integration

  Desktop Commander now supports Git operations:

  - `is_git_repository`: Check if a path is in a Git repository
  - `create_snapshot`: Create a Git commit to save the current state
  - `revert_file`: Revert a file to a previous state
  - `get_file_history`: View the commit history for a file

  ### VSCode Integration

  A new VSCode extension allows you to view and selectively apply changes made by Claude:

  1. Install the "Desktop Commander Integration" extension in VSCode
  2. When Claude makes changes, it will provide a Diff ID
  3. Run the command "Desktop Commander: Show Diff" in VSCode
  4. Enter the Diff ID to view and apply or reject changes
  ```

### Step 2: Testing All Features Together

- [ ] Test the integration of all new features:
  - Make changes to a file outside of Claude
  - Have Claude make further changes
  - Verify Claude preserves your changes
  - Check that a Git snapshot is created
  - View and apply the changes through VSCode
  - Try reverting to a previous state

### Step 3: Release

- [ ] Create a release branch
- [ ] Update version numbers
- [ ] Create release notes
- [ ] Create GitHub release
- [ ] Publish VSCode extension to the marketplace

## Timeline Estimate

- Phase 1 (State Management): 1-2 days
- Phase 2 (Git Integration): 2-3 days
- Phase 3 (VSCode Extension): 3-5 days
- Integration and Testing: 2-3 days

Total: 8-13 days of development time

## Resources Required

- Node.js development environment
- VSCode for extension development
- Git knowledge
- TypeScript proficiency
- Desktop Commander codebase understanding
