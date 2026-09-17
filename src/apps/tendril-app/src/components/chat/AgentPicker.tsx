import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Ellipsis } from "lucide-react";
import { BrandIcon, ShellTooltip } from "@ivy-interactive/components/tendril";
import {
  DEFAULT_OPTION_ID,
  type AgentOption,
  type EffortOption,
  type ModelOption,
} from "../../types/agents";

/**
 * V1 `Helpers/AgentBranding.IconFor`: the brand mark each coding agent carries in the picker, keyed
 * by agent id and resolved by `BrandIcon` from the C# `Icons` enum name. V1 serialises it onto
 * `AgentOptionDto.Icon`; V2's `/api/agents` (`tendril-core/src/agents/catalog.rs`) sends no icon, so
 * the table lives here until it does. An unmapped id falls through to `BrandIcon`'s terminal glyph,
 * which is V1's `AgentBranding.DefaultIcon`.
 */
const AGENT_BRAND_ICONS: Record<string, string> = {
  claude: "ClaudeCode",
  codex: "OpenAI",
  gemini: "Gemini",
  copilot: "Copilot",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  ivy: "IvyCorner",
  openaiproxy: "OpenAI",
  berget: "ChevronUp",
};

export const agentBrandIcon = (agentId: string): string | undefined =>
  AGENT_BRAND_ICONS[agentId.toLowerCase()];

export interface AgentPickerProps {
  agents: AgentOption[];
  selectedAgentId: string;
  selectedModelId: string;
  selectedEffort: string;
  /**
   * The selected agent's models and efforts as the host resolved them, for a catalogue whose rows
   * carry none of their own. V1's `ChatWidget` always sends these three beside `agents`; V2's
   * `/api/agents` puts them on every row, so they are a fallback rather than the usual path.
   */
  models?: ModelOption[];
  efforts?: EffortOption[];
  supportsEffort?: boolean;
  onAgentChange: (agentId: string) => void;
  /** A model or effort is chosen for one agent, selected or not, and remembered for it. */
  onModelChange: (agentId: string, modelId: string) => void;
  onEffortChange: (agentId: string, effort: string) => void;
  /** Icon-only trigger, for the narrow composer of an embedded chat. */
  compact?: boolean;
  /**
   * The model and effort remembered for an agent, which is what V1 puts on the row itself
   * (`AgentOptionDto.SelectedModel` / `SelectedEffort`, filled by `ChatApp.BuildAgentDtos` for
   * every row and not just the selected one). V2's catalogue is agent-shaped and carries no
   * per-user state, so the store answers instead.
   */
  rememberedFor?: (agentId: string) => { modelId?: string; effort?: string };
  /** Prefix for this instance's test ids, so two pickers cannot share one set. */
  instanceId?: string;
}

interface SelectOption {
  value: string;
  label: string;
}

