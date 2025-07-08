# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a multi-service monorepo for a restaurant/franchise management system with:
- **Admin Frontend**: Next.js 15 + React 19 with HeroUI/Radix UI
- **Backend API**: Bun runtime + Elysia framework with PostgreSQL
- **Supporting Services**: Cron jobs, payment processing, data synchronization

## Development Commands

### Parallel Development
```bash
# Start all services in development mode
pnpm run --parallel dev
```

### Individual Services

#### Admin Frontend (Port 6762)
```bash
cd admin
bun dev          # Development server
bun build        # Build for production
bun start        # Start production server
bun lint         # Run ESLint
```

#### Backend API (Port 6761)
```bash
cd backend
bun run --watch src/index.ts    # Development with hot reload
bun run ./src/index.ts          # Production start
```

#### Database Migrations
```bash
cd backend
drizzle-kit migrate             # Run migrations
drizzle-kit generate            # Generate new migrations
```

### Production Deployment
```bash
# Each service has PM2 configuration
pm2 start backend/pm2.config.js
pm2 start admin/pm2.config.js
pm2 start cron/pm2.config.js
```

## Architecture

### Technology Stack
- **Frontend**: Next.js 15, React 19, TypeScript, TailwindCSS
- **Backend**: Bun, Elysia, PostgreSQL, Drizzle ORM, Redis
- **Database**: PostgreSQL with time-series partitioning for analytics
- **UI Components**: HeroUI, Radix UI, Framer Motion
- **State Management**: Redux Toolkit + Zustand

### Key Patterns
- **Type Safety**: End-to-end with Eden client for API calls
- **Authentication**: JWT-based with Redis session storage
- **Permissions**: Role-based access control (RBAC)
- **Internationalization**: next-intl with 4 languages
- **Database**: Time-partitioned tables with materialized views

### Project Structure
```
├── admin/           # Next.js admin dashboard
├── backend/         # Elysia API server
├── cron/            # Background job processing
├── duck_api/        # Data synchronization service
├── merchants_api/   # Payment gateway integrations
└── tsconfig.json    # Shared TypeScript config
```

## Database Schema

### Core Tables
- `users` - User management with roles
- `organizations` & `terminals` - Multi-tenant structure
- `reports` & `reports_items` - Financial reporting
- `orders` & `order_items` - Time-partitioned order data
- `invoices` & `invoice_items` - Financial documents
- `vacancy`, `candidates`, `positions` - HR management
- `nomenclature_element` - Inventory items

### Performance Features
- Materialized views for aggregated analytics
- Composite primary keys for time-series data
- Efficient indexing on frequently queried columns

## API Structure

### Backend Controllers
Located in `backend/src/modules/*/controller.ts`:
- User management and authentication
- Organization and terminal management
- Financial reporting and invoicing
- HR module (vacancies, candidates, interviews)
- Inventory management and transfers

### API Client
- **Eden Client**: Type-safe API calls from frontend
- **tRPC**: Used for some specific endpoints
- **Error Handling**: Structured responses with HTTP status codes

## Frontend Architecture

### Layout System
- Role-based layouts (`AdminLayout`, `ManagerLayout`, `NoRoleLayout`)
- Permission-based component rendering
- Responsive design with mobile-first approach

### Key Components
- **Data Tables**: Server-side pagination with filtering
- **Charts**: Recharts + Nivo for analytics dashboards
- **Forms**: React Hook Form with Zod validation
- **UI System**: Consistent design tokens and components

### State Management
- **Redux Toolkit**: Global app state
- **Zustand**: Component-level state
- **TanStack Query**: Server state and caching

## Common Tasks

### Adding New API Endpoints
1. Create controller in `backend/src/modules/`
2. Add route to main index
3. Update Eden client types
4. Test with frontend integration

### Database Changes
1. Modify schema in `backend/drizzle/schema.ts`
2. Generate migration: `drizzle-kit generate`
3. Review migration in `backend/drizzle/migrations/`
4. Run migration: `drizzle-kit migrate`

### Adding New Pages
1. Create page in `admin/app/[locale]/`
2. Add navigation in layout components
3. Implement permission checks
4. Add internationalization strings

## Environment Variables

### Backend
- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - Authentication secret
- `REDIS_URL` - Redis connection

### Admin
- `NEXTAUTH_SECRET` - NextAuth secret
- `TRPC_API_URL` - Backend API URL
- `COOKIE_DOMAIN` - Cookie domain configuration

## Business Domain

This system handles:
- **Financial Management**: Reports, invoices, payment processing
- **HR Management**: Job postings, candidate tracking, interviews
- **Inventory Management**: Stock tracking, transfers, writeoffs
- **Analytics**: Revenue tracking, order analysis, performance metrics
- **Multi-tenant Support**: Organizations with multiple terminals/branches