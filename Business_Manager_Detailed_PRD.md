# Business Manager - Product Requirements Document (PRD)

## Version 1.0
**Date:** May 8, 2026  
**Author:** Development Team  
**Status:** Final  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals and Objectives](#2-goals-and-objectives)
3. [Technical Architecture](#3-technical-architecture)
4. [Database Schema](#4-database-schema)
5. [API Specifications](#5-api-specifications)
6. [Frontend Requirements](#6-frontend-requirements)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Business Logic](#8-business-logic)
9. [UI/UX Requirements](#9-uiux-requirements)
10. [Security Requirements](#10-security-requirements)
11. [Performance Requirements](#11-performance-requirements)
12. [Deployment & Infrastructure](#12-deployment--infrastructure)
13. [Testing Requirements](#13-testing-requirements)
14. [Development Environment Setup](#14-development-environment-setup)

---

## 1. Executive Summary

The Business Manager is a comprehensive multi-tenant web application designed to manage core business operations for retail businesses. The system provides complete business management functionality including customer tracking, staff management, inventory control, sales processing, transaction management, and financial reporting.

### Key Features
- **Multi-Tenant Architecture**: Complete data isolation between businesses
- **Store Management**: Support for multiple store locations per business
- **Customer Management**: Comprehensive customer database with auto-generated IDs
- **Staff Management**: Employee records with role-based access
- **Inventory Control**: Product and service management with real-time stock tracking
- **Sales Processing**: Complete POS system with receipt generation
- **Financial Reporting**: Automated profit & loss calculations
- **User Authentication**: Secure login with OTP verification
- **Responsive Design**: Mobile-first web interface

### Technology Stack
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Passport.js with session management
- **Deployment**: Single binary deployment with esbuild bundling

---

## 2. Goals and Objectives

### Primary Goals
1. **Data Accuracy**: Ensure 100% accuracy in sales tracking and financial calculations
2. **Multi-Tenant Security**: Complete data isolation between business entities
3. **User Experience**: Intuitive interface requiring minimal training
4. **Performance**: Sub-second response times for all operations
5. **Scalability**: Support for businesses with multiple stores and high transaction volumes

### Success Metrics
- Zero data leakage between tenants
- 99.9% uptime
- Sub-500ms API response times
- 100% data integrity in financial calculations
- Mobile-responsive across all devices

---

## 3. Technical Architecture

### System Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React SPA     │    │   Express API   │    │   PostgreSQL    │
│   (Vite)        │◄──►│   (Node.js)     │◄──►│   Database      │
│                 │    │                 │    │                 │
│ - Components    │    │ - REST Routes   │    │ - Multi-tenant  │
│ - State Mgmt    │    │ - Auth Middleware│    │ - ACID Txns    │
│ - Routing       │    │ - Validation    │    │ - Indexing      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Technology Stack Details

#### Frontend
- **React 18** with hooks and functional components
- **TypeScript** for type safety
- **Vite** for fast development and building
- **Tailwind CSS** for styling
- **shadcn/ui** component library
- **React Query** for server state management
- **Wouter** for client-side routing
- **React Hook Form** with Zod validation

#### Backend
- **Node.js** runtime
- **Express.js** web framework
- **TypeScript** for type safety
- **Drizzle ORM** for database operations
- **Passport.js** for authentication
- **express-session** with connect-pg-simple for sessions
- **Zod** for runtime validation
- **express-rate-limit** for API protection

#### Database
- **PostgreSQL** as the primary database
- **Drizzle ORM** with full type safety
- **Database migrations** with Drizzle Kit
- **Connection pooling** with Neon serverless

#### DevOps & Build
- **esbuild** for fast compilation
- **Vite** for frontend bundling
- **Single binary deployment** (server + client bundled)
- **Environment-based configuration**

### Architecture Principles
1. **Type Safety**: Full TypeScript coverage across frontend and backend
2. **Data Validation**: Runtime validation with Zod schemas
3. **Security First**: Authentication and authorization on all endpoints
4. **Performance**: Optimized queries and efficient data structures
5. **Maintainability**: Clean architecture with separation of concerns
6. **Scalability**: Stateless backend, efficient database design

---

## 4. Database Schema

### Multi-Tenant Structure
The database implements strict multi-tenancy with complete data isolation:

```
Business (Top Level)
├── Stores (Multiple locations)
│   ├── Customers (Store-specific)
│   ├── Staff (Store-specific)
│   ├── Inventory (Store-specific)
│   ├── Transactions (Store-specific)
│   └── Profit & Loss (Store-specific)
└── Users (Business-level auth)
```

### Core Tables

#### businesses
- `id`: UUID (Primary Key)
- `name`: Text (Required)
- `address`: Text
- `phone`: Text
- `phone_country_code`: Text (Default: "+234")
- `email`: Text
- `created_at`: Timestamp

#### stores
- `id`: UUID (Primary Key)
- `business_id`: UUID (Foreign Key → businesses)
- `name`: Text (Required)
- `code`: Text (Required, Unique per business)
- `address`: Text
- `phone`: Text
- `phone_country_code`: Text (Default: "+234")
- `country`: Text (Default: "NG")
- `currency`: Text (Default: "NGN")
- `manager_staff_id`: UUID (Foreign Key → staff)
- `is_active`: Boolean (Default: true)
- `created_at`: Timestamp

#### store_counters
- `id`: UUID (Primary Key)
- `store_id`: UUID (Foreign Key → stores, Unique)
- `next_customer_number`: Integer (Default: 1)
- `next_transaction_number`: Integer (Default: 1)

#### customers
- `id`: UUID (Primary Key)
- `store_id`: UUID (Foreign Key → stores)
- `name`: Text (Required)
- `customer_number`: Text (Auto-generated, Unique per store)
- `mobile_number`: Text
- `country_code`: Text (Default: "+234")
- `address`: Text (Required)
- `is_archived`: Boolean (Default: false)

#### staff
- `id`: UUID (Primary Key)
- `store_id`: UUID (Foreign Key → stores)
- `user_id`: UUID (Foreign Key → users, Optional)
- `name`: Text (Required)
- `email`: Text (Required, Unique per store)
- `staff_number`: Text (Auto-generated, Unique per store)
- `mobile_number`: Text (Required)
- `country_code`: Text (Default: "+234")
- `pay_per_month`: Real (Required)
- `signed_contract`: Boolean (Default: false)
- `is_archived`: Boolean (Default: false)
- `role`: Text ("manager" | "staff", Default: "staff")

#### inventory
- `id`: UUID (Primary Key)
- `store_id`: UUID (Foreign Key → stores)
- `name`: Text (Required, Unique per store)
- `type`: Text ("product" | "service", Required)
- `cost_price`: Real (Required)
- `selling_price`: Real (Required)
- `quantity`: Integer (Default: 0, Products only)

#### inventory_restock_events
- `id`: UUID (Primary Key)
- `store_id`: UUID (Foreign Key → stores)
- `inventory_id`: UUID (Foreign Key → inventory)
- `staff_id`: UUID (Foreign Key → staff, Optional)
- `user_id`: UUID (Foreign Key → users, Optional)
- `quantity_added`: Integer (Required)
- `previous_quantity`: Integer (Required)
- `new_quantity`: Integer (Required)
- `unit_cost`: Real (Required)
- `previous_cost_price`: Real (Required)
- `new_cost_price`: Real (Required)
- `previous_selling_price`: Real (Required)
- `new_selling_price`: Real (Required)
- `cost_strategy`: Text ("keep" | "last" | "weighted" | "override")
- `notes`: Text
- `restocked_at`: Timestamp (Default: now)

#### orders
- `id`: UUID (Primary Key)
- `store_id`: UUID (Foreign Key → stores)
- `inventory_id`: UUID (Foreign Key → inventory)
- `quantity`: Integer (Required)
- `total_price`: Real (Required)

#### checkouts
- `id`: UUID (Primary Key)
- `store_id`: UUID (Foreign Key → stores)
- `staff_id`: UUID (Foreign Key → staff)
- `order_id`: UUID (Foreign Key → orders)
- `receipt_number`: Text (Auto-generated, Unique per store)
- `total_price`: Real (Required)
- `payment_method`: Text ("cash" | "transfer" | "flutterwave")
- `payment_status`: Text ("completed" | "pending")
- `payment_reference`: Text
- `created_at`: Timestamp (Default: now)

#### transactions
- `id`: UUID (Primary Key)
- `store_id`: UUID (Foreign Key → stores)
- `customer_id`: UUID (Foreign Key → customers)
- `inventory_id`: UUID (Foreign Key → inventory)
- `checkout_id`: UUID (Foreign Key → checkouts)
- `transaction_date`: Timestamp (Default: now)

#### profit_loss
- `id`: UUID (Primary Key)
- `store_id`: UUID (Foreign Key → stores)
- `inventory_id`: UUID (Foreign Key → inventory)
- `total_quantity_sold`: Integer (Default: 0)
- `quantity_remaining`: Integer (Default: 0)
- `total_revenue`: Real (Default: 0)
- `total_net_profit`: Real (Default: 0)

### Authentication Tables

#### users
- `id`: UUID (Primary Key)
- `email`: Text (Required, Unique)
- `password`: Text (Required, Hashed)
- `business_id`: UUID (Foreign Key → businesses, Optional)
- `role`: Text ("owner" | "manager" | "staff", Default: "owner")
- `is_verified`: Boolean (Default: false)
- `created_at`: Timestamp (Default: now)
- `updated_at`: Timestamp (Default: now)

#### sessions
- `sid`: Text (Primary Key)
- `sess`: JSONB (Required)
- `expire`: Timestamp (Required, Indexed)

#### otp_codes
- `id`: UUID (Primary Key)
- `user_id`: UUID (Foreign Key → users)
- `code`: Text (6 characters, Required)
- `type`: Text ("signup" | "password_reset")
- `expires_at`: Timestamp (Required)
- `is_used`: Boolean (Default: false)
- `created_at`: Timestamp (Default: now)

---

## 5. API Specifications

### Authentication Endpoints

#### POST /api/auth/signup
**Purpose**: Register a new business and owner account
**Request Body**:
```json
{
  "businessName": "string",
  "address": "string?",
  "phoneCountryCode": "+234",
  "phone": "string?",
  "email": "string",
  "password": "string",
  "confirmPassword": "string"
}
```
**Response**: User session created

#### POST /api/auth/login
**Purpose**: Authenticate user
**Request Body**:
```json
{
  "email": "string",
  "password": "string"
}
```
**Response**: User session created

#### POST /api/auth/verify-otp
**Purpose**: Verify email with OTP
**Request Body**:
```json
{
  "email": "string",
  "otp": "string"
}
```

#### POST /api/auth/forgot-password
**Purpose**: Request password reset
**Request Body**:
```json
{
  "email": "string"
}
```

#### POST /api/auth/reset-password
**Purpose**: Reset password with OTP
**Request Body**:
```json
{
  "email": "string",
  "otp": "string",
  "password": "string",
  "confirmPassword": "string"
}
```

#### POST /api/auth/logout
**Purpose**: Destroy user session

### Business Management Endpoints

#### GET /api/businesses
**Purpose**: Get user's business information

#### PUT /api/businesses/:id
**Purpose**: Update business information

### Store Management Endpoints

#### GET /api/stores
**Purpose**: Get all stores for user's business

#### POST /api/stores
**Purpose**: Create a new store

#### PUT /api/stores/:id
**Purpose**: Update store information

#### DELETE /api/stores/:id
**Purpose**: Deactivate a store

### Customer Management Endpoints

#### GET /api/stores/:storeId/customers
**Purpose**: Get customers for a store

#### POST /api/stores/:storeId/customers
**Purpose**: Create a new customer

#### PUT /api/stores/:storeId/customers/:id
**Purpose**: Update customer information

#### DELETE /api/stores/:storeId/customers/:id
**Purpose**: Archive a customer

### Staff Management Endpoints

#### GET /api/stores/:storeId/staff
**Purpose**: Get staff for a store

#### POST /api/stores/:storeId/staff
**Purpose**: Create a new staff member

#### PUT /api/stores/:storeId/staff/:id
**Purpose**: Update staff information

#### DELETE /api/stores/:storeId/staff/:id
**Purpose**: Archive a staff member

### Inventory Management Endpoints

#### GET /api/stores/:storeId/inventory
**Purpose**: Get inventory items for a store

#### POST /api/stores/:storeId/inventory
**Purpose**: Create a new inventory item

#### PUT /api/stores/:storeId/inventory/:id
**Purpose**: Update inventory item

#### DELETE /api/stores/:storeId/inventory/:id
**Purpose**: Remove inventory item

#### POST /api/stores/:storeId/inventory/:id/restock
**Purpose**: Restock inventory item

### Sales Processing Endpoints

#### POST /api/stores/:storeId/sales
**Purpose**: Process a new sale
**Request Body**:
```json
{
  "customerId": "uuid",
  "items": [
    {
      "inventoryId": "uuid",
      "quantity": 1
    }
  ],
  "paymentMethod": "cash"
}
```

#### GET /api/stores/:storeId/transactions
**Purpose**: Get transaction history

#### GET /api/stores/:storeId/profit-loss
**Purpose**: Get profit & loss report

### Security Features
- **Rate Limiting**: 500 requests per 10 minutes per IP
- **Input Sanitization**: All inputs sanitized server-side
- **Audit Logging**: All data modifications logged
- **Session Management**: Secure HTTP-only sessions
- **CORS Protection**: Configured for security

---

## 6. Frontend Requirements

### Technology Stack
- React 18 with TypeScript
- Vite for development and building
- Tailwind CSS for styling
- shadcn/ui component library
- React Query for data fetching
- React Hook Form with Zod validation
- Wouter for routing

### Core Pages

#### Authentication Pages
- **Login**: Email/password authentication
- **Signup**: Business registration with OTP verification
- **Verify OTP**: 6-digit code verification
- **Forgot Password**: Password reset request
- **Reset Password**: New password setup

#### Main Application Pages
- **Dashboard**: Overview with key metrics and charts
- **Customers**: Customer list with search and filtering
- **Customer Details**: Individual customer transaction history
- **Staff**: Staff management with role assignment
- **Inventory**: Product/service catalog with stock levels
- **Inventory Details**: Item-specific analytics and restock history
- **New Sale**: Point of sale interface
- **Transactions**: Complete transaction history
- **Profit & Loss**: Financial reporting dashboard
- **Settings**: Store and business configuration

### Component Architecture

#### Layout Components
- **AppSidebar**: Navigation sidebar with menu items
- **StoreSelector**: Dropdown for switching between stores
- **ThemeToggle**: Dark/light mode switcher
- **PageHeader**: Consistent page headers with breadcrumbs

#### Data Components
- **DataTable**: Reusable table with sorting, filtering, pagination
- **MetricCard**: KPI display cards
- **Charts**: Various chart types for analytics
- **ConfirmDialog**: Confirmation dialogs for destructive actions
- **ExportToolbar**: Data export functionality

#### Form Components
- **Form Fields**: Consistent form inputs with validation
- **DateRangeFilter**: Date range selection
- **BulkOperations**: Batch operations on data

### State Management
- **React Query**: Server state management
- **Context API**: Theme and store context
- **Local State**: Component-level state with hooks

### Responsive Design
- Mobile-first approach
- Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)
- Touch-friendly interfaces
- Optimized for tablets and mobile devices

---

## 7. Authentication & Authorization

### Authentication Flow
1. **Registration**: Business owner creates account with email verification
2. **Email Verification**: OTP sent to email (development: 123456)
3. **Login**: Email/password authentication
4. **Session Management**: Secure HTTP-only cookies
5. **Password Reset**: OTP-based password recovery

### Authorization Model
- **Role-Based Access**: owner > manager > staff
- **Store-Level Permissions**: Users can only access their business's stores
- **Data Isolation**: Complete tenant isolation at database level

### Security Features
- **Password Requirements**: 8+ chars, uppercase, lowercase, number, symbol
- **Session Timeout**: Automatic logout after inactivity
- **Rate Limiting**: Protection against brute force attacks
- **Input Validation**: Server-side validation on all inputs
- **Audit Logging**: All authentication events logged

---

## 8. Business Logic

### Auto-Generated Identifiers
- **Customer Numbers**: STORE-0001, STORE-0002, etc.
- **Staff Numbers**: STORE-STAFF-0001, etc.
- **Receipt Numbers**: STORE-TXN-0001, etc.

### Sales Processing Flow
1. **Order Creation**: Items and quantities selected
2. **Price Calculation**: total_price = quantity × selling_price
3. **Checkout Creation**: Payment processing and receipt generation
4. **Transaction Recording**: Customer-item-sale linkage
5. **Inventory Update**: Quantity reduction for products
6. **P&L Update**: Revenue and profit calculations

### Profit & Loss Calculation
```
total_revenue = Σ(order.total_price for all transactions)
total_cost = total_quantity_sold × average_cost_price
total_net_profit = total_revenue - total_cost
quantity_remaining = initial_quantity - total_quantity_sold
```

### Inventory Management
- **Cost Strategies**: keep, last, weighted, override
- **Stock Tracking**: Real-time quantity updates
- **Restock History**: Complete audit trail
- **Low Stock Alerts**: Configurable thresholds

### Multi-Store Support
- **Store Isolation**: Complete data separation
- **Shared Business Data**: Common business information
- **Store-Specific Counters**: Independent numbering sequences

---

## 9. UI/UX Requirements

### Design System
- **Colors**: Professional blue/gray palette
- **Typography**: Clean, readable fonts
- **Spacing**: Consistent 4px grid system
- **Components**: shadcn/ui component library
- **Icons**: Lucide React icon set

### User Experience Principles
1. **Intuitive Navigation**: Clear information hierarchy
2. **Progressive Disclosure**: Show relevant information at right time
3. **Feedback**: Loading states, success/error messages
4. **Accessibility**: WCAG 2.1 AA compliance
5. **Performance**: Fast loading and responsive interactions

### Key User Flows

#### New User Onboarding
1. Business registration
2. Email verification
3. Store setup
4. Initial data import (optional)
5. Dashboard introduction

#### Daily Operations
1. Login to system
2. Select active store
3. Process sales transactions
4. Manage inventory
5. Review reports

#### Staff Management
1. Add new staff members
2. Assign roles and permissions
3. Track performance metrics
4. Manage contracts and pay

### Mobile Responsiveness
- **Touch Targets**: Minimum 44px touch targets
- **Gestures**: Swipe actions for common operations
- **Responsive Tables**: Horizontal scroll for data tables
- **Optimized Forms**: Mobile-friendly form layouts

---

## 10. Security Requirements

### Data Protection
- **Encryption**: Passwords hashed with bcrypt (12 rounds)
- **HTTPS Only**: All communications encrypted
- **Input Sanitization**: XSS prevention
- **SQL Injection Prevention**: Parameterized queries

### Access Control
- **Authentication Required**: All business data endpoints
- **Role-Based Permissions**: Hierarchical access control
- **Session Security**: HTTP-only, secure cookies
- **CSRF Protection**: Token-based protection

### Audit & Compliance
- **Audit Logging**: All data modifications tracked
- **Data Retention**: Configurable retention policies
- **Backup Security**: Encrypted database backups
- **Access Logging**: User activity monitoring

### Infrastructure Security
- **Rate Limiting**: API abuse prevention
- **CORS Configuration**: Restricted cross-origin access
- **Helmet.js**: Security headers
- **Dependency Updates**: Regular security updates

---

## 11. Performance Requirements

### Response Times
- **API Responses**: <500ms for 95% of requests
- **Page Loads**: <2 seconds initial load
- **Database Queries**: <100ms average
- **File Exports**: <30 seconds for large datasets

### Scalability Targets
- **Concurrent Users**: Support 100+ simultaneous users
- **Database Size**: Handle 1M+ transactions
- **File Storage**: Efficient handling of exports
- **Memory Usage**: Optimized for cloud deployment

### Optimization Strategies
- **Database Indexing**: Optimized queries with proper indexes
- **Caching**: Query result caching where appropriate
- **Lazy Loading**: Progressive data loading
- **Code Splitting**: Efficient bundle splitting

---

## 12. Deployment & Infrastructure

### Build Process
1. **Client Build**: Vite production build
2. **Server Build**: esbuild bundling with externals
3. **Single Binary**: Combined client + server deployment
4. **Asset Optimization**: Minified and compressed assets

### Environment Configuration
- **Environment Variables**: Database URL, session secrets, etc.
- **Runtime Configuration**: Environment-based settings
- **Database Migrations**: Automatic migration on startup

### Infrastructure Requirements
- **Database**: PostgreSQL (Neon recommended)
- **Runtime**: Node.js 18+
- **Memory**: 512MB minimum, 1GB recommended
- **Storage**: 10GB+ for database and logs

### Monitoring & Logging
- **Error Tracking**: Comprehensive error logging
- **Performance Monitoring**: Response time tracking
- **Database Monitoring**: Query performance analysis
- **User Analytics**: Usage pattern tracking

---

## 13. Testing Requirements

### Testing Strategy
- **Unit Tests**: Component and utility function testing
- **Integration Tests**: API endpoint testing
- **E2E Tests**: Critical user flow testing
- **Performance Tests**: Load and stress testing

### Test Coverage
- **Backend**: 80%+ code coverage
- **Frontend**: 70%+ code coverage
- **Critical Paths**: 100% test coverage

### Testing Tools
- **Backend**: Jest or Vitest with Supertest
- **Frontend**: Vitest with React Testing Library
- **E2E**: Playwright for critical flows
- **Database**: Drizzle test utilities

---

## 14. Development Environment Setup

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Git

### Development Setup
```bash
# Clone repository
git clone <repository-url>
cd business-manager

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with database URL and secrets

# Set up database
npm run db:push
npm run db:generate

# Seed development data (optional)
npm run seed

# Start development server
npm run dev
```

### Project Structure
```
business-manager/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/         # Page components
│   │   ├── hooks/         # Custom React hooks
│   │   └── lib/           # Utilities and configurations
├── server/                 # Express backend
│   ├── routes.ts          # API route definitions
│   ├── auth.ts            # Authentication logic
│   ├── db.ts              # Database connection
│   └── index.ts           # Server entry point
├── shared/                 # Shared types and schemas
│   └── schema.ts          # Database schema and types
├── migrations/            # Database migrations
├── script/                # Build and utility scripts
└── package.json           # Dependencies and scripts
```

### Development Workflow
1. **Feature Development**: Create feature branch
2. **Code Review**: Pull request with review
3. **Testing**: Automated tests and manual QA
4. **Deployment**: Automated deployment to staging/production

---

## Conclusion

This PRD provides comprehensive specifications for recreating the Business Manager application. The system is designed to be robust, scalable, and user-friendly while maintaining strict security and data integrity standards.

Key success factors include:
- Complete multi-tenant data isolation
- Intuitive user interface
- Comprehensive business logic implementation
- Strong security measures
- Performance optimization
- Thorough testing coverage

The modular architecture and detailed specifications ensure that developers can accurately recreate all functionality with confidence.