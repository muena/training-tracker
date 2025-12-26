const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Datenbank-Pfad (im data Ordner für Docker-Volume)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'training.db');

// Erstelle data-Ordner falls nicht vorhanden
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Datenbank initialisieren
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Schema erstellen - MUSS vor Prepared Statements kommen
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        name TEXT,
        picture TEXT,
        provider TEXT,
        provider_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

// Migration für Multi-User (User ID Spalten und Constraint Updates)
const hasUsersTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='exercises' AND sql LIKE '%user_id%'").get();

if (!hasUsersTable) {
    console.log('Migrating database to multi-user schema...');
    const transaction = db.transaction(() => {
        // FK Check deaktivieren für Schema-Umbau
        db.pragma('foreign_keys = OFF');

        // 1. Workouts: User ID hinzufügen
        // Wir erstellen die Tabelle neu, um saubere Constraints zu haben
        db.exec(`
            CREATE TABLE workouts_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                date TEXT NOT NULL,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, date)
            );
            INSERT INTO workouts_new (id, date, notes, created_at) SELECT id, date, notes, created_at FROM workouts;
            DROP TABLE workouts;
            ALTER TABLE workouts_new RENAME TO workouts;
            CREATE INDEX idx_workouts_date ON workouts(date);
            CREATE INDEX idx_workouts_user ON workouts(user_id);
        `);

        // 2. Exercises: User ID hinzufügen und UNIQUE Constraint ändern (Name nur unique pro User)
        db.exec(`
            CREATE TABLE exercises_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                name TEXT NOT NULL,
                icon TEXT,
                muscle_groups TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, name)
            );
            INSERT INTO exercises_new (id, name, icon, muscle_groups, created_at) 
            SELECT id, name, icon, muscle_groups, created_at FROM exercises;
            DROP TABLE exercises;
            ALTER TABLE exercises_new RENAME TO exercises;
        `);

        // 3. Sets: Keine Strukturänderung nötig, aber FKs müssen valide bleiben.
        // Da wir IDs beibehalten haben, passt alles.
        
        db.pragma('foreign_keys = ON');
    });
    transaction();
    console.log('Database migration complete.');
}

// Helper um Constraints für existierende Tabellen zu prüfen (falls Migration manuell lief)
try {
    db.exec(`ALTER TABLE exercises ADD COLUMN user_id INTEGER REFERENCES users(id)`);
} catch (e) {} // Ignorieren wenn schon da

db.exec(`
    CREATE TABLE IF NOT EXISTS sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workout_id INTEGER NOT NULL,
        exercise_id INTEGER NOT NULL,
        set_number INTEGER NOT NULL,
        weight REAL NOT NULL DEFAULT 0,
        reps INTEGER NOT NULL DEFAULT 0,
        difficulty TEXT DEFAULT 'Mittel',
        superset_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        duration_seconds INTEGER,
        duration_cleaned INTEGER,
        FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE,
        FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
        UNIQUE(workout_id, exercise_id, set_number)
    )
`);

// Migration: superset_id Spalte hinzufügen falls nicht vorhanden
try {
    db.exec(`ALTER TABLE sets ADD COLUMN superset_id TEXT`);
    console.log('Added superset_id column to sets table');
} catch (e) {
    // Spalte existiert bereits - ignorieren
}

// Index für superset_id
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sets_superset ON sets(superset_id);
`);

// Indizes
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sets_workout ON sets(workout_id);
    CREATE INDEX IF NOT EXISTS idx_sets_exercise ON sets(exercise_id);
    CREATE INDEX IF NOT EXISTS idx_sets_created ON sets(created_at);
    CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
`);

console.log('Database initialized successfully');

// Auth & Session Helpers
const createUserStmt = db.prepare(`
    INSERT INTO users (email, name, picture, provider, provider_id) 
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET 
        name=excluded.name, 
        picture=excluded.picture, 
        provider=excluded.provider, 
        provider_id=excluded.provider_id
    RETURNING id, email, name, picture
`);