/** A native select, so its list floats over the page instead of growing the panel. */
const PanelSelect: React.FC<{
  title: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}> = ({ title, value, options, onChange }) => (
  <ShellTooltip content={title} side="top">
    <label className="relative flex items-center">
      <select
        aria-label={title}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-full cursor-pointer appearance-none truncate whitespace-nowrap rounded-selector border border-border bg-popover pl-2.5 pr-7 text-sm text-popover-foreground outline-none hover:bg-accent focus:border-foreground"
      >
        {/* A value the list does not contain still has to be showable, or the select silently
            snaps to its first option and reports a model the host never chose. */}
        {!options.some((option) => option.value === value) && (
          <option value={value}>{value || "Default"}</option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-2 text-muted-foreground"
        aria-hidden="true"
      />
    </label>
  </ShellTooltip>
);

const DEFAULT_EFFORTS: SelectOption[] = [{ value: DEFAULT_OPTION_ID, label: "Default" }];
const PANEL_GAP = 8;
const VIEWPORT_MARGIN = 8;

/**
 * Where the layer starts before it is measured: fixed, so its width is its content's rather than
 * the body's, and hidden, so the reader never sees it jump into place.
 */
const UNPLACED_LAYER: React.CSSProperties = {
  position: "fixed",
  left: 0,
  bottom: 0,
  zIndex: 10000,
  visibility: "hidden",
};

interface AgentSettings {
  models: SelectOption[];
  model: string;
  supportsEffort: boolean;
  efforts: SelectOption[];
  effort: string;
}

const hasSettings = (settings: AgentSettings) =>
  settings.models.length > 0 || settings.supportsEffort;

/**
 * The composer's agent pill, mirroring V1's `ChatWidget/AgentPicker.tsx`.
 *
 * It opens a menu of coding agents above the pill; clicking one selects it. Each row reveals an
 * options button on hover that opens a panel beside the row with that agent's model and effort,
 * which are therefore remembered per agent without selecting it. The pill itself names the agent
 * only: V1 never puts the model or the effort on it.
 */
export const AgentPicker: React.FC<AgentPickerProps> = ({
  agents,
  selectedAgentId,
  selectedModelId,
  selectedEffort,
  models = [],
  efforts = [],
  supportsEffort,
  onAgentChange,
  onModelChange,
  onEffortChange,
  compact = false,
  rememberedFor,
  instanceId = "agent-picker",
}) => {
  const [open, setOpen] = useState(false);
  const [optionsAgentId, setOptionsAgentId] = useState<string | null>(null);
  const [layerStyle, setLayerStyle] = useState<React.CSSProperties>(UNPLACED_LAYER);
  const [panelTop, setPanelTop] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // The selected agent is always listed, even when the host sent no agent list at all.
  const rows: AgentOption[] =
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
        ];
  const selected = rows.find((agent) => agent.id === selectedAgentId);
  const label = selected?.label ?? selectedAgentId;

  // An agent's panel offers its own remembered model and effort; the selected agent falls back
  // to the host's resolution of them.
  const settingsFor = (agent: AgentOption): AgentSettings => {
    const isSelected = agent.id === selectedAgentId;
    const remembered = rememberedFor?.(agent.id) ?? {};
    const modelSource = agent.models.length > 0 ? agent.models : isSelected ? models : [];
    const modelOptions = modelSource.map((model) => ({
      value: model.id,
      label: model.displayName,
    }));
    /* `ChatApp.ResolveModel`: an agent's default is the real id its catalogue flags `IsDefault`, which
       `catalog.rs` pins first and also names in `defaultModel`. There is no synthetic `default` row to
       fall back to any more, so an agent with no models at all offers no model. */
    const model =
      remembered.modelId ??
      (isSelected ? selectedModelId : (agent.defaultModel ?? modelOptions[0]?.value ?? ""));

    /* The ladder belongs to the *model* first, then the agent. V1 declares `SupportedEfforts` on
       every catalogue row and resolves through `ChatApp.GetEffortsForAgentAndModel`, so Copilot on
       `claude-opus-5` offers Claude's five levels and on `gpt-5.4` offers Copilot's four. Reading
       `agent.efforts` alone gave one ladder per agent regardless of the model chosen beside it. */
    const activeModel = modelSource.find((candidate) => candidate.id === model);
    const effortSource =
      activeModel?.efforts && activeModel.efforts.length > 0
        ? activeModel.efforts
        : agent.efforts.length > 0
          ? agent.efforts
          : isSelected
            ? efforts
            : [];
    return {
      models: modelOptions,
      model,
      supportsEffort: agent.supportsEffort || (isSelected && supportsEffort === true),
      efforts:
        effortSource.length > 0
          ? effortSource.map((effort) => ({ value: effort.id, label: effort.displayName }))
          : DEFAULT_EFFORTS,
      effort: remembered.effort ?? (isSelected ? selectedEffort : DEFAULT_OPTION_ID),
    };
  };

  const optionsAgent =
    optionsAgentId != null ? rows.find((agent) => agent.id === optionsAgentId) : undefined;
  const optionsSettings = optionsAgent ? settingsFor(optionsAgent) : undefined;

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const panelWidth = panelRef.current?.offsetWidth ?? 0;
    const layerWidth = menuWidth + (panelWidth > 0 ? PANEL_GAP + panelWidth : 0);
    // The menu's right edge sits on the pill's right edge so the panel opens outward;
    // the whole layer is then kept inside the viewport.
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.right - menuWidth, window.innerWidth - layerWidth - VIEWPORT_MARGIN),
    );
    setLayerStyle({
      position: "fixed",
      bottom: Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.top + PANEL_GAP),
      left,
      zIndex: 10000,
      visibility: "visible",
    });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, optionsAgentId]);

  // The panel sits beside its row, top edges aligned, unless that would run off the bottom of
  // the viewport; then it grows upward from the row's bottom edge instead.
  useLayoutEffect(() => {
    if (!open || optionsAgentId == null) return;
    const row = rowRefs.current.get(optionsAgentId);
    const panel = panelRef.current;
    const layer = layerRef.current;
    if (!row || !panel || !layer) return;
    const rowRect = row.getBoundingClientRect();
    const layerTop = layer.getBoundingClientRect().top;
    const panelHeight = panel.offsetHeight;
    const fitsBelow = rowRect.top + panelHeight <= window.innerHeight - VIEWPORT_MARGIN;
    const top = Math.round((fitsBelow ? rowRect.top : rowRect.bottom - panelHeight) - layerTop);
    setPanelTop((current) => (current === top ? current : top));
  });

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || layerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  const toggleMenu = () => {
    setOptionsAgentId(null);
    setLayerStyle(UNPLACED_LAYER);
    setOpen((state) => !state);
  };

  const chooseAgent = (agentId: string) => {
    if (agentId !== selectedAgentId) onAgentChange(agentId);
    setOptionsAgentId(null);
    setOpen(false);
  };

  const toggleOptions = (agentId: string) =>
    setOptionsAgentId((current) => (current === agentId ? null : agentId));

  return (
    <>
      <ShellTooltip content="Agent, model and effort" side="top">
        <button
          ref={triggerRef}
          type="button"
          data-testid={`${instanceId}-trigger`}
          data-open={open}
          data-compact={compact}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Agent: ${label}`}
          onClick={toggleMenu}
          className="inline-flex h-7.5 max-w-46 items-center gap-2 rounded-selector border-0 bg-transparent p-1.5 text-sm text-foreground opacity-60 transition-[opacity,background-color] hover:bg-accent hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[open=true]:bg-accent data-[open=true]:opacity-100"
        >
          <BrandIcon name={agentBrandIcon(selectedAgentId)} size={16} className="shrink-0" />
          {!compact && <span className="truncate whitespace-nowrap">{label}</span>}
        </button>
      </ShellTooltip>

      {open &&
        createPortal(
          <div ref={layerRef} style={layerStyle}>
            <div
              ref={menuRef}
              role="menu"
              aria-label="Agents"
              className="flex min-w-41 flex-col gap-0.5 rounded-box border border-border bg-popover p-1.5 shadow-lg"
            >
              {rows.map((agent) => {
                const settings = settingsFor(agent);
                const optionsOpen = agent.id === optionsAgentId;
                return (
                  <div
                    key={agent.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(agent.id, el);
                      else rowRefs.current.delete(agent.id);
                    }}
                    role="menuitemradio"
                    aria-checked={agent.id === selectedAgentId}
                    aria-label={agent.label}
                    tabIndex={0}
                    data-selected={agent.id === selectedAgentId}
                    data-options-open={optionsOpen}
                    className="group flex h-7.5 cursor-pointer items-center gap-2 whitespace-nowrap rounded-selector pl-2 pr-1 text-sm text-popover-foreground outline-none data-[selected=true]:bg-muted hover:bg-accent focus-visible:bg-accent data-[options-open=true]:bg-accent"
                    onClick={() => chooseAgent(agent.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        chooseAgent(agent.id);
                      } else if (e.key === "ArrowRight" && hasSettings(settings)) {
                        e.preventDefault();
                        setOptionsAgentId(agent.id);
                      }
                    }}
                  >
                    <BrandIcon name={agentBrandIcon(agent.id)} size={16} className="shrink-0" />
                    <span className="flex-1 truncate group-data-[selected=true]:font-medium">
                      {agent.label}
                    </span>
                    {/* The row's options button shows on hover, on keyboard focus and while its
                        panel is open. */}
                    {hasSettings(settings) && (
                      <ShellTooltip content="Model and effort" side="top">
                        <button
                          type="button"
                          aria-label={`${agent.label} options`}
                          aria-expanded={optionsOpen}
                          className="inline-flex size-5.5 shrink-0 items-center justify-center rounded-selector border-0 bg-transparent text-muted-foreground opacity-0 transition-[opacity,background-color,color] group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground aria-expanded:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleOptions(agent.id);
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Ellipsis size={14} />
                        </button>
                      </ShellTooltip>
                    )}
                  </div>
                );
              })}
            </div>
            {optionsAgent && optionsSettings && (
              <div
                ref={panelRef}
                role="group"
                aria-label={`${optionsAgent.label} settings`}
                style={{ top: panelTop, left: `calc(100% + ${PANEL_GAP}px)` }}
                className="absolute flex min-w-41 flex-col gap-1.5 rounded-box border border-border bg-popover p-2 shadow-lg"
              >
                <div className="whitespace-nowrap px-0.5 pb-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {optionsAgent.label}
                </div>
                {optionsSettings.models.length > 0 && (
                  <PanelSelect
                    title="Model"
                    value={optionsSettings.model}
                    options={optionsSettings.models}
                    onChange={(modelId) => onModelChange(optionsAgent.id, modelId)}
                  />
                )}
                {optionsSettings.supportsEffort && (
                  <PanelSelect
                    title="Effort Level"
                    value={optionsSettings.effort}
                    options={optionsSettings.efforts}
                    onChange={(effortId) => onEffortChange(optionsAgent.id, effortId)}
                  />
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
};

export default AgentPicker;
