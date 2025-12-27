#!/usr/bin/env node
/**
 * Duration Calculator for Training Tracker
 * 
 * Calculates rest time between sets based on created_at timestamps.
 * Runs periodically as a sidecar container.
 * 
 * Logic:
 * 1. For each workout, order all sets by created_at
 * 2. Calculate duration as time since previous set (any exercise)
 * 3. For first set: use last warmup end time if available
 * 4. Clean outliers using IQR method (per exercise within workout)
 * 5. Mark extreme outliers (likely breaks/pauses)
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || '/data/training.db';
const INTERVAL_MINUTES = parseInt(process.env.CALC_INTERVAL || '5');

console.log(`Duration Calculator starting...`);
console.log(`Database: ${DB_PATH}`);
console.log(`Interval: ${INTERVAL_MINUTES} minutes`);

function calculateDurations() {
    let db;
    try {
        db = new Database(DB_PATH, { readonly: false });
        db.pragma('journal_mode = WAL');
        
        const startTime = Date.now();
        let setsUpdated = 0;
        let outliersFound = 0;
        
        // Get all workouts that have sets without duration calculated
        // or all workouts if we want to recalculate
        const workouts = db.prepare(`
            SELECT DISTINCT w.id, w.date, w.user_id
            FROM workouts w
            JOIN sets s ON w.id = s.workout_id
            WHERE s.duration_seconds IS NULL
               OR s.duration_cleaned IS NULL
            ORDER BY w.date DESC
            LIMIT 100
        `).all();
        
        if (workouts.length === 0) {
            console.log(`[${new Date().toISOString()}] No workouts need duration calculation`);
            db.close();
            return;
        }
        
        console.log(`[${new Date().toISOString()}] Processing ${workouts.length} workouts...`);
        
        for (const workout of workouts) {
            // Get all sets for this workout, ordered by creation time
            const sets = db.prepare(`
                SELECT s.id, s.exercise_id, s.created_at, s.completed_at, s.set_number,
                       e.name as exercise_name
                FROM sets s
                JOIN exercises e ON s.exercise_id = e.id
                WHERE s.workout_id = ?
                ORDER BY s.created_at ASC
            `).all(workout.id);
            
            if (sets.length === 0) continue;
            
            // Get last warmup for this workout (as potential start reference)
            const lastWarmup = db.prepare(`
                SELECT created_at, duration_seconds
                FROM warmups
                WHERE workout_id = ?
                ORDER BY created_at DESC
                LIMIT 1
            `).get(workout.id);
            
            // Calculate raw durations
            for (let i = 0; i < sets.length; i++) {
                const currentSet = sets[i];
                let durationSeconds = null;
                
                if (i === 0) {
                    // First set - use warmup end time if available
                    if (lastWarmup) {
                        const warmupEndTime = new Date(lastWarmup.created_at).getTime() + 
                                             (lastWarmup.duration_seconds * 1000);
                        const setStartTime = new Date(currentSet.created_at).getTime();
                        durationSeconds = Math.round((setStartTime - warmupEndTime) / 1000);
                        
                        // If negative or too short, warmup was probably after first set
                        if (durationSeconds < 0) durationSeconds = null;
                    }
                } else {
                    // Subsequent sets - time since previous set
                    const prevSet = sets[i - 1];
                    const prevTime = new Date(prevSet.completed_at || prevSet.created_at).getTime();
                    const currentTime = new Date(currentSet.created_at).getTime();
                    durationSeconds = Math.round((currentTime - prevTime) / 1000);
                }
                
                // Sanity check: duration should be positive and less than 30 minutes
                if (durationSeconds !== null && (durationSeconds < 0 || durationSeconds > 1800)) {
                    // Mark as outlier but keep the value
                    durationSeconds = Math.abs(durationSeconds);
                }
                
                if (durationSeconds !== null) {
                    db.prepare(`UPDATE sets SET duration_seconds = ? WHERE id = ?`)
                        .run(durationSeconds, currentSet.id);
                    setsUpdated++;
                }
            }
            
            // Clean outliers per exercise within this workout
            const exercises = db.prepare(`
                SELECT DISTINCT exercise_id FROM sets WHERE workout_id = ?
            `).all(workout.id);
            
            for (const { exercise_id } of exercises) {
                const result = cleanOutliersForExercise(db, workout.id, exercise_id);
                outliersFound += result.outliers;
            }
        }
        
        const elapsed = Date.now() - startTime;
        console.log(`[${new Date().toISOString()}] Completed: ${setsUpdated} sets updated, ${outliersFound} outliers cleaned in ${elapsed}ms`);
        
        db.close();
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error:`, error.message);
        if (db) db.close();
    }
}

function cleanOutliersForExercise(db, workoutId, exerciseId) {
    const durations = db.prepare(`
        SELECT id, duration_seconds 
        FROM sets 
        WHERE workout_id = ? AND exercise_id = ? AND duration_seconds IS NOT NULL
        ORDER BY duration_seconds ASC
    `).all(workoutId, exerciseId);
    
    if (durations.length === 0) {
        return { outliers: 0 };
    }
    
    // If less than 4 data points, just copy raw values
    if (durations.length < 4) {
        for (const { id, duration_seconds } of durations) {
            db.prepare(`UPDATE sets SET duration_cleaned = ? WHERE id = ?`)
                .run(duration_seconds, id);
        }
        return { outliers: 0 };
    }
    
    // Calculate IQR bounds
    const values = durations.map(d => d.duration_seconds);
    const q1Index = Math.floor(values.length * 0.25);
    const q3Index = Math.floor(values.length * 0.75);
    const q1 = values[q1Index];
    const q3 = values[q3Index];
    const iqr = q3 - q1;
    
    // Use 1.5 * IQR for mild outliers
    const lowerBound = Math.max(10, q1 - 1.5 * iqr); // At least 10 seconds rest
    const upperBound = Math.min(600, q3 + 1.5 * iqr); // At most 10 minutes
    
    // Calculate median for replacement
    const medianIndex = Math.floor(values.length / 2);
    const median = values.length % 2 === 0 
        ? (values[medianIndex - 1] + values[medianIndex]) / 2 
        : values[medianIndex];
    
    let outliers = 0;
    
    for (const { id, duration_seconds } of durations) {
        let cleanedDuration = duration_seconds;
        
        if (duration_seconds < lowerBound || duration_seconds > upperBound) {
            // Replace outlier with median
            cleanedDuration = Math.round(median);
            outliers++;
        }
        
        db.prepare(`UPDATE sets SET duration_cleaned = ? WHERE id = ?`)
            .run(cleanedDuration, id);
    }
    
    return { outliers };
}

// Initial run
calculateDurations();

// Schedule periodic runs
setInterval(calculateDurations, INTERVAL_MINUTES * 60 * 1000);

console.log(`Duration Calculator running. Next calculation in ${INTERVAL_MINUTES} minutes.`);

// Keep process alive
process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Shutting down...');
    process.exit(0);
});
