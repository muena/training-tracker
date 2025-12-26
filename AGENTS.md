# AGENTS.md

Scope: Entire repository

Purpose: Brief the next agent on how to work with this codebase and resume seamlessly.

## Project Overview

- Goal: Mobile-first Web UI to view, add, edit, and delete strength training sets
- Database: SQLite (local, fast, no external dependencies)
- View: Exercise cards showing last weights + today's sets, easy set entry
- Current state: **Fully functional CRUD app** with authentication, Docker support, and statistics

## Features Implemented

- **View**: Mobile-first exercise cards with last weights and today's sets
- **Create**: 
  - New workouts via header button
  - New sets via exercise modal (tap card -> add set)
  - New exercises via search or dedicated button
- **Update**: Edit any set via edit button in exercise modal
- **Delete**: Delete button on each set
- **Statistics**: Overall stats + per-exercise weight/volume progression charts
- **Duration Tracking**: Automatic calculation of rest times between sets with outlier cleaning
- **Authentication**: Basic Auth (configurable via env vars)
- **Docker**: Full containerization with docker-compose
- **PWA**: Installable as Progressive Web App on mobile

## Tech Stack

- **Backend**: Node.js + SQLite (better-sqlite3)
- **Frontend**: Vanilla JS, CSS (no frameworks)
- **Charts**: Chart.js (via CDN)
- **Database**: SQLite with WAL mode for performance

## Run/Dev Setup

### Local Development
```bash
# 1. Install dependencies
npm install

# 2. Run migration (first time only)
node migrate.js

# 3. Start server
node server.js

# 4. Open browser
http://localhost:8765
```

### Docker Deployment
```bash
# 1. Create .env file
cp .env.example .env

# 2. Start container
docker-compose up -d

# 3. Access
http://localhost:8765
```

## Files

### Core Application
- `index.html` - Mobile-first HTML structure with tabs and modals
- `styles.css` - Dark theme, mobile-optimized CSS
- `app.js` - Frontend logic: state management, API calls, rendering
- `server.js` - HTTP server with REST API endpoints
- `database.js` - SQLite database layer with prepared statements
- `migrate.js` - One-time migration script from old data source

### Config & Docker
- `Dockerfile` - Alpine-based Node.js container
- `docker-compose.yml` - Container orchestration
- `.env.example` - Template for configuration
- `manifest.json` - PWA manifest

### Data
- `data/training.db` - SQLite database file (created by migration)

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `AUTH_USERNAME` | Basic Auth username | `admin` | No |
| `AUTH_PASSWORD` | Basic Auth password | `changeme` | No |
| `AUTH_ENABLED` | Enable/disable auth | `true` | No |
| `PORT` | Server port | `8765` | No |
| `DB_PATH` | Custom database path | `data/training.db` | No |

## Database Schema

### Tables

**exercises**
- `id` INTEGER PRIMARY KEY
- `name` TEXT UNIQUE
- `icon` TEXT (optional, emoji)
- `created_at` DATETIME

**workouts**
- `id` INTEGER PRIMARY KEY
- `date` TEXT UNIQUE (YYYY-MM-DD)
- `notes` TEXT
- `created_at` DATETIME

**sets**
- `id` INTEGER PRIMARY KEY
- `workout_id` INTEGER (FK)
- `exercise_id` INTEGER (FK)
- `set_number` INTEGER
- `weight` REAL
- `reps` INTEGER
- `difficulty` TEXT ('Leicht', 'Mittel', 'Schwer', 'Sehr schwer')
- `created_at` DATETIME
- `completed_at` DATETIME
- `duration_seconds` INTEGER (auto-calculated)
- `duration_cleaned` INTEGER (outlier-cleaned)

### Unique Constraints
- `(workout_id, exercise_id, set_number)` - One set per exercise per workout

## REST API Endpoints

### GET Endpoints
- `GET /api/exercises` - All exercises
- `GET /api/workouts?limit=N` - Last N workouts
- `GET /api/sets` - All sets with details
- `GET /api/stats` - Overall + exercise statistics
- `GET /api/stats/exercise?id=N` - Weight progression for exercise

### POST Endpoints
- `POST /api/exercises` - Create exercise `{name}`
- `POST /api/workouts` - Create workout `{date}`
- `POST /api/sets` - Create set `{workoutDate, exerciseId, setNumber, weight, reps, difficulty}`

### PUT/PATCH Endpoints
- `PUT /api/exercises/:id` - Update exercise `{name, icon}`
- `PUT /api/sets/:id` - Update set `{weight, reps, difficulty}`

### DELETE Endpoints
- `DELETE /api/exercises/:id` - Delete exercise (and all linked sets)
- `DELETE /api/sets/:id` - Delete set

## Frontend Architecture

### State Management
```javascript
const state = {
    currentDate: 'YYYY-MM-DD',  // Active workout date
    exercises: [],               // All exercises from DB
    sets: [],                   // All sets with details
    workouts: [],               // Recent workouts
    currentExercise: null       // Selected exercise for modal
};
```

### Views (Tabs)
1. **Workout** - Today's workout with exercise cards
2. **Übungen** - All exercises with search
3. **Statistik** - Charts and stats

### Key Functions
- `loadData()` - Fetch all data from API
- `renderWorkoutView()` - Render exercise cards for current date
- `openExerciseModal(id)` - Open modal to add/edit sets
- `addSet()` - Submit new set to API
- `loadExerciseChart(id)` - Load and render progression chart

## Duration Calculation

Sets are timestamped on creation. The system calculates:
1. `duration_seconds` - Time since previous set
2. `duration_cleaned` - Outlier-cleaned using IQR method

This handles cases where users take long breaks (conversations, phone calls) by replacing extreme values with the median.

## UI/UX Design

### Mobile-First Principles
- Touch-friendly buttons (min 44px)
- Bottom sheet modals (slide up)
- Dark theme for gym environments
- +/- buttons for weight/reps input
- Emoji difficulty indicators

### Color Scheme
- Background: `#1a1a2e`
- Cards: `#16213e`
- Primary: `#3b82f6`
- Success: `#10b981`
- Difficulty: 🟢🟡🟠🔴

## Development Conventions

- No external frontend frameworks
- Vanilla JS with modern syntax
- API responses always JSON
- Errors returned with `{error: "message"}`
- Database operations use prepared statements
- Close database connection on SIGINT/SIGTERM
- **Use `mgrep` instead of `grep`** for semantic code search (natural language queries)

## Quick Commands

```bash
# Development
npm install              # Install dependencies
node migrate.js          # Run migration
node server.js           # Start server

# Database
sqlite3 data/training.db # Open database CLI
.tables                  # List tables
.schema sets             # Show schema

# Testing
curl http://localhost:8765/api/exercises
curl http://localhost:8765/api/stats
```

## Troubleshooting

### Database not found
Run `node migrate.js` first to create and populate the database.

### Port in use
Change `PORT` in `.env` or kill the existing process.

### Authentication issues
Set `AUTH_ENABLED=false` for development.

### Chart not showing
Ensure Chart.js CDN loads successfully.

## Future Enhancements

Potential improvements:
- Export to CSV/PDF
- Workout templates
- Rest timer with notifications
- Multi-user support (sessions)
- Backup/restore functionality
- Progressive overload recommendations

---

Last updated: 2025-12-25
Status: Production-ready
