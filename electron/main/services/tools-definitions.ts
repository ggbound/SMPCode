// Tool definitions for LLM function calling
// These tools enable the LLM to automatically read, write, and edit files

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

// Tool definitions for OpenAI-compatible API
export const CODE_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the specified path. Use this to examine existing code before editing.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute path to the file to read'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new file or overwrite an existing file with the specified content. Use this to create new files or completely replace file contents.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute path where the file should be created'
          },
          content: {
            type: 'string',
            description: 'The complete content to write to the file'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace specific text in a file with new text. Use this for targeted modifications when you only need to change part of a file. The old_string must match exactly (including whitespace) for the replacement to work.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute path to the file to edit'
          },
          old_string: {
            type: 'string',
            description: 'The exact text to find and replace (must match exactly including whitespace)'
          },
          new_string: {
            type: 'string',
            description: 'The new text to replace the old_string with'
          }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List the contents of a directory. Use this to explore the project structure and find files.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute path to the directory to list'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file or directory at the specified path. Use this to remove files or directories that are no longer needed.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute path to the file or directory to delete'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_bash',
      description: 'Execute a bash/shell command. Use this to run commands like npm install, git operations, build commands, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search for code patterns in the project using grep. Use this to find specific functions, variables, or patterns across multiple files.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The regex pattern to search for'
          },
          path: {
            type: 'string',
            description: 'The directory path to search in (optional, defaults to current working directory)'
          }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_running_processes',
      description: 'Get a list of all currently running processes managed by the application. Use this to check which services are running and get their process IDs for management.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'stop_process',
      description: 'Stop a running process by its process ID. Use this to terminate specific services or processes that were started through the application.',
      parameters: {
        type: 'object',
        properties: {
          process_id: {
            type: 'string',
            description: 'The process ID of the process to stop'
          }
        },
        required: ['process_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'restart_process',
      description: 'Restart a running process by its process ID. This will stop the process and start it again. Use this to restart services after code changes.',
      parameters: {
        type: 'object',
        properties: {
          process_id: {
            type: 'string',
            description: 'The process ID of the process to restart'
          }
        },
        required: ['process_id']
      }
    }
  }
]

// Tool result type
export interface ToolResult {
  tool_call_id: string
  role: 'tool'
  name: string
  content: string
}

// Tool call from LLM
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}
