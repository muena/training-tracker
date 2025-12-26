#!/usr/bin/env node
/**
 * Supersatz-Migrations-Skript
 * 
 * Dieses Skript konvertiert "Super"-Übungen (z.B. "Bizeps/Trizeps Super Kabelzug")
 * in separate Übungen mit verknüpften Sätzen (superset_id).
 * 
 * Verwendung:
 *   node scripts/migrate_supersets.js           # Dry-Run (zeigt nur, was passieren würde)
 *   node scripts/migrate_supersets.js --execute # Führt die Migration durch
 * 
 * Das Skript:
 * 1. Findet alle "Super"-Übungen
 * 2. Erstellt die Ziel-Übungen (falls nicht vorhanden)
 * 3. Dupliziert jeden Satz der Super-Übung für jede Ziel-Übung
 * 4. Verknüpft die duplizierten Sätze mit einer gemeinsamen superset_id
 * 5. Löscht die alte Super-Übung und ihre Sätze
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

// Datenbank-Pfad
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'training.db');

// Konfiguration: Welche Super-Übungen wie aufgeteilt werden
const MIGRATION_MAP = {
    "Bizeps/Trizeps Super Kabelzug": {
        targets: ["Bizeps – Kabelzug", "Trizeps – Kabelzug"],
        // Optional: Gewichte können angepasst werden (z.B. wenn Bizeps weniger Gewicht hat)
        // weightAdjust: { "Bizeps – Kabelzug": 0.8, "Trizeps – Kabelzug": 1.0 }
    },
    "Rudern/Lat Super": {
        targets: ["Rudermaschine", "Latzug"],
    }
    // Weitere Super-Übungen hier hinzufügen:
    // "Brust/Rücken Super": {
    //     targets: ["Bankdrücken", "Rudermaschine"],
    // }
};

// CLI Argument
const EXECUTE = process.argv.includes('--execute');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║   Supersatz-Migrations-Skript                            ║');
console.log('╠══════════════════════════════════════════════════════════╣');
console.log(`║   Modus: ${EXECUTE ? 'EXECUTE (Änderungen werden durchgeführt!)' : 'DRY-RUN (keine Änderungen)'}     ║`);
console.log(`║   Datenbank: ${DB_PATH.slice(-40).padStart(40)}   ║`);
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');

// Datenbank öffnen
const db = new Database(DB_PATH);

// Hilfsfunktionen
function generateSupersetId() {
    return crypto.randomUUID();
}

function getExerciseByName(name) {
    return db.prepare('SELECT * FROM exercises WHERE name = ?').get(name);
}

function getExerciseById(id) {
    return db.prepare('SELECT * FROM exercises WHERE id = ?').get(id);
}

function createExercise(name) {
    const result = db.prepare('INSERT INTO exercises (name) VALUES (?)').run(name);
    return { id: result.lastInsertRowid, name };
}

function getSetsForExercise(exerciseId) {
    return db.prepare(`
        SELECT s.*, w.date as workout_date
        FROM sets s
        JOIN workouts w ON s.workout_id = w.id
        WHERE s.exercise_id = ?
        ORDER BY w.date, s.set_number
    `).all(exerciseId);
}

function getNextSetNumber(workoutId, exerciseId) {
    const result = db.prepare(`
        SELECT MAX(set_number) as max_num FROM sets 
        WHERE workout_id = ? AND exercise_id = ?
    `).get(workoutId, exerciseId);
    return (result.max_num || 0) + 1;
}

function insertSet(workoutId, exerciseId, setNumber, weight, reps, difficulty, supersetId, createdAt) {
    return db.prepare(`
        INSERT INTO sets (workout_id, exercise_id, set_number, weight, reps, difficulty, superset_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(workoutId, exerciseId, setNumber, weight, reps, difficulty, supersetId, createdAt);
}

function deleteSetsByExercise(exerciseId) {
    return db.prepare('DELETE FROM sets WHERE exercise_id = ?').run(exerciseId);
}

function deleteExercise(exerciseId) {
    return db.prepare('DELETE FROM exercises WHERE id = ?').run(exerciseId);
}

// Hauptlogik
function migrate() {
    const stats = {
        superExercisesProcessed: 0,
        setsCreated: 0,
        setsDeleted: 0,
        exercisesCreated: 0,
        exercisesDeleted: 0,
        errors: []
    };

    for (const [superName, config] of Object.entries(MIGRATION_MAP)) {
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Verarbeite: "${superName}"`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        // Super-Übung finden
        const superExercise = getExerciseByName(superName);
        if (!superExercise) {
            console.log(`  ⚠️  Übung nicht gefunden - übersprungen`);
            continue;
        }

        // Sätze der Super-Übung holen
        const superSets = getSetsForExercise(superExercise.id);
        console.log(`  📊 Gefundene Sätze: ${superSets.length}`);

        if (superSets.length === 0) {
            console.log(`  ⚠️  Keine Sätze - nur Übung wird gelöscht`);
            if (EXECUTE) {
                deleteExercise(superExercise.id);
                stats.exercisesDeleted++;
            }
            continue;
        }

        // Ziel-Übungen vorbereiten
        const targetExercises = [];
        for (const targetName of config.targets) {
            let exercise = getExerciseByName(targetName);
            if (!exercise) {
                console.log(`  ➕ Erstelle Übung: "${targetName}"`);
                if (EXECUTE) {
                    exercise = createExercise(targetName);
                    stats.exercisesCreated++;
                } else {
                    exercise = { id: `NEW-${targetName}`, name: targetName };
                }
            } else {
                console.log(`  ✓  Übung existiert: "${targetName}" (ID: ${exercise.id})`);
            }
            targetExercises.push(exercise);
        }

        // Jeden Satz duplizieren
        console.log(`\n  Erstelle verknüpfte Sätze:`);
        
        for (const set of superSets) {
            const supersetId = generateSupersetId();
            console.log(`\n    📅 ${set.workout_date} | Set #${set.set_number}: ${set.weight}kg × ${set.reps}`);
            console.log(`       Superset-ID: ${supersetId.slice(0, 8)}...`);
            
            for (const targetExercise of targetExercises) {
                // Gewichtsanpassung (falls konfiguriert)
                let weight = set.weight;
                if (config.weightAdjust && config.weightAdjust[targetExercise.name]) {
                    weight = Math.round(set.weight * config.weightAdjust[targetExercise.name] * 10) / 10;
                }

                // Set-Nummer für Ziel-Übung bestimmen
                let setNumber;
                if (EXECUTE) {
                    setNumber = getNextSetNumber(set.workout_id, targetExercise.id);
                } else {
                    setNumber = '?';
                }

                console.log(`       → ${targetExercise.name}: ${weight}kg × ${set.reps} (Set #${setNumber})`);

                if (EXECUTE) {
                    insertSet(
                        set.workout_id,
                        targetExercise.id,
                        setNumber,
                        weight,
                        set.reps,
                        set.difficulty,
                        supersetId,
                        set.created_at
                    );
                    stats.setsCreated++;
                }
            }
        }

        // Alte Sätze und Übung löschen
        console.log(`\n  🗑️  Lösche alte Sätze und Übung...`);
        if (EXECUTE) {
            const deleted = deleteSetsByExercise(superExercise.id);
            stats.setsDeleted += deleted.changes;
            
            deleteExercise(superExercise.id);
            stats.exercisesDeleted++;
        }

        stats.superExercisesProcessed++;
    }

    return stats;
}

// Ausführung
try {
    if (EXECUTE) {
        // Transaktion für atomare Änderungen
        const runMigration = db.transaction(() => {
            return migrate();
        });
        
        const stats = runMigration();
        
        console.log('\n');
        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║   ✅ Migration erfolgreich abgeschlossen!                ║');
        console.log('╠══════════════════════════════════════════════════════════╣');
        console.log(`║   Super-Übungen verarbeitet: ${String(stats.superExercisesProcessed).padStart(3)}                        ║`);
        console.log(`║   Neue Sätze erstellt:       ${String(stats.setsCreated).padStart(3)}                        ║`);
        console.log(`║   Alte Sätze gelöscht:       ${String(stats.setsDeleted).padStart(3)}                        ║`);
        console.log(`║   Neue Übungen erstellt:     ${String(stats.exercisesCreated).padStart(3)}                        ║`);
        console.log(`║   Alte Übungen gelöscht:     ${String(stats.exercisesDeleted).padStart(3)}                        ║`);
        console.log('╚══════════════════════════════════════════════════════════╝');
    } else {
        const stats = migrate();
        
        console.log('\n');
        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║   ℹ️  DRY-RUN abgeschlossen (keine Änderungen)           ║');
        console.log('╠══════════════════════════════════════════════════════════╣');
        console.log(`║   Super-Übungen würden verarbeitet: ${String(stats.superExercisesProcessed).padStart(3)}                 ║`);
        console.log('║                                                          ║');
        console.log('║   Führe mit --execute aus, um Migration durchzuführen:   ║');
        console.log('║   node scripts/migrate_supersets.js --execute            ║');
        console.log('╚══════════════════════════════════════════════════════════╝');
    }
} catch (error) {
    console.error('\n❌ Fehler bei der Migration:', error.message);
    console.error(error.stack);
    process.exit(1);
} finally {
    db.close();
}
