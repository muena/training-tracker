const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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
    CREATE TABLE IF NOT EXISTS exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS workouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE NOT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workout_id INTEGER NOT NULL,
        exercise_id INTEGER NOT NULL,
        set_number INTEGER NOT NULL,
        weight REAL NOT NULL DEFAULT 0,
        reps INTEGER NOT NULL DEFAULT 0,
        difficulty TEXT DEFAULT 'Mittel',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        duration_seconds INTEGER,
        duration_cleaned INTEGER,
        FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE,
        FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
        UNIQUE(workout_id, exercise_id, set_number)
    )
`);

// Indizes
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sets_workout ON sets(workout_id);
    CREATE INDEX IF NOT EXISTS idx_sets_exercise ON sets(exercise_id);
    CREATE INDEX IF NOT EXISTS idx_sets_created ON sets(created_at);
    CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
`);

console.log('Database initialized successfully');

// CRUD Operationen - Prepared Statements (nach Schema-Erstellung)

// Übungen
const getExercisesStmt = db.prepare(`
    SELECT id, name, created_at FROM exercises ORDER BY name
`);

const getExerciseByIdStmt = db.prepare(`
    SELECT id, name, created_at FROM exercises WHERE id = ?
`);

const getExerciseByNameStmt = db.prepare(`
    SELECT id, name, created_at FROM exercises WHERE name = ?
`);

const insertExerciseStmt = db.prepare(`
    INSERT INTO exercises (name) VALUES (?)
`);

// Workouts
const getWorkoutsStmt = db.prepare(`
    SELECT id, date, notes, created_at FROM workouts ORDER BY date DESC
`);

const getLastNWorkoutsStmt = db.prepare(`
    SELECT id, date, notes, created_at FROM workouts ORDER BY date DESC LIMIT ?
`);

const getWorkoutByDateStmt = db.prepare(`
    SELECT id, date, notes, created_at FROM workouts WHERE date = ?
`);

const insertWorkoutStmt = db.prepare(`
    INSERT INTO workouts (date) VALUES (?)
`);

// Sätze
const getSetsForWorkoutStmt = db.prepare(`
    SELECT 
        s.id, s.set_number, s.weight, s.reps, s.difficulty, 
        s.created_at, s.completed_at, s.duration_seconds, s.duration_cleaned,
        e.id as exercise_id, e.name as exercise_name
    FROM sets s
    JOIN exercises e ON s.exercise_id = e.id
    WHERE s.workout_id = ?
    ORDER BY s.created_at, s.set_number
`);

const getAllSetsWithDetailsStmt = db.prepare(`
    SELECT 
        s.id, s.set_number, s.weight, s.reps, s.difficulty, 
        s.created_at, s.completed_at, s.duration_seconds, s.duration_cleaned,
        e.id as exercise_id, e.name as exercise_name,
        w.id as workout_id, w.date as workout_date
    FROM sets s
    JOIN exercises e ON s.exercise_id = e.id
    JOIN workouts w ON s.workout_id = w.id
    ORDER BY w.date DESC, s.created_at, s.set_number
`);

const getLastSetForExerciseStmt = db.prepare(`
    SELECT 
        s.id, s.set_number, s.weight, s.reps, s.difficulty,
        w.date as workout_date
    FROM sets s
    JOIN workouts w ON s.workout_id = w.id
    WHERE s.exercise_id = ? AND s.set_number = ?
    ORDER BY w.date DESC
    LIMIT 1
`);

