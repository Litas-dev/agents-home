import { LLMMessage } from '../llm/types';
import { setUserBrief } from './tools/setUserBrief';
import { proposeTask } from './tools/proposeTask';
import { completeTask } from './tools/completeTask';
import { deliverProject } from './tools/deliverProject';
import { githubCreatePullRequest, githubListRepoTree, githubReadFile, githubSearchCode } from './tools/githubCreatePullRequest';
import { useUiStore } from '../../integration/store/uiStore';

export interface ToolCall {
  id?: string;
  name: string;
  args: any;
}

/**
 * Interface that decuples the ToolRegistry from the 3D Simulation (AgentHost).
 * This allows the tool logic to be tested and used independently of the simulation.
 */
export interface AgentActionContext {
  data: { index: number; name: string, subagents?: any[], humanInTheLoop?: boolean };
  setState: (state: 'idle' | 'moving' | 'working' | 'on_hold' | 'talking') => void;
  appendHistory: (message: LLMMessage) => void;
}

export class ToolRegistry {
  /**
   * Processes a tool call by dispatching it to the appropriate tool handler.
   */
  public static async process(agent: AgentActionContext, toolCall: ToolCall): Promise<boolean> {
    const { name, args } = toolCall;

    switch (name) {
      case 'set_user_brief':
        return setUserBrief(agent, args);
      case 'propose_task':
        return proposeTask(agent, args);
      case 'complete_task':
        return completeTask(agent, args);
      case 'deliver_project':
        return deliverProject(agent, args);
      case 'github_create_pull_request':
        return githubCreatePullRequest(agent, args);
      case 'github_list_repo_tree':
        return githubListRepoTree(agent, args);
      case 'github_read_file':
        return githubReadFile(agent, args);
      case 'github_search_code':
        return githubSearchCode(agent, args);
      default:
        console.warn(`[ToolRegistry] Unknown tool: ${name}`);
        return false;
    }
  }

  public static getDefinitions(agentIndex: number, phase: string, subagentsCount: number = 0): any[] {
    const isLead = agentIndex === 1;
    const isManager = subagentsCount > 0;
    const tools: any[] = [];
    const githubConfig = useUiStore.getState().githubConfig;
    const hasGitHub = !!githubConfig?.token && !!githubConfig?.repo;
    const isUser = agentIndex === 0;

    // 1. Idle Phase: Only Lead can set the brief
    if (phase === 'idle') {
      if (isLead) {
        tools.push({
          type: 'function',
          function: {
            name: 'set_user_brief',
            description: 'Start project with brief.',
            parameters: {
              type: 'object',
              properties: { brief: { type: 'string' } },
              required: ['brief']
            }
          }
        });
      }
      if (hasGitHub && isLead) {
        tools.push(
          {
            type: 'function',
            function: {
              name: 'github_list_repo_tree',
              description: 'List repository files and folders from GitHub. Use to discover paths before reading files.',
              parameters: {
                type: 'object',
                properties: {
                  ref: { type: 'string', description: 'Branch or ref (default: base branch)' },
                  path: { type: 'string', description: 'Optional subfolder like src or src/core' },
                  recursive: { type: 'boolean', description: 'List recursively (default: true)' },
                  maxEntries: { type: 'integer', description: 'Max entries to return (default: 500)' },
                  shareWithUser: { type: 'boolean', description: 'If true, show results in chat. Otherwise keep internal.' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'github_read_file',
              description: 'Read a file from GitHub repo and return its contents.',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'Repo-relative path like src/App.tsx' },
                  ref: { type: 'string', description: 'Branch or ref (default: base branch)' },
                  maxChars: { type: 'integer', description: 'Max characters returned (default: 20000)' },
                  shareWithUser: { type: 'boolean', description: 'If true, display file contents in chat. Otherwise keep internal.' }
                },
                required: ['path']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'github_search_code',
              description: 'Search code in the connected GitHub repo.',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search query (supports GitHub qualifiers)' },
                  path: { type: 'string', description: 'Optional path filter like src' },
                  perPage: { type: 'integer', description: 'Results per page (default: 10)' },
                  page: { type: 'integer', description: 'Page number (default: 1)' },
                  shareWithUser: { type: 'boolean', description: 'If true, show results in chat. Otherwise keep internal.' }
                },
                required: ['query']
              }
            }
          }
        );
      }
      return tools;
    }

