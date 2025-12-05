# Business Management System

## Overview

This is a comprehensive business management system built to handle core operational functions including customer relationship management, staff administration, inventory control, sales transactions, and profit/loss analysis. The application provides a modern dashboard interface for managing day-to-day business operations with real-time data tracking and reporting capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System**
- **React 18** with TypeScript for type-safe component development
- **Vite** as the build tool and development server, configured with HMR (Hot Module Replacement)
- **Wouter** for lightweight client-side routing instead of React Router
- **TanStack Query (React Query)** for server state management, data fetching, and caching

**UI Component System**
- **shadcn/ui** components built on Radix UI primitives for accessible, customizable components
- **Tailwind CSS** for utility-first styling with custom design tokens
- **class-variance-authority (CVA)** for component variant management
- Material Design / Modern Business Dashboard aesthetic with the "new-york" style variant
- Custom theming system supporting light/dark modes stored in localStorage

**Design Principles**
- Information-dense, scannable layouts optimized for business workflows
- Consistent spacing system using Tailwind units (2, 4, 6, 8)
- Inter font family for modern, professional typography
- Component reusability through shared UI library in `@/components/ui`

**State Management Approach**
- Server state managed by TanStack Query with aggressive caching (`staleTime: Infinity`)
- Form state handled by React Hook Form with Zod validation
- UI state (modals, dialogs) managed locally with React hooks
- Theme state persisted to localStorage via custom ThemeProvider

### Backend Architecture

**Server Framework**
- **Express.js** as the HTTP server framework
- **Node.js** runtime with ES modules (`"type": "module"`)
- RESTful API design pattern with resource-based endpoints (`/api/customers`, `/api/staff`, etc.)

**API Design Pattern**
- CRUD operations for each entity (GET, POST, PATCH, DELETE)
- Consistent error handling with appropriate HTTP status codes
- JSON request/response format
- Request validation using Zod schemas shared between client and server

**Server Organization**
- `server/routes.ts` - API route definitions and handlers
- `server/storage.ts` - Data access layer abstracting database operations through IStorage interface
- `server/db.ts` - Database connection configuration
- `server/static.ts` - Static file serving for production builds
- `server/vite.ts` - Vite middleware integration for development mode

**Development vs Production**
- Development: Vite middleware with HMR for live reloading
- Production: Pre-built static assets served from `dist/public`
- Build process uses esbuild to bundle server code into a single CommonJS file

### Data Storage

**Database System**
- **PostgreSQL** as the primary database (via Neon serverless)
- **Drizzle ORM** for type-safe database queries and schema management
- WebSocket connection using `ws` library for Neon serverless compatibility

**Multi-Store Architecture**
The system supports multiple stores per business with store-scoped data:
- **Businesses** - Top-level entity containing stores
- **Stores** - Each store has unique code used for customer ID generation
- **Store Context** - React Context (`useStore`) provides current store to all pages
- **Store Selector** - UI component in sidebar for switching between stores
- **Customer ID Generation** - Auto-incrementing format using store prefix (e.g., MAIN001)
- All data queries and mutations are scoped to the currently selected store

**Schema Design**
Core entities with UUID primary keys and storeId foreign key:
1. **Businesses** - name (parent entity for stores)
2. **Stores** - name, code, businessId (unique code per business)
3. **Store Counters** - tracks auto-increment customer numbers per store
4. **Customers** - storeId, name, customer number, mobile, address
5. **Staff** - storeId, name, staff number, mobile, pay per month, contract status
6. **Inventory** - storeId, name, type (product/service), cost price, selling price, quantity
7. **Orders** - storeId, links checkouts to inventory items with quantity
8. **Checkouts** - storeId, transaction containers with customer, staff, and date
9. **Transactions** - storeId, complete transaction records with totals
10. **Profit/Loss** - storeId, calculated metrics per inventory item

**Schema Validation**
- Drizzle-Zod for runtime validation of insert/update operations
- Shared schema definitions between client and server (`shared/schema.ts`)
- Type inference for full TypeScript safety throughout the stack

**Database Migrations**
- Drizzle Kit for schema migrations in `migrations/` directory
- `db:push` command for schema synchronization during development

### External Dependencies

**Database Service**
- **Neon** - Serverless PostgreSQL database provider
- WebSocket-based connection pool for serverless environments
- Connection string provided via `DATABASE_URL` environment variable

**UI Component Libraries**
- **Radix UI** - Headless, accessible component primitives (20+ components including dialogs, dropdowns, tooltips, etc.)
- **Lucide React** - Icon library for consistent iconography
- **cmdk** - Command palette component
- **embla-carousel-react** - Carousel/slider functionality

**Form & Validation**
- **React Hook Form** - Performant form state management
- **Zod** - Schema validation for both client and server
- **@hookform/resolvers** - Integration between React Hook Form and Zod

**Development Tools**
- **Replit-specific plugins** - Cartographer, dev banner, runtime error overlay for Replit integration
- **tsx** - TypeScript execution for development scripts
- **esbuild** - Fast bundling for production server build

**Date Handling**
- **date-fns** - Date formatting and manipulation utilities

**Styling Utilities**
- **clsx** & **tailwind-merge** - Conditional className composition
- **autoprefixer** - CSS vendor prefix automation

### Key Architectural Decisions

**Monorepo Structure**
- Client code in `client/` directory
- Server code in `server/` directory  
- Shared types and schemas in `shared/` directory
- This enables type sharing while maintaining clear boundaries

**Type Safety Strategy**
- Shared Zod schemas provide runtime validation and TypeScript types
- Drizzle ORM infers types from database schema
- Path aliases (`@/`, `@shared/`) for clean imports

**API Communication Pattern**
- Custom `apiRequest` helper for consistent fetch API usage
- Automatic error handling with HTTP status code checks
- TanStack Query abstracts data fetching with caching and revalidation

**Build & Deployment**
- Custom build script bundles specific server dependencies (allowlist) to reduce cold start times
- Client assets built with Vite and served from `dist/public`
- Server bundled as single CommonJS file for production

**Session Management**
- Prepared for session support via `connect-pg-simple` and `express-session` (dependencies present but not yet implemented)

**Error Handling Philosophy**
- Server returns appropriate HTTP status codes (400 for validation, 404 for not found, 500 for server errors)
- Client displays user-friendly toast notifications for errors
- Development mode shows detailed error overlays via Replit plugin