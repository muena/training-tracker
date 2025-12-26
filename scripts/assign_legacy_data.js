const Database = require('better-sqlite3');
const path = require('path');

// Datenbank-Pfad
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'training.db');
const db = new Database(DB_PATH);

const email = process.argv[2];

if (!email) {
    console.error('❌ Bitte E-Mail angeben: node scripts/assign_legacy_data.js <email>');
    process.exit(1);
}

// 1. User finden
const user = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);

if (!user) {
    console.error(`❌ User "${email}" nicht gefunden.`);
    console.error('   Bitte logge dich erst einmal in der App ein, damit der User erstellt wird.');
    process.exit(1);
}

console.log(`✅ User gefunden: ${user.name} (ID: ${user.id})`);

// 2. Daten zuweisen
const updateWorkouts = db.prepare('UPDATE workouts SET user_id = ? WHERE user_id IS NULL');
const updateExercises = db.prepare('UPDATE exercises SET user_id = ? WHERE user_id IS NULL');

try {
    const result = db.transaction(() => {
        const w = updateWorkouts.run(user.id);
        const e = updateExercises.run(user.id);
        return { workouts: w.changes, exercises: e.changes };
    })();

    console.log(`🎉 Erfolg! Zugewiesen an ${email}:`);
    console.log(`   - ${result.workouts} Workouts`);
    console.log(`   - ${result.exercises} Übungen`);
    
} catch (error) {
    console.error('❌ Fehler beim Update:', error.message);
} finally {
    db.close();
}