    // 2. Working Phase: Common tools for everyone
    if (phase === 'working') {
      if (isLead || isManager) {
        tools.push({
          type: 'function',
          function: {
            name: 'propose_task',
            description: 'Assign task to agent.',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                agentId: { type: 'integer', description: 'Agent index' },
                requiresApproval: { type: 'boolean' }
              },
              required: ['title', 'description', 'agentId']
            }
          }
        });
      }

      tools.push(
        {
          type: 'function',
          function: {
            name: 'complete_task',
            description: 'Finish task. Output must be raw content, no introductions or credit for the work.',
            parameters: {
              type: 'object',
              properties: {
                taskId: { type: 'string' },
                output: { type: 'string', description: 'Task result in Markdown (e.g. code blocks, text, or research).' }
              },
              required: ['taskId', 'output']
            }
          }
        },
      );

      if (isLead) {
        tools.push({
          type: 'function',
          function: {
            name: 'deliver_project',
            description: 'Final delivery of the full project results.',
            parameters: {
              type: 'object',
              properties: { 
                output: { 
                  type: 'string', 
                  description: 'Full project document in Markdown. NO attribution needed.' 
                } 
              },
              required: ['output']
            }
          }
        });
      }

      if (hasGitHub && !isUser) {
        tools.push(
          {
            type: 'function',
            function: {
              name: 'github_list_repo_tree',
              description: 'List repository files and folders from GitHub. Use to discover paths before reading files.',
              parameters: {
                type: 'object',
                properties: {
                  ref: { type: 'string', description: 'Branch or ref (default: base branch)' },
                  path: { type: 'string', description: 'Optional subfolder like src or src/core' },
                  recursive: { type: 'boolean', description: 'List recursively (default: true)' },
                  maxEntries: { type: 'integer', description: 'Max entries to return (default: 500)' },
                  shareWithUser: { type: 'boolean', description: 'If true, show results in chat. Otherwise keep internal.' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'github_read_file',
              description: 'Read a file from GitHub repo and return its contents.',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'Repo-relative path like src/App.tsx' },
                  ref: { type: 'string', description: 'Branch or ref (default: base branch)' },
                  maxChars: { type: 'integer', description: 'Max characters returned (default: 20000)' },
                  shareWithUser: { type: 'boolean', description: 'If true, display file contents in chat. Otherwise keep internal.' }
                },
                required: ['path']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'github_search_code',
              description: 'Search code in the connected GitHub repo.',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search query (supports GitHub qualifiers)' },
                  path: { type: 'string', description: 'Optional path filter like src' },
                  perPage: { type: 'integer', description: 'Results per page (default: 10)' },
                  page: { type: 'integer', description: 'Page number (default: 1)' },
                  shareWithUser: { type: 'boolean', description: 'If true, show results in chat. Otherwise keep internal.' }
                },
                required: ['query']
              }
            }
          }
        );
      }

      if (hasGitHub && isLead) {
        tools.push({
          type: 'function',
          function: {
            name: 'github_create_pull_request',
            description: 'Create a GitHub pull request by committing provided files to a new branch.',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                body: { type: 'string' },
                baseBranch: { type: 'string' },
                branchName: { type: 'string' },
                commitMessage: { type: 'string' },
                files: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    properties: {
                      path: { type: 'string', description: 'Repo-relative path like src/App.tsx' },
                      content: { type: 'string', description: 'Full file content (UTF-8)' }
                    },
                    required: ['path', 'content']
                  }
                }
              },
              required: ['title', 'files']
            }
          }
        });
      }
    }

    return tools;
  }
}