const createSessionStmt = db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)
`);

const getSessionStmt = db.prepare(`
    SELECT s.*, u.email, u.name, u.picture 
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')
`);

const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`);

// CRUD Operationen - Prepared Statements (nach Schema-Erstellung)

// Übungen (User-Spezifisch)
const getExercisesStmt = db.prepare(`
    SELECT id, name, icon, muscle_groups, created_at, user_id 
    FROM exercises 
    WHERE user_id = ? OR user_id IS NULL
    ORDER BY name
`);

const getExerciseByIdStmt = db.prepare(`
    SELECT id, name, icon, muscle_groups, created_at, user_id 
    FROM exercises 
    WHERE id = ? AND (user_id = ? OR user_id IS NULL)
`);

const getExerciseByNameStmt = db.prepare(`
    SELECT id, name, icon, muscle_groups, created_at, user_id 
    FROM exercises 
    WHERE name = ? AND (user_id = ? OR user_id IS NULL)
`);

const insertExerciseStmt = db.prepare(`
    INSERT INTO exercises (name, user_id) VALUES (?, ?)
`);

const updateExerciseStmt = db.prepare(`
    UPDATE exercises 
    SET name = ?, icon = ?, muscle_groups = ? 
    WHERE id = ? AND user_id = ?
`);

// Workouts
const getWorkoutsStmt = db.prepare(`
    SELECT id, date, notes, created_at 
    FROM workouts 
    WHERE user_id = ? OR user_id IS NULL
    ORDER BY date DESC
`);

const getLastNWorkoutsStmt = db.prepare(`
    SELECT id, date, notes, created_at 
    FROM workouts 
    WHERE user_id = ? OR user_id IS NULL
    ORDER BY date DESC LIMIT ?
`);

const getWorkoutByDateStmt = db.prepare(`
    SELECT id, date, notes, created_at 
    FROM workouts 
    WHERE date = ? AND (user_id = ? OR user_id IS NULL)
`);

const insertWorkoutStmt = db.prepare(`
    INSERT INTO workouts (date, user_id) VALUES (?, ?)
`);

// Sätze
// (Sätze hängen am Workout, und das Workout am User. 
// Wir prüfen beim Zugriff auf Sätze implizit den User über das Workout oder filtern entsprechend)

const getSetsForWorkoutStmt = db.prepare(`
    SELECT 
        s.id, s.set_number, s.weight, s.reps, s.difficulty, s.superset_id,
        s.created_at, s.completed_at, s.duration_seconds, s.duration_cleaned,
        e.id as exercise_id, e.name as exercise_name
    FROM sets s
    JOIN exercises e ON s.exercise_id = e.id
    WHERE s.workout_id = ?
    ORDER BY s.created_at, s.set_number
`);

// Hier müssen wir filtern, damit man nicht Sets von fremden Usern sieht (via Workout Join)
const getAllSetsWithDetailsStmt = db.prepare(`
    SELECT 
        s.id, s.set_number, s.weight, s.reps, s.difficulty, s.superset_id,
        s.created_at, s.completed_at, s.duration_seconds, s.duration_cleaned,
        e.id as exercise_id, e.name as exercise_name,
        w.id as workout_id, w.date as workout_date
    FROM sets s
    JOIN exercises e ON s.exercise_id = e.id
    JOIN workouts w ON s.workout_id = w.id
    WHERE w.user_id = ? OR w.user_id IS NULL
    ORDER BY w.date DESC, s.created_at, s.set_number
`);

const getLastSetForExerciseStmt = db.prepare(`
    SELECT 
        s.id, s.set_number, s.weight, s.reps, s.difficulty,
        w.date as workout_date
    FROM sets s
    JOIN workouts w ON s.workout_id = w.id
    WHERE s.exercise_id = ? AND s.set_number = ? AND (w.user_id = ? OR w.user_id IS NULL)
    ORDER BY w.date DESC
    LIMIT 1
`);

