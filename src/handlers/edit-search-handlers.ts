import { parseEditBlock } from "../tools/edit.js";
import { searchTextInFiles } from "../tools/search.js";
import {
  EditBlockArgsSchema,
  SearchCodeArgsSchema,
  WriteFileArgsSchema,
} from "../tools/schemas.js";
import { ServerResult } from "../types.js";
import { capture, withTimeout } from "../utils.js";
import { createErrorResponse } from "../error-handlers.js";
import { readFile, writeFile } from "../tools/filesystem.js";
import { isGitRepository, createSnapshot } from "../tools/git.js";
import {
  trackFileChange,
  createSnapshotsForPendingChanges,
} from "../tools/batch-operations.js";

interface SearchReplace {
  search: string;
  replace: string;
}
/**
 * Handle edit_block command
 */
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
    return createErrorResponse(`File ${filePath} could not be read: ${error}`);
  }

  return performSearchReplace(filePath, searchReplace);
}

/**
 * Handle search_code command
 */
export async function handleSearchCode(args: unknown): Promise<ServerResult> {
  const parsed = SearchCodeArgsSchema.parse(args);
  const timeoutMs = parsed.timeoutMs || 30000; // 30 seconds default

  // Apply timeout at the handler level
  const searchOperation = async () => {
    return await searchTextInFiles({
      rootPath: parsed.path,
      pattern: parsed.pattern,
      filePattern: parsed.filePattern,
      ignoreCase: parsed.ignoreCase,
      maxResults: parsed.maxResults,
      includeHidden: parsed.includeHidden,
      contextLines: parsed.contextLines,
      // Don't pass timeoutMs down to the implementation
    });
  };

  // Use withTimeout at the handler level
  const results = await withTimeout(
    searchOperation(),
    timeoutMs,
    "Code search operation",
    [] // Empty array as default on timeout
  );

  // If timeout occurred, try to terminate the ripgrep process
  if (results.length === 0 && (globalThis as any).currentSearchProcess) {
    try {
      console.log(
        `Terminating timed out search process (PID: ${
          (globalThis as any).currentSearchProcess.pid
        })`
      );
      (globalThis as any).currentSearchProcess.kill();
      delete (globalThis as any).currentSearchProcess;
    } catch (error) {
      capture("server_request_error", {
        error: "Error terminating search process",
      });
    }
  }

  if (results.length === 0) {
    if (timeoutMs > 0) {
      return {
        content: [
          {
            type: "text",
            text: `No matches found or search timed out after ${timeoutMs}ms.`,
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text: "No matches found" }],
    };
  }

  // Format the results in a VS Code-like format
  let currentFile = "";
  let formattedResults = "";

  results.forEach((result) => {
    if (result.file !== currentFile) {
      formattedResults += `\n${result.file}:\n`;
      currentFile = result.file;
    }
    formattedResults += `  ${result.line}: ${result.match}\n`;
  });

  return {
    content: [{ type: "text", text: formattedResults.trim() }],
  };
}

export async function performSearchReplace(
  filePath: string,
  block: SearchReplace
): Promise<ServerResult> {
  // Read file as plain string (don't pass true to get just the string)
  const content = await readFile(filePath);

  // Make sure content is a string
  const contentStr = typeof content === "string" ? content : content.content;

  // Find first occurrence
  const searchIndex = contentStr.indexOf(block.search);
  if (searchIndex === -1) {
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

  // Track the file for batch snapshot
  await trackFileChange(filePath);

  // Replace content
  const newContent =
    contentStr.substring(0, searchIndex) +
    block.replace +
    contentStr.substring(searchIndex + block.search.length);

  // Note: We no longer need to call createSnapshotsForPendingChanges() here
  // as it will be triggered automatically after the batch timeout

  await writeFile(filePath, newContent);

  return {
    content: [
      { type: "text", text: `Successfully applied edit to ${filePath}` },
    ],
  };
}

/**
 * Handle write_file command
 */
// export async function handleWriteFile(args: unknown): Promise<ServerResult> {
//   try {
//     const parsed = WriteFileArgsSchema.parse(args);

//     // Add this: Check if file exists first
//     let fileExists = false;
//     let currentContent = "";
//     try {
//       const result = await readFile(parsed.path);
//       fileExists = true;
//       currentContent = typeof result === "string" ? result : result.content;
//     } catch (error) {
//       // File doesn't exist yet, that's okay
//       fileExists = false;
//     }

//     // If file exists, log info about overwriting
//     if (fileExists) {
//       console.log(`File ${parsed.path} exists and will be updated.`);
//     }

//     await writeFile(parsed.path, parsed.content);

//     return {
//       content: [
//         {
//           type: "text",
//           text: fileExists
//             ? `Successfully updated ${parsed.path}`
//             : `Successfully created ${parsed.path}`,
//         },
//       ],
//     };
//   } catch (error) {
//     const errorMessage = error instanceof Error ? error.message : String(error);
//     return createErrorResponse(errorMessage);
//   }
// }

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