const insertSetStmt = db.prepare(`
    INSERT INTO sets (workout_id, exercise_id, set_number, weight, reps, difficulty, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertSetSimpleStmt = db.prepare(`
    INSERT INTO sets (workout_id, exercise_id, set_number, weight, reps, difficulty, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
`);

const updateSetStmt = db.prepare(`
    UPDATE sets SET weight = ?, reps = ?, difficulty = ? WHERE id = ?
`);

const deleteSetStmt = db.prepare(`
    DELETE FROM sets WHERE id = ?
`);

const getSetMetaByIdStmt = db.prepare(`
    SELECT id, workout_id, exercise_id, set_number
    FROM sets
    WHERE id = ?
`);

const getSetIdsForWorkoutExerciseStmt = db.prepare(`
    SELECT id, set_number
    FROM sets
    WHERE workout_id = ? AND exercise_id = ?
    ORDER BY set_number
`);

const bumpSetNumbersForWorkoutExerciseStmt = db.prepare(`
    UPDATE sets
    SET set_number = set_number + ?
    WHERE workout_id = ? AND exercise_id = ?
`);

const updateSetNumberByIdStmt = db.prepare(`
    UPDATE sets SET set_number = ? WHERE id = ?
`);

const deleteExerciseStmt = db.prepare(`
    DELETE FROM exercises WHERE id = ?
`);

const completeSetStmt = db.prepare(`
    UPDATE sets SET completed_at = datetime('now') WHERE id = ?
`);

// Statistik-Abfragen
const getWeightProgressionForExerciseStmt = db.prepare(`
    SELECT 
        w.date as workout_date,
        MAX(s.weight) as max_weight,
        AVG(s.weight) as avg_weight,
        AVG(s.reps) as avg_reps,
        SUM(s.weight * s.reps) as total_volume,
        COUNT(s.id) as set_count
    FROM sets s
    JOIN workouts w ON s.workout_id = w.id
    WHERE s.exercise_id = ? AND w.date >= ?
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
    WHERE w.date >= ?
`);

const getWeeklyStatsStmt = db.prepare(`
    SELECT 
        strftime('%Y-%W', w.date) as week,
        MIN(w.date) as week_start,
        COUNT(DISTINCT w.id) as workout_count,
        SUM(s.weight * s.reps) as volume
    FROM sets s
    JOIN workouts w ON s.workout_id = w.id
    WHERE w.date >= ?
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
    WHERE w.date >= ?
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

module.exports = {
    db,
    
    // Übungen
    getExercises: () => getExercisesStmt.all(),
    getExerciseById: (id) => getExerciseByIdStmt.get(id),
    getExerciseByName: (name) => getExerciseByNameStmt.get(name),
    createExercise: (name) => {
        try {
            const result = insertExerciseStmt.run(name);
            return { id: result.lastInsertRowid, name };
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return getExerciseByNameStmt.get(name);
            }
            throw err;
        }
    },
    
    // Workouts
    getWorkouts: () => getWorkoutsStmt.all(),
    getLastNWorkouts: (n) => getLastNWorkoutsStmt.all(n),
    getWorkoutByDate: (date) => getWorkoutByDateStmt.get(date),
    createWorkout: (date) => {
        try {
            const result = insertWorkoutStmt.run(date);
            return { id: result.lastInsertRowid, date };
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return getWorkoutByDateStmt.get(date);
            }
            throw err;
        }
    },
    
    // Sätze
    getSetsForWorkout: (workoutId) => getSetsForWorkoutStmt.all(workoutId),
    getAllSetsWithDetails: () => getAllSetsWithDetailsStmt.all(),
    getLastSetForExercise: (exerciseId, setNumber) => getLastSetForExerciseStmt.get(exerciseId, setNumber),
    createSet: (workoutId, exerciseId, setNumber, weight, reps, difficulty, createdAt = null) => {
        try {
            if (createdAt) {
                const result = insertSetStmt.run(workoutId, exerciseId, setNumber, weight, reps, difficulty, createdAt);
                return { id: result.lastInsertRowid };
            }
            const result = insertSetSimpleStmt.run(workoutId, exerciseId, setNumber, weight, reps, difficulty);
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
    updateSet: (id, weight, reps, difficulty) => updateSetStmt.run(weight, reps, difficulty, id),
    deleteSet: (id) => deleteSetWithRenumberTx(id),
    deleteExercise: (id) => {
        // Erst alle Sätze der Übung löschen
        db.prepare(`DELETE FROM sets WHERE exercise_id = ?`).run(id);
        // Dann die Übung selbst
        return deleteExerciseStmt.run(id);
    },
    completeSet: (id) => completeSetStmt.run(id),
    
    // Dauer
    calculateAndCleanDurations,
    
    // Statistiken
    getWeightProgressionForExercise: (exerciseId, startDate) => {
        const start = startDate || '1970-01-01';
        return getWeightProgressionForExerciseStmt.all(exerciseId, start);
    },
    
    getStats: (startDate) => {
        const start = startDate || '1970-01-01';
        
        return {
            totals: getDetailedStatsStmt.get(start),
            weekly: getWeeklyStatsStmt.all(start),
            exercises: getExerciseVolumeStatsStmt.all(start)
        };
    },
    
    // Utility
    close: () => db.close()
};