const insertSetStmt = db.prepare(`
    INSERT INTO sets (workout_id, exercise_id, set_number, weight, reps, difficulty, superset_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertSetSimpleStmt = db.prepare(`
    INSERT INTO sets (workout_id, exercise_id, set_number, weight, reps, difficulty, superset_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);

const updateSetSupersetStmt = db.prepare(`
    UPDATE sets SET superset_id = ? WHERE id = ?
`);

const getSetsWithSameSupersetStmt = db.prepare(`
    SELECT 
        s.id, s.set_number, s.weight, s.reps, s.difficulty, s.superset_id,
        e.id as exercise_id, e.name as exercise_name
    FROM sets s
    JOIN exercises e ON s.exercise_id = e.id
    JOIN workouts w ON s.workout_id = w.id
    WHERE s.superset_id = ? AND s.id != ? AND (w.user_id = ? OR w.user_id IS NULL)
`);

const updateSetStmt = db.prepare(`
    UPDATE sets SET weight = ?, reps = ?, difficulty = ? WHERE id = ?
`);

// Delete Set und Check User Ownership:
// Wir prüfen im Frontend/Server Code, ob der User das Workout besitzt,
// oder wir könnten hier einen JOIN machen. Da deleteSetStmt nur ID nimmt,
// muss der Aufrufer sicherstellen, dass die ID dem User gehört.
// Wir machen das im deleteSetWithRenumberTx.

const deleteSetStmt = db.prepare(`
    DELETE FROM sets WHERE id = ?
`);

const getSetMetaByIdStmt = db.prepare(`
    SELECT s.id, s.workout_id, s.exercise_id, s.set_number, s.superset_id, w.user_id
    FROM sets s
    JOIN workouts w ON s.workout_id = w.id
    WHERE s.id = ?
`);

// ...

// Statistik-Abfragen
const getWeightProgressionForExerciseStmt = db.prepare(`
    SELECT 
        w.date as workout_date,
        MAX(s.weight) as max_weight,
        AVG(s.weight) as avg_weight,
        AVG(s.reps) as avg_reps,
        SUM(s.weight * s.reps) as total_volume,
        COUNT(s.id) as set_count,
        MAX(CASE WHEN s.superset_id IS NOT NULL THEN 1 ELSE 0 END) as has_superset
    FROM sets s
    JOIN workouts w ON s.workout_id = w.id
    WHERE s.exercise_id = ? AND w.date >= ? AND (w.user_id = ? OR w.user_id IS NULL)
    GROUP BY w.id
    ORDER BY w.date
`);

const getDetailedStatsStmt = db.prepare(`
    SELECT 
        COUNT(DISTINCT w.id) as total_workouts,
        COUNT(s.id) as total_sets,
        SUM(s.weight * s.reps) as total_volume,
        COUNT(DISTINCT e.id) as active_exercises
    FROM sets s
    JOIN workouts w ON s.workout_id = w.id
    JOIN exercises e ON s.exercise_id = e.id
    WHERE w.date >= ? AND (w.user_id = ? OR w.user_id IS NULL)
`);

const getWeeklyStatsStmt = db.prepare(`
    SELECT 
        strftime('%Y-%W', w.date) as week,
        MIN(w.date) as week_start,
        COUNT(DISTINCT w.id) as workout_count,
        SUM(s.weight * s.reps) as volume
    FROM sets s
    JOIN workouts w ON s.workout_id = w.id
    WHERE w.date >= ? AND (w.user_id = ? OR w.user_id IS NULL)
    GROUP BY week
    ORDER BY week
`);

const getExerciseVolumeStatsStmt = db.prepare(`
    SELECT 
        e.name,
        COUNT(s.id) as set_count,
        SUM(s.weight * s.reps) as volume
    FROM sets s
    JOIN workouts w ON s.workout_id = w.id
    JOIN exercises e ON s.exercise_id = e.id
    WHERE w.date >= ? AND (w.user_id = ? OR w.user_id IS NULL)
    GROUP BY e.id, e.name
    ORDER BY volume DESC
`);

// Dauer-Berechnung und Ausreißer-Bereinigung
function calculateAndCleanDurations() {
    const workouts = db.prepare(`SELECT DISTINCT workout_id FROM sets`).all();

    for (const { workout_id } of workouts) {
        const sets = db.prepare(`
            SELECT id, created_at, completed_at 
            FROM sets 
            WHERE workout_id = ? 
            ORDER BY created_at
        `).all(workout_id);

        for (let i = 0; i < sets.length; i++) {
            const currentSet = sets[i];
            let durationSeconds = null;

            if (i > 0) {
                const prevSet = sets[i - 1];
                const prevTime = new Date(prevSet.completed_at || prevSet.created_at).getTime();
                const currentTime = new Date(currentSet.created_at).getTime();
                durationSeconds = Math.round((currentTime - prevTime) / 1000);
            }

            if (durationSeconds !== null) {
                db.prepare(`UPDATE sets SET duration_seconds = ? WHERE id = ?`)
                    .run(durationSeconds, currentSet.id);
            }
        }

        cleanDurationOutliers(workout_id);
    }
}

function cleanDurationOutliers(workout_id) {
    const exercises = db.prepare(`
        SELECT DISTINCT exercise_id FROM sets WHERE workout_id = ?
    `).all(workout_id);

    for (const { exercise_id } of exercises) {
        const durations = db.prepare(`
            SELECT id, duration_seconds 
            FROM sets 
            WHERE workout_id = ? AND exercise_id = ? AND duration_seconds IS NOT NULL
            ORDER BY duration_seconds
        `).all(workout_id, exercise_id);

        if (durations.length < 4) {
            for (const { id, duration_seconds } of durations) {
                db.prepare(`UPDATE sets SET duration_cleaned = ? WHERE id = ?`)
                    .run(duration_seconds, id);
            }
            continue;
        }

        const values = durations.map(d => d.duration_seconds);
        const q1Index = Math.floor(values.length * 0.25);
        const q3Index = Math.floor(values.length * 0.75);
        const q1 = values[q1Index];
        const q3 = values[q3Index];
        const iqr = q3 - q1;
        
        const lowerBound = Math.max(0, q1 - 1.5 * iqr);
        const upperBound = q3 + 1.5 * iqr;

        const medianIndex = Math.floor(values.length / 2);
        const median = values.length % 2 === 0 
            ? (values[medianIndex - 1] + values[medianIndex]) / 2 
            : values[medianIndex];

        for (const { id, duration_seconds } of durations) {
            const cleanedDuration = (duration_seconds < lowerBound || duration_seconds > upperBound)
                ? Math.round(median)
                : duration_seconds;
            
            db.prepare(`UPDATE sets SET duration_cleaned = ? WHERE id = ?`)
                .run(cleanedDuration, id);
        }
    }
}

const RENUMBER_SET_OFFSET = 1000000;

function renumberSetsForWorkoutExercise(workoutId, exerciseId) {
    // Avoid unique constraint collisions by bumping first
    bumpSetNumbersForWorkoutExerciseStmt.run(RENUMBER_SET_OFFSET, workoutId, exerciseId);

    const rows = getSetIdsForWorkoutExerciseStmt.all(workoutId, exerciseId);
    rows.forEach((row, index) => {
        updateSetNumberByIdStmt.run(index + 1, row.id);
    });

    return { count: rows.length };
}

const deleteSetWithRenumberTx = db.transaction((setId) => {
    const meta = getSetMetaByIdStmt.get(setId);
    if (!meta) return { deleted: false, renumbered: 0 };

    deleteSetStmt.run(setId);

    const renumber = renumberSetsForWorkoutExercise(meta.workout_id, meta.exercise_id);
    return { deleted: true, renumbered: renumber.count };
});

const linkSetsTx = db.transaction((setId, targetSetId) => {
    const set = getSetMetaByIdStmt.get(setId);
    const target = getSetMetaByIdStmt.get(targetSetId);

    if (!set || !target) {
        throw new Error('Set not found');
    }

    const setSuperset = set.superset_id || null;
    const targetSuperset = target.superset_id || null;

    // Prefer existing superset id if available
    let supersetId = setSuperset || targetSuperset;

    // If both sets already belong to different supersets, merge them
    if (setSuperset && targetSuperset && setSuperset !== targetSuperset) {
        supersetId = setSuperset;
        updateSupersetIdForAllSetsStmt.run(supersetId, targetSuperset);
    }

    // If neither has a superset, create a new one
    if (!supersetId) {
        supersetId = crypto.randomUUID();
    }

    updateSetSupersetStmt.run(supersetId, set.id);
    updateSetSupersetStmt.run(supersetId, target.id);

    return { superset_id: supersetId };
});

// Helper für User Check bei Updates/Deletes
function checkUserOwnership(workoutId, userId) {
    if (!userId) return true; // Legacy/Admin mode or skipping check if userId not provided (careful!)
    const workout = db.prepare('SELECT user_id FROM workouts WHERE id = ?').get(workoutId);
    return workout && (workout.user_id === userId || workout.user_id === null);
}

module.exports = {
    db,
    
    // Auth & User
    createUser: (email, name, picture, provider, providerId) => {
        return createUserStmt.get(email, name, picture, provider, providerId);
    },
    createSession: (sessionId, userId, expiresAt) => {
        createSessionStmt.run(sessionId, userId, expiresAt);
    },
    getSession: (sessionId) => {
        return getSessionStmt.get(sessionId);
    },
    deleteSession: (sessionId) => {
        deleteSessionStmt.run(sessionId);
    },

    // Übungen
    getExercises: (userId) => getExercisesStmt.all(userId),
    getExerciseById: (id, userId) => getExerciseByIdStmt.get(id, userId),
    getExerciseByName: (name, userId) => getExerciseByNameStmt.get(name, userId),
    createExercise: (name, userId) => {
        try {
            const result = insertExerciseStmt.run(name, userId);
            return { id: result.lastInsertRowid, name, user_id: userId };
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return getExerciseByNameStmt.get(name, userId);
            }
            throw err;
        }
    },
    updateExercise: (id, name, icon, muscleGroups, userId) => {
        updateExerciseStmt.run(name, icon || null, muscleGroups || null, id, userId);
        return getExerciseByIdStmt.get(id, userId);
    },
    
    // Workouts
    getWorkouts: (userId) => getWorkoutsStmt.all(userId),
    getLastNWorkouts: (n, userId) => getLastNWorkoutsStmt.all(userId, n),
    getWorkoutByDate: (date, userId) => getWorkoutByDateStmt.get(date, userId),
    createWorkout: (date, userId) => {
        try {
            const result = insertWorkoutStmt.run(date, userId);
            return { id: result.lastInsertRowid, date, user_id: userId };
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return getWorkoutByDateStmt.get(date, userId);
            }
            throw err;
        }
    },
    
    // Sätze
    getSetsForWorkout: (workoutId) => getSetsForWorkoutStmt.all(workoutId),
    getAllSetsWithDetails: (userId) => getAllSetsWithDetailsStmt.all(userId),
    getLastSetForExercise: (exerciseId, setNumber, userId) => getLastSetForExerciseStmt.get(exerciseId, setNumber, userId),
    createSet: (workoutId, exerciseId, setNumber, weight, reps, difficulty, createdAt = null, supersetId = null) => {
        // Hier sollte eigentlich geprüft werden, ob das Workout dem User gehört.
        // Das passiert implizit, da createSet nur aufgerufen wird, wenn das Workout vorher gefunden/erstellt wurde.
        try {
            if (createdAt) {
                const result = insertSetStmt.run(workoutId, exerciseId, setNumber, weight, reps, difficulty, supersetId, createdAt);
                return { id: result.lastInsertRowid };
            }
            const result = insertSetSimpleStmt.run(workoutId, exerciseId, setNumber, weight, reps, difficulty, supersetId);
            return { id: result.lastInsertRowid };
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                const existing = db.prepare(`
                    SELECT id FROM sets 
                    WHERE workout_id = ? AND exercise_id = ? AND set_number = ?
                `).get(workoutId, exerciseId, setNumber);
                if (existing) {
                    updateSetStmt.run(weight, reps, difficulty, existing.id);
                    return { id: existing.id, updated: true };
                }
            }
            throw err;
        }
    },
    updateSet: (id, weight, reps, difficulty, userId) => {
        // Check ownership via workout
        const meta = getSetMetaByIdStmt.get(id);
        if (!meta) throw new Error('Set not found');
        if (userId && meta.user_id !== userId && meta.user_id !== null) throw new Error('Unauthorized');
        
        updateSetStmt.run(weight, reps, difficulty, id);
    },
    deleteSet: (id, userId) => {
        const meta = getSetMetaByIdStmt.get(id);
        if (!meta) return { deleted: false };
        if (userId && meta.user_id !== userId && meta.user_id !== null) throw new Error('Unauthorized');
        
        return deleteSetWithRenumberTx(id);
    },
    
    // Supersets
    linkSets: (setId, targetSetId, userId) => {
        // Verify ownership of both
        const s1 = getSetMetaByIdStmt.get(setId);
        const s2 = getSetMetaByIdStmt.get(targetSetId);
        
        if (!s1 || !s2) throw new Error('Set not found');
        if (userId && ((s1.user_id !== userId && s1.user_id !== null) || (s2.user_id !== userId && s2.user_id !== null))) {
            throw new Error('Unauthorized');
        }
        return linkSetsTx(setId, targetSetId);
    },
    linkSuperset: (setId, supersetId) => {
        updateSetSupersetStmt.run(supersetId, setId);
    },
    unlinkSuperset: (setId, userId) => {
        const meta = getSetMetaByIdStmt.get(setId);
        if (userId && meta.user_id !== userId && meta.user_id !== null) throw new Error('Unauthorized');
        updateSetSupersetStmt.run(null, setId);
    },
    getSupersetPartners: (supersetId, excludeSetId, userId) => {
        if (!supersetId) return [];
        return getSetsWithSameSupersetStmt.all(supersetId, excludeSetId, userId);
    },
    deleteExercise: (id, userId) => {
        // Verify ownership
        const ex = getExerciseByIdStmt.get(id, userId);
        if (!ex) return { changes: 0 }; // Not found or not owned
        
        // Erst alle Sätze der Übung löschen
        db.prepare(`DELETE FROM sets WHERE exercise_id = ?`).run(id);
        // Dann die Übung selbst
        return deleteExerciseStmt.run(id);
    },
    completeSet: (id) => completeSetStmt.run(id),
    
    // Dauer
    calculateAndCleanDurations,
    
    // Statistiken
    getWeightProgressionForExercise: (exerciseId, startDate, userId) => {
        const start = startDate || '1970-01-01';
        return getWeightProgressionForExerciseStmt.all(exerciseId, start, userId);
    },
    
    getStats: (startDate, userId) => {
        const start = startDate || '1970-01-01';
        
        return {
            totals: getDetailedStatsStmt.get(start, userId),
            weekly: getWeeklyStatsStmt.all(start, userId),
            exercises: getExerciseVolumeStatsStmt.all(start, userId)
        };
    },
    
    // Utility
    close: () => db.close()
};
