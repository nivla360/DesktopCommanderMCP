import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ExecuteCommandArgsSchema,
  ReadOutputArgsSchema,
  ForceTerminateArgsSchema,
  ListSessionsArgsSchema,
  KillProcessArgsSchema,
  BlockCommandArgsSchema,
  UnblockCommandArgsSchema,
  ReadFileArgsSchema,
  ReadMultipleFilesArgsSchema,
  WriteFileArgsSchema,
  CreateDirectoryArgsSchema,
  ListDirectoryArgsSchema,
  MoveFileArgsSchema,
  SearchFilesArgsSchema,
  GetFileInfoArgsSchema,
  EditBlockArgsSchema,
  SearchCodeArgsSchema,
  // Git schemas
  IsGitRepositoryArgsSchema,
  CreateSnapshotArgsSchema,
  RevertFileArgsSchema,
  GetFileHistoryArgsSchema,
} from "./tools/schemas.js";

import { VERSION } from "./version.js";
import { capture } from "./utils.js";

export const server = new Server(
  {
    name: "desktop-commander",
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
      resources: {}, // Add empty resources capability
      prompts: {}, // Add empty prompts capability
    },
  }
);

// Add handler for resources/list method
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  // Return an empty list of resources
  return {
    resources: [],
  };
});

// Add handler for prompts/list method
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  // Return an empty list of prompts
  return {
    prompts: [],
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Terminal tools
      {
        name: "execute_command",
        description:
          "Execute a terminal command with timeout. Command will continue running in background if it doesn't complete within timeout.",
        inputSchema: zodToJsonSchema(ExecuteCommandArgsSchema),
      },
      {
        name: "read_output",
        description: "Read new output from a running terminal session.",
        inputSchema: zodToJsonSchema(ReadOutputArgsSchema),
      },
      {
        name: "force_terminate",
        description: "Force terminate a running terminal session.",
        inputSchema: zodToJsonSchema(ForceTerminateArgsSchema),
      },
      {
        name: "list_sessions",
        description: "List all active terminal sessions.",
        inputSchema: zodToJsonSchema(ListSessionsArgsSchema),
      },
      {
        name: "list_processes",
        description:
          "List all running processes. Returns process information including PID, " +
          "command name, CPU usage, and memory usage.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "kill_process",
        description:
          "Terminate a running process by PID. Use with caution as this will " +
          "forcefully terminate the specified process.",
        inputSchema: zodToJsonSchema(KillProcessArgsSchema),
      },
      {
        name: "block_command",
        description:
          "Add a command to the blacklist. Once blocked, the command cannot be executed until unblocked.",
        inputSchema: zodToJsonSchema(BlockCommandArgsSchema),
      },
      {
        name: "unblock_command",
        description:
          "Remove a command from the blacklist. Once unblocked, the command can be executed normally.",
        inputSchema: zodToJsonSchema(UnblockCommandArgsSchema),
      },
      {
        name: "list_blocked_commands",
        description: "List all currently blocked commands.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      // Filesystem tools
      {
        name: "read_file",
        description:
          "Read the complete contents of a file from the file system or a URL. " +
          "When reading from the file system, only works within allowed directories. " +
          "Can fetch content from URLs when isUrl parameter is set to true. " +
          "Handles text files normally and image files are returned as viewable images. " +
          "Recognized image types: PNG, JPEG, GIF, WebP.",
        inputSchema: zodToJsonSchema(ReadFileArgsSchema),
      },
      {
        name: "read_multiple_files",
        description:
          "Read the contents of multiple files simultaneously. " +
          "Each file's content is returned with its path as a reference. " +
          "Handles text files normally and renders images as viewable content. " +
          "Recognized image types: PNG, JPEG, GIF, WebP. " +
          "Failed reads for individual files won't stop the entire operation. " +
          "Only works within allowed directories.",
        inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema),
      },
      {
        name: "write_file",
        description:
          "Completely replace file contents. Best for large changes (>20% of file) or when edit_block fails. " +
          "Use with caution as it will overwrite existing files. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(WriteFileArgsSchema),
      },
      {
        name: "create_directory",
        description:
          "Create a new directory or ensure a directory exists. Can create multiple " +
          "nested directories in one operation. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema),
      },
      {
        name: "list_directory",
        description:
          "Get a detailed listing of all files and directories in a specified path. " +
          "Results distinguish between files and directories with [FILE] and [DIR] prefixes. " +
          "Only works within allowed directories.",
        inputSchema: zodToJsonSchema(ListDirectoryArgsSchema),
      },
      {
        name: "move_file",
        description:
          "Move or rename files and directories. Can move files between directories " +
          "and rename them in a single operation. Both source and destination must be " +
          "within allowed directories.",
        inputSchema: zodToJsonSchema(MoveFileArgsSchema),
      },
      {
        name: "search_files",
        description:
          "Finds files by name using a case-insensitive substring matching. " +
          "Searches through all subdirectories from the starting path. " +
          "Has a default timeout of 30 seconds which can be customized using the timeoutMs parameter. " +
          "Only searches within allowed directories.",
        inputSchema: zodToJsonSchema(SearchFilesArgsSchema),
      },
      {
        name: "search_code",
        description:
          "Search for text/code patterns within file contents using ripgrep. " +
          "Fast and powerful search similar to VS Code search functionality. " +
          "Supports regular expressions, file pattern filtering, and context lines. " +
          "Has a default timeout of 30 seconds which can be customized. " +
          "Only searches within allowed directories.",
        inputSchema: zodToJsonSchema(SearchCodeArgsSchema),
      },
      {
        name: "get_file_info",
        description:
          "Retrieve detailed metadata about a file or directory including size, " +
          "creation time, last modified time, permissions, and type. " +
          "Only works within allowed directories.",
        inputSchema: zodToJsonSchema(GetFileInfoArgsSchema),
      },
      {
        name: "list_allowed_directories",
        description:
          "Returns the list of directories that this server is allowed to access.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "edit_block",
        description:
          "Apply surgical text replacements to files. Best for small changes (<20% of file size). " +
          "Call repeatedly to change multiple blocks. Will verify changes after application. " +
          "Format:\nfilepath\n<<<<<<< SEARCH\ncontent to find\n=======\nnew content\n>>>>>>> REPLACE",
        inputSchema: zodToJsonSchema(EditBlockArgsSchema),
      },
      // Git tools
      {
        name: "is_git_repository",
        description: "Check if a path is inside a git repository.",
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
        description: "Get the git commit history for a file.",
        inputSchema: zodToJsonSchema(GetFileHistoryArgsSchema),
      },
      {
        name: "force_create_snapshots",
        description:
          "Force the creation of Git snapshots for all pending file changes.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

import * as handlers from "./handlers/index.js";
import { ServerResult } from "./types.js";

server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest): Promise<ServerResult> => {
    try {
      const { name, arguments: args } = request.params;
      capture("server_call_tool");
      // Add a single dynamic capture for the specific tool
      capture("server_" + name);

      // Using a more structured approach with dedicated handlers
      switch (name) {
        // Terminal tools
        case "execute_command":
          return handlers.handleExecuteCommand(args);

        case "read_output":
          return handlers.handleReadOutput(args);

        case "force_terminate":
          return handlers.handleForceTerminate(args);

        case "list_sessions":
          return handlers.handleListSessions();

        // Process tools
        case "list_processes":
          return handlers.handleListProcesses();

        case "kill_process":
          return handlers.handleKillProcess(args);

        // Command management tools
        case "block_command":
          return handlers.handleBlockCommand(args);

        case "unblock_command":
          return handlers.handleUnblockCommand(args);

        case "list_blocked_commands":
          return handlers.handleListBlockedCommands();

        // Filesystem tools
        case "read_file":
          return handlers.handleReadFile(args);

        case "read_multiple_files":
          return handlers.handleReadMultipleFiles(args);

        case "write_file":
          return handlers.handleWriteFile(args);

        case "create_directory":
          return handlers.handleCreateDirectory(args);

        case "list_directory":
          return handlers.handleListDirectory(args);

        case "move_file":
          return handlers.handleMoveFile(args);

        case "search_files":
          return handlers.handleSearchFiles(args);

        case "search_code":
          return handlers.handleSearchCode(args);

        case "get_file_info":
          return handlers.handleGetFileInfo(args);

        case "list_allowed_directories":
          return handlers.handleListAllowedDirectories();

        case "edit_block":
          return handlers.handleEditBlock(args);

        // Git tools
        case "is_git_repository":
          return handlers.handleIsGitRepository(args);

        case "create_snapshot":
          return handlers.handleCreateSnapshot(args);

        case "revert_file":
          return handlers.handleRevertFile(args);

        case "get_file_history":
          return handlers.handleGetFileHistory(args);

        case "force_create_snapshots":
          return handlers.handleForceCreateSnapshots(args);

        default:
          capture("server_unknown_tool", { name });
          return {
            content: [{ type: "text", text: `Error: Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      capture("server_request_error", {
        error: errorMessage,
      });
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  }
);
