import { ListToolbar } from "@/components/list-toolbar";
import { ListFilterChips } from "@/components/list-filter-chips";

/**
 * Search + Filters/Sort sheets + removable chips: the control strip above every list.
 * Pages supply the sheets (which know their own filter shape); this wires them to
 * the toolbar and the chip strip so the pattern is written once.
 */
export function ListControls({
  testIdPrefix, placeholder, search, onSearchChange, filterCount, filters, sortLabel, sort,
  chips, onRemoveChip, hasSort, onClearAll, visibleCount, noun,
}: {
  testIdPrefix: string;
  placeholder: string;
  search: string;
  onSearchChange: (v: string) => void;
  filterCount: number;
  /** Wraps the trigger in the page's Filters sheet; omit for lists without filters. */
  filters?: (trigger: React.ReactNode) => React.ReactNode;
  /** Current sort in words, e.g. "Newest". */
  sortLabel: string;
  sort: (trigger: React.ReactNode) => React.ReactNode;
  chips: { key: string; label: string }[];
  onRemoveChip: (key: string) => void;
  hasSort: boolean;
  onClearAll: () => void;
  visibleCount: number;
  /** Singular noun for the count: "vendor" -> "3 vendors". */
  noun: string;
}) {
  return (
    <>
      <ListToolbar
        testIdPrefix={testIdPrefix}
        search={search}
        onSearchChange={onSearchChange}
        placeholder={placeholder}
        filterCount={filterCount}
        filters={filters}
        sortLabel={sortLabel}
        sort={sort}
      />
      <ListFilterChips
        show={filterCount > 0 || hasSort}
        chips={chips}
        onRemove={onRemoveChip}
        count={visibleCount}
        noun={noun}
        onClearAll={onClearAll}
        testId={`button-${testIdPrefix}-clear-all`}
      />
    </>
  );
}
