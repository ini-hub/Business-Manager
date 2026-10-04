import { useState } from "react";
import { FilterSheet, FilterSection, OptionRows, SortSheet as SortRadioSheet } from "@/components/filter-sheet";
import { ListControls } from "@/components/list-controls";
import {
  EMPTY_SIMPLE_LIST,
  applySimpleList,
  countPicked,
  matchesPicked,
  matchesSearch,
  simpleChips,
  type SimpleListConfig,
  type SimpleListState,
} from "@/lib/simple-list";

/**
 * Search + Filters + Sort for the smaller lists, driven by a SimpleListConfig.
 * `useSimpleList` holds the state and the narrowed rows; `controls` is the strip to render above the table.
 */
export function useSimpleList<T>(rows: T[], cfg: SimpleListConfig<T>, testIdPrefix: string, onChange?: () => void) {
  const [state, setState] = useState<SimpleListState>(EMPTY_SIMPLE_LIST);
  const set = (next: SimpleListState) => { setState(next); onChange?.(); };
  const visible = applySimpleList(rows, cfg, state);
  const searched = rows.filter((r) => matchesSearch(r, cfg, state.search));

  const controls = (
    <ListControls
      testIdPrefix={testIdPrefix}
      placeholder={cfg.placeholder}
      search={state.search}
      onSearchChange={(search) => set({ ...state, search })}
      filterCount={countPicked(state)}
      filters={cfg.groups.length === 0 ? undefined : (trigger) => (
        <FilterSheet<Record<string, string | null>>
          applied={state.picked}
          empty={{}}
          onApply={(picked) => set({ ...state, picked })}
          resultCountFor={(draft) => searched.filter((r) => matchesPicked(r, cfg.groups, draft)).length}
          noun={cfg.noun}
          trigger={trigger}
          activeCount={(draft) => Object.values(draft).filter(Boolean).length}
        >
          {({ draft, patch }) => (
            <>
              {cfg.groups.map((g, i) => {
                const chosen = draft[g.key] ?? null;
                return (
                  <FilterSection
                    key={g.key}
                    label={g.label}
                    defaultOpen={i === 0}
                    summary={g.options.find((o) => o.value === chosen)?.label ?? null}
                    onClear={() => patch({ [g.key]: null })}
                  >
                    <OptionRows
                      options={g.options.map((o) => ({
                        ...o,
                        count: searched.filter((r) => matchesPicked(r, cfg.groups, { ...draft, [g.key]: o.value })).length,
                      }))}
                      value={chosen}
                      onChange={(v) => patch({ [g.key]: v })}
                    />
                  </FilterSection>
                );
              })}
            </>
          )}
        </FilterSheet>
      )}
      sortLabel={cfg.sorts.find((s) => s.key === state.sortKey)?.label ?? "Sort"}
      sort={(trigger) => (
        <SortRadioSheet
          options={cfg.sorts.map((s) => ({ value: s.key, label: s.label }))}
          value={state.sortKey}
          onChange={(sortKey) => set({ ...state, sortKey })}
          trigger={trigger}
        />
      )}
      chips={simpleChips(cfg, state)}
      onRemoveChip={(key) => set({ ...state, picked: { ...state.picked, [key]: null } })}
      hasSort={state.sortKey !== null}
      onClearAll={() => set({ ...state, picked: {}, sortKey: null })}
      visibleCount={visible.length}
      noun={cfg.noun}
    />
  );

  return { visible, controls, state };
}
