import { LLMMessage } from '../llm/types';
import { DeepSeekProvider } from '../llm/providers/GeminiProvider';
import { useUiStore } from '../../integration/store/uiStore';
import { useCoreStore } from '../../integration/store/coreStore';
import { useTeamStore } from '../../integration/store/teamStore';
import { ToolRegistry } from './ToolRegistry';
import { PromptBuilder } from './PromptBuilder';
import { AGENTIC_SETS, AgentNode } from '../../data/agents';
import { AVAILABLE_MODELS, DEFAULT_MODELS } from '../llm/constants';

export interface BrainHost {
  data: AgentNode;
  simulation: {
    getAllAgents: () => any[];
    processScheduledTasks: () => void;
  };
  getCurrentTaskId: () => string | null;
}

export interface ThinkOptions {
  isChat?: boolean;
  tools?: any[];
  silent?: boolean;
}

export class AgentBrain {
  private history: LLMMessage[] = [];
  public isThinking: boolean = false;

  constructor(private readonly host: BrainHost) {
    this.refreshFromStore();
  }

  public async think(prompt: string, options: ThinkOptions = {}): Promise<{ text: string, toolCalls: any[] }> {
    if (this.isThinking) return { text: '', toolCalls: [] };
    this.isThinking = true;

    try {
      this.refreshFromStore();
      const core = useCoreStore.getState();
      const llmConfig = useUiStore.getState().llmConfig;
      if (!llmConfig.apiKey) throw new Error('DeepSeek API key is required');
      const provider = new DeepSeekProvider(llmConfig.apiKey, llmConfig.baseUrl);
      const providerName = llmConfig.provider || (llmConfig.baseUrl?.includes('openrouter.ai') ? 'openrouter' : 'deepseek');
      const fallbackModel = llmConfig.model;
      let model = providerName === 'openrouter'
        ? ((this.host.data.model && this.host.data.model !== DEFAULT_MODELS.text) ? this.host.data.model : fallbackModel)
        : (this.host.data.model || fallbackModel);

      const allowed = providerName === 'openrouter'
        ? (useCoreStore.getState().availableModels || [])
        : [...AVAILABLE_MODELS.text];
      const resolvedFallback = allowed.includes(fallbackModel)
        ? fallbackModel
        : (allowed[0] || fallbackModel);

      if (allowed.length > 0 && !allowed.includes(model)) {
        model = resolvedFallback;
        useUiStore.getState().setLlmConfig({ model });
        try {
          const saved = localStorage.getItem('byok-config');
          if (saved) {
            const parsed = JSON.parse(saved);
            localStorage.setItem('byok-config', JSON.stringify({ ...parsed, model }));
          }
        } catch { }
      }
      const teamId = useTeamStore.getState().selectedAgentSetId;
      const activeTeam = useTeamStore.getState().customSystems.find(s => s.id === teamId)
        || AGENTIC_SETS.find(s => s.id === teamId);

      const hasVisionSupport = activeTeam?.outputType === 'image' || activeTeam?.outputType === 'video';

      // 1. Manage Message History
      if (!options.isChat) {
        const userMsg: LLMMessage = {
          role: 'user',
          content: prompt,
          metadata: options.silent ? { internal: true } : undefined
        };
        
        // Attach reference images if VISION is supported for this project type
        if (hasVisionSupport && core.referenceImages.length > 0) {
          userMsg.images = core.referenceImages;
        }

        this.history.push(userMsg);
        this.syncToStore();
      }

      // 2. Prepare context
      let messages: LLMMessage[] = this.history.slice(-10);

      // In chat mode, ensure the latest user message also carries images if it's the brief phase
      if (options.isChat && hasVisionSupport && core.referenceImages.length > 0) {
        messages = messages.map((m, idx) => {
          if (idx === messages.length - 1 && m.role === 'user') {
            return { ...m, images: core.referenceImages };
          }
          return m;
        });
      }
      const allAgents = this.host.simulation.getAllAgents();
      const systemPrompt = PromptBuilder.buildSystemPrompt(this.host.data, core.phase, core.userBrief, allAgents);
      const toolDefs = options.tools || ToolRegistry.getDefinitions(this.host.data.index, core.phase, this.host.data.subagents?.length || 0);

      // 3. Log and Execute LLM Call
      core.addRequestLog({
        agentIndex: this.host.data.index,
        agentName: this.host.data.name,
        systemInstruction: systemPrompt,
        contents: messages,
        systemTools: toolDefs,
        taskId: this.host.getCurrentTaskId() || undefined
      });

      const shouldRotateModel = (msg: string) => {
        const lower = msg.toLowerCase();
        return lower.includes('rate limit')
          || lower.includes('high demand')
          || lower.includes('overloaded')
          || lower.includes('provider returned error')
          || lower.includes('http 429')
          || lower.includes('http 500')
          || lower.includes('http 502')
          || lower.includes('http 503')
          || lower.includes('http 504');
      };

      const rotateToNextModel = () => {
        const available = useCoreStore.getState().availableModels || [];
        if (available.length === 0) return null;
        const current = useUiStore.getState().llmConfig.model;
        const idx = Math.max(0, available.indexOf(current));
        const next = available[(idx + 1) % available.length] || null;
        if (!next || next === current) return null;
        useUiStore.getState().setLlmConfig({ model: next });
        try {
          const saved = localStorage.getItem('byok-config');
          if (saved) {
            const parsed = JSON.parse(saved);
            localStorage.setItem('byok-config', JSON.stringify({ ...parsed, model: next }));
          }
        } catch { }
        return next;
      };

      let response: any;
      try {
        response = await provider.generateCompletion(messages, toolDefs, systemPrompt, model);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (providerName === 'openrouter' && shouldRotateModel(msg)) {
          const next = rotateToNextModel();
          if (next) {
            response = await provider.generateCompletion(messages, toolDefs, systemPrompt, next);
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }

      // 4. Log Response
      core.addResponseLog({
        agentIndex: this.host.data.index,
        agentName: this.host.data.name,
        content: response.content || '',
        tool_calls: response.tool_calls,
        usage: response.usage,
        raw: response.raw,
        taskId: this.host.getCurrentTaskId() || undefined
      });

      // 5. Parse Tool Calls
      const text = response.content || '';
      const toolCalls = response.tool_calls?.map(tc => {
        try {
          return { id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments) };
        } catch (e) {
          console.error('[AgentBrain] Failed to parse tool arguments', tc.function.arguments);
          return null;
        }
      }).filter(Boolean) as any[] || [];

      // 6. Final Message Construction
      const isInternalTrigger = options.silent;
      const hasToolCallsOnly = !text && toolCalls.length > 0;
      const isBrief = toolCalls.some(tc => tc.name === 'set_user_brief');
      const isResolution = false;
      let finalContent = text;
      const isMalformed = response.finishReason === 'MALFORMED_FUNCTION_CALL';

      if (isMalformed) {
        finalContent = 'ERROR: Malformed function call. Please try again.';
        console.warn(`[AgentBrain:${this.host.data.name}] Malformed function call detected.`);
      } else if (hasToolCallsOnly && !isInternalTrigger) {
        finalContent = isBrief
          ? "Project brief set. Let's begin!"
          : 'Working on it...';
      } else if (!text && toolCalls.length === 0 && !isInternalTrigger) {
        finalContent = '...';
      }

      // UI/UX handling for chat auto-closing
      if (options.isChat && (isBrief || isResolution)) {
        setTimeout(() => {
          if (useUiStore.getState().isChatting) useUiStore.getState().setChatting(false);
          useUiStore.getState().setSelectedNpc(null);
        }, 3000);
      }

      const isInternalMessage = isInternalTrigger || (hasToolCallsOnly && isInternalTrigger);
      this.history.push({
        role: 'assistant',
        content: finalContent,
        tool_calls: response.tool_calls,
        metadata: isInternalMessage ? { internal: true } : undefined
      });
      this.syncToStore();

      // 7. Process Actions (Tools)
      for (const tc of toolCalls) {
        const handled = await ToolRegistry.process(this.host as any, tc);
        if (tc.name === 'deliver_project' && handled) {
          this.handleFinalAssetGeneration(tc.args.output);
        }
      }

      return { text, toolCalls };
    } catch (error) {
      console.error(`[AgentBrain:${this.host.data.name}] Logic error:`, error);
      const errMsg = error instanceof Error ? error.message : String(error);
      useUiStore.getState().setBYOKOpen(true, errMsg);
      throw error;
    } finally {
      this.isThinking = false;
      this.host.simulation.processScheduledTasks();
    }
  }

  /** Autonomous Intent: Start the project strategy. */
  public async spark() {
    return this.think('Start the project by proposing initial tasks.', { silent: true });
  }

  /** Autonomous Intent: Work on a specific task. */
  public async executeTask(taskId: string) {
    return this.think(`Proceed with task: ${taskId}`, { silent: true });
  }

  /** Autonomous Intent: Finalize and deliver the project results. */
  public async concludeProject() {
    return this.think('All tasks are complete! Use the deliver_project tool to fulfill the final delivery with the project result.', { silent: true });
  }

  private async handleFinalAssetGeneration(prompt: string) {
    const core = useCoreStore.getState();
    const teamId = useTeamStore.getState().selectedAgentSetId;
    const activeTeam = useTeamStore.getState().customSystems.find(s => s.id === teamId)
      || AGENTIC_SETS.find(s => s.id === teamId);

    if (!activeTeam) return;

    // Check if we need manual approval
    if (activeTeam.outputAutoApprove === false) {
      core.setPendingOutputPrompt(prompt);

      // Prepare default params based on output type
      const defaultParams: any = { model: activeTeam.outputModel };
      if (activeTeam.outputType === 'image') {
        defaultParams.aspectRatio = '16:9';
        defaultParams.imageSize = '1K';
      } else if (activeTeam.outputType === 'video') {
        defaultParams.resolution = '720p';
        defaultParams.aspectRatio = '16:9';
        defaultParams.durationSeconds = 4;
      }

      core.setPendingOutputParams(defaultParams);
      core.setReviewingOutput(true);
      return;
    }

    // Standard auto-approve flow
    await this.processFinalAsset(prompt, { model: activeTeam.outputModel });
  }

  public async processFinalAsset(prompt: string, options: any) {
    const core = useCoreStore.getState();
    const teamId = useTeamStore.getState().selectedAgentSetId;
    const activeTeam = useTeamStore.getState().customSystems.find(s => s.id === teamId)
      || AGENTIC_SETS.find(s => s.id === teamId);

    if (!activeTeam) return;

    core.setIsGeneratingAsset(true);
    core.setReviewingOutput(false);

    try {
      const llmConfig = useUiStore.getState().llmConfig;
      if (!llmConfig.apiKey) throw new Error('DeepSeek API key is required');
      const model = options.model || activeTeam.outputModel || llmConfig.model;

      core.addLogEntry({
        agentIndex: -1,
        action: `Generating final ${activeTeam.outputType} using ${model}...`,
        taskId: undefined
      });

      if (activeTeam.outputType === 'text') {
        core.setFinalOutput(prompt);
        core.setPhase('done');
        core.setFinalOutputOpen(true);
        core.setIsGeneratingAsset(false);
        return;
      }
      core.setIsGeneratingAsset(false);
      const errMsg = 'This build supports text output only (DeepSeek).';
      useUiStore.getState().setBYOKOpen(true, errMsg);
      core.addLogEntry({
        agentIndex: 0,
        action: `Error generating final ${activeTeam.outputType}: ${errMsg}`,
        taskId: undefined
      });
    } catch (error) {
      console.error('[AgentBrain] Final asset generation failed:', error);
      core.setIsGeneratingAsset(false);
      const errMsg = error instanceof Error ? error.message : String(error);
      useUiStore.getState().setBYOKOpen(true, errMsg);
      core.addLogEntry({
        agentIndex: 0,
        action: `Error generating final ${activeTeam.outputType}: ${errMsg}`,
        taskId: undefined
      });
    }
  }

  public appendHistory(message: LLMMessage) {
    this.refreshFromStore();
    this.history.push(message);
    this.syncToStore();
  }

  private refreshFromStore() {
    const history = useCoreStore.getState().agentHistories[this.host.data.index];
    if (history) this.history = [...history];
  }

  private syncToStore() {
    useCoreStore.getState().setAgentHistory(this.host.data.index, this.history);
  }
}
