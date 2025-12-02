# Business Management System - Design Guidelines

## Design Approach

**Selected Approach:** Design System - Material Design / Modern Business Dashboard
**Justification:** This is a utility-focused, information-dense business management tool requiring consistent patterns, clear data hierarchy, and efficient workflows. Standard UI components optimized for data entry and analysis.

**Key Design Principles:**
- Clarity over decoration - information should be instantly scannable
- Consistent patterns across all modules for quick learning
- Efficient workflows minimizing clicks for common tasks
- Professional, trustworthy aesthetic appropriate for business context

## Core Design Elements

### A. Typography
- **Primary Font:** Inter (via Google Fonts CDN)
- **Headings:** 
  - Module titles: text-2xl font-semibold
  - Section headers: text-lg font-medium
  - Card titles: text-base font-medium
- **Body:** text-sm for table content, text-base for forms
- **Data/Numbers:** font-mono for prices, quantities, IDs

### B. Layout System
**Spacing Primitives:** Tailwind units of 2, 4, 6, and 8 (p-2, p-4, p-6, p-8, gap-4, etc.)
- Consistent padding: p-6 for cards, p-8 for main containers
- Grid gaps: gap-4 for form fields, gap-6 for card grids
- Section spacing: mb-6 between major sections

**Dashboard Layout:**
- Sidebar navigation (fixed, w-64) with module links
- Main content area (flex-1) with max-w-7xl container
- Top bar with breadcrumbs and user profile

### C. Component Library

**Navigation:**
- Vertical sidebar with icons (Heroicons) + labels
- Active state highlighting with subtle background
- Grouped by function (Management, Sales, Reports)

**Data Tables:**
- Striped rows for readability (alternate row backgrounds)
- Fixed header with sort indicators
- Action buttons (Edit/Delete) in final column
- Pagination controls at bottom
- Search/filter bar above table

**Forms:**
- Two-column layout for standard forms (grid-cols-2)
- Full-width for complex fields (addresses, notes)
- Clear labels above inputs
- Inline validation messages
- Submit buttons right-aligned

**Cards/Metrics:**
- Dashboard metrics in 3-4 column grid (grid-cols-3 lg:grid-cols-4)
- Large number display with label below
- Trend indicators (up/down arrows) where relevant
- Border with subtle shadow for depth

**Action Buttons:**
- Primary: Solid background (Add Customer, Create Order)
- Secondary: Outlined (Cancel, Back)
- Destructive: Red accent (Delete)
- Icon buttons for row actions (Edit, View)

**Modal Dialogs:**
- Centered overlay for forms and confirmations
- Backdrop blur
- Max-width constraints (max-w-2xl)
- Clear Close button in top-right

### D. Module-Specific Layouts

**Customer/Staff Management:**
- List view with table as primary interface
- Quick add button (top-right)
- Detail cards showing related transactions/orders
- Edit mode transforming cards to forms

**Inventory Management:**
- Product/Service toggle filter at top
- Grid view option for products (with minimal imagery if needed)
- Stock level badges (In Stock, Low, Out of Stock)
- Quick edit for quantity adjustments

**Sales Transaction Flow:**
- Multi-step process: Select Customer → Add Items → Checkout
- Cart summary sidebar (sticky)
- Item selection with search and category filters
- Running total display

**Profit & Loss Dashboard:**
- Top metrics row (Total Revenue, Net Profit, Items Sold)
- Per-item breakdown table
- Filter by date range and inventory type
- Export functionality

### E. Animations
Use sparingly - fade-in for modals (duration-200), subtle hover states on interactive elements. No page transitions or scroll animations.

## Images
**No hero images** - This is a data-focused business application, not a marketing site. The application opens directly to a functional dashboard showing key metrics and recent activity. Optional: Small avatar placeholders for staff profiles only.

## Critical Implementation Notes
- Responsive breakpoints: Mobile stacks to single column, tablet shows 2-column forms, desktop shows full sidebar + content
- Consistent error/success states with toast notifications (top-right corner)
- Loading states for async operations (skeleton screens for tables)
- Empty states with helpful CTAs when no data exists
- Breadcrumb navigation showing current location in hierarchy