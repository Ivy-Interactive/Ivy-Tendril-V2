import React, { useMemo, useState } from "react";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@ivy-interactive/components/ui";
import { Bot, ChevronDown } from "lucide-react";
import { DEFAULT_OPTION_ID, type AgentOption } from "../../types/agents";

export interface AgentPickerProps {
  agents: AgentOption[];
  selectedAgentId: string;
  selectedModelId: string;
  selectedEffort: string;
  onAgentChange: (agentId: string) => void;
  /** A model is chosen for one agent, selected or not, and remembered for it. */
  onModelChange: (agentId: string, modelId: string) => void;
  onEffortChange: (agentId: string, effort: string) => void;
  /** Icon-only trigger, for the narrow header. */
  compact?: boolean;
  /** The model and effort an agent is remembered with, for the rows that are not selected. */
  rememberedFor?: (agentId: string) => { modelId?: string; effort?: string };
  /**
   * Prefix for this instance's test ids and control ids. The composer and the header each show a
   * picker, so the two cannot share one set of identifiers.
   */
  instanceId?: string;
}

const displayNameOf = (
  options: { id: string; displayName: string }[],
  id: string,
): string | undefined => options.find((option) => option.id === id)?.displayName;

/**
 * A native select, so its list floats over the popover instead of growing it, and so its keyboard
 * behaviour and labelling come from the platform rather than from a second layered primitive.
 */
const PickerSelect: React.FC<{
  id: string;
  label: string;
  value: string;
  options: { id: string; displayName: string }[];
  onChange: (value: string) => void;
}> = ({ id, label, value, options, onChange }) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-xs text-muted-foreground">
      {label}
    </Label>
    <div className="relative">
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-selector border border-border bg-popover px-2 py-1.5 pr-7 text-sm text-popover-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {!options.some((option) => option.id === value) && (
          <option value={value}>{value || "Default"}</option>
        )}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.displayName}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  </div>
);

/**
 * The composer's agent pill. Opens a list of coding agents; choosing one selects it, and the
 * model and effort below it belong to whichever agent is highlighted — so a model can be
 * remembered for an agent without switching to it.
 */
export const AgentPicker: React.FC<AgentPickerProps> = ({
  agents,
  selectedAgentId,
  selectedModelId,
  selectedEffort,
  onAgentChange,
  onModelChange,
  onEffortChange,
  compact = false,
  rememberedFor,
  instanceId = "agent-picker",
}) => {
  const [open, setOpen] = useState(false);

  // The selected agent is always listed, even when the catalog could not be fetched at all.
  const rows: AgentOption[] = useMemo(
    () =>
      agents.length > 0
        ? agents
        : [
            {
              id: selectedAgentId,
              label: selectedAgentId,
              models: [],
              supportsEffort: false,
              efforts: [],
            },
          ],
    [agents, selectedAgentId],
  );

  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const settingsAgentId =
    focusedAgentId && rows.some((a) => a.id === focusedAgentId) ? focusedAgentId : selectedAgentId;
  const settingsAgent = rows.find((agent) => agent.id === settingsAgentId);
  const isSelectedAgent = settingsAgentId === selectedAgentId;

  const remembered = rememberedFor?.(settingsAgentId) ?? {};
  const modelValue = isSelectedAgent
    ? selectedModelId
    : (remembered.modelId ?? settingsAgent?.models[0]?.id ?? DEFAULT_OPTION_ID);
  const effortValue = isSelectedAgent
    ? selectedEffort
    : (remembered.effort ?? settingsAgent?.efforts[0]?.id ?? DEFAULT_OPTION_ID);

  const selected = rows.find((agent) => agent.id === selectedAgentId);
  const agentLabel = selected?.label ?? selectedAgentId;
  const modelLabel = displayNameOf(selected?.models ?? [], selectedModelId) ?? selectedModelId;
  const effortLabel = displayNameOf(selected?.efforts ?? [], selectedEffort) ?? selectedEffort;
  const selectionSummary = selected?.supportsEffort
    ? `${agentLabel} · ${modelLabel} · ${effortLabel}`
    : `${agentLabel} · ${modelLabel}`;

  const chooseAgent = (agentId: string) => {
    if (agentId !== selectedAgentId) onAgentChange(agentId);
    setFocusedAgentId(agentId);
    setOpen(false);
  };

  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        data-testid={`${instanceId}-trigger`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Agent: ${selectionSummary}`}
        className="flex items-center gap-1.5 rounded-selector border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bot className="size-4 shrink-0" aria-hidden="true" />
        {!compact && <span className="max-w-[10rem] truncate">{agentLabel}</span>}
        {!compact && <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden="true" />}
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {compact ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent>Agent, model and effort</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        trigger
      )}

      <PopoverContent
        align="start"
        className="w-72 space-y-3 p-3"
        aria-label="Agents"
        onOpenAutoFocus={(e) => {
          // Keep focus on the trigger's own list rather than jumping into the selects.
          e.preventDefault();
          (e.currentTarget as HTMLElement)
            .querySelector<HTMLElement>("[cmdk-list] [data-value]")
            ?.focus();
        }}
      >
        <div
          data-testid={`${instanceId}-status`}
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {selectionSummary}
        </div>

        <Command label="Agents" className="bg-popover text-popover-foreground">
          <CommandList>
            <CommandGroup>
              {rows.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={agent.id}
                  role="option"
                  aria-selected={agent.id === selectedAgentId}
                  onSelect={() => chooseAgent(agent.id)}
                  onFocus={() => setFocusedAgentId(agent.id)}
                  onMouseEnter={() => setFocusedAgentId(agent.id)}
                  className={
                    agent.id === selectedAgentId ? "bg-accent text-accent-foreground" : undefined
                  }
                >
                  <span className="truncate">{agent.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>

        {settingsAgent && (settingsAgent.models.length > 0 || settingsAgent.supportsEffort) && (
          <div className="space-y-2 border-t border-border pt-2">
            <div className="text-xs font-medium text-popover-foreground">{settingsAgent.label}</div>
            {settingsAgent.models.length > 0 && (
              <PickerSelect
                id={`${instanceId}-model`}
                label="Model"
                value={modelValue}
                options={settingsAgent.models}
                onChange={(modelId) => onModelChange(settingsAgent.id, modelId)}
              />
            )}
            {settingsAgent.supportsEffort && (
              <PickerSelect
                id={`${instanceId}-effort`}
                label="Reasoning effort"
                value={effortValue}
                options={settingsAgent.efforts}
                onChange={(effort) => onEffortChange(settingsAgent.id, effort)}
              />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default AgentPicker;
