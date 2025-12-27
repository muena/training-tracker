/**
 * Migration Script: Importiert Daten aus der alten Datenquelle in SQLite
 * 
 * Verwendung:
 *   node migrate.js
 * 
 * Benötigte Umgebungsvariablen:
 *   NOTION_API_KEY - API Key für die alte Datenquelle
 *   DATABASE_ID - ID der alten Datenbank
 */

const https = require('https');

// Konfiguration aus Umgebungsvariablen
const API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = process.env.DATABASE_ID;
const API_VERSION = '2025-09-03';

if (!API_KEY || !DATABASE_ID) {
    console.error('Missing NOTION_API_KEY or DATABASE_ID.');
    console.error('Set them in your environment before running:');
    console.error('  NOTION_API_KEY=... DATABASE_ID=... node migrate.js');
    process.exit(1);
}

// Data Source IDs aus der alten Struktur
const DATA_SOURCES = {
    SETS: '3e719c6c-a738-4c08-bd32-0f474a403a1f',
    EXERCISES: 'fbeb3643-23ec-4ab2-a670-a193c7a02622',
    WORKOUTS: '273f191f-db22-4e26-ad52-9d7193affa06'
};

// HTTP Request Helper
function makeRequest(path, method, body = null) {
    return new Promise((resolve, reject) => {
        const bodyStr = body ? JSON.stringify(body) : null;
        const options = {
            hostname: 'api.notion.com',
            path,
            method,
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Notion-Version': API_VERSION,
                'Content-Type': 'application/json',
                ...(bodyStr && { 'Content-Length': Buffer.byteLength(bodyStr) })
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Invalid JSON response: ${data}`));
                }
            });
        });

        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

// Alle Seiten mit Pagination abrufen
async function fetchAllPages(cursor = undefined, allResults = []) {
    const body = {
        query: "",
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 100,
        ...(cursor && { start_cursor: cursor })
    };

    const response = await makeRequest('/v1/search', 'POST', body);
    
    if (response.results) {
        allResults.push(...response.results);
    }

    if (response.has_more && response.next_cursor && allResults.length < 2000) {
        console.log(`  Fetched ${allResults.length} pages, loading more...`);
        return fetchAllPages(response.next_cursor, allResults);
    }

    return allResults;
}

// Übungsname abrufen
async function fetchExerciseName(exerciseId) {
    const response = await makeRequest(`/v1/pages/${exerciseId}`, 'GET');
    return response.properties?.['Übung']?.title?.[0]?.plain_text ||
           response.properties?.['Name']?.title?.[0]?.plain_text ||
           'Unbekannt';
}

// Migration durchführen
async function migrate() {
    console.log('\n=== LIFT Migration ===\n');
    console.log('Lade Daten aus der alten Datenquelle...\n');

    // 1. Alle Seiten laden
    console.log('1. Lade alle Seiten...');
    const allPages = await fetchAllPages();
    console.log(`   ${allPages.length} Seiten geladen\n`);

    // 2. Nach Typ filtern
    const workoutPages = allPages.filter(p => p.parent?.data_source_id === DATA_SOURCES.WORKOUTS);
    const exercisePages = allPages.filter(p => p.parent?.data_source_id === DATA_SOURCES.EXERCISES);
    const setPages = allPages.filter(p => p.parent?.data_source_id === DATA_SOURCES.SETS);

    console.log(`2. Gefundene Daten:`);
    console.log(`   - ${workoutPages.length} Workouts`);
    console.log(`   - ${exercisePages.length} Übungen`);
    console.log(`   - ${setPages.length} Sätze\n`);

    // 3. Datenbank initialisieren
    console.log('3. Initialisiere SQLite Datenbank...');
    const db = require('./database');
    console.log('   Datenbank bereit\n');

    // 4. Übungen importieren
    console.log('4. Importiere Übungen...');
    const exerciseIdMap = new Map(); // alte ID -> neue ID
    
    for (const page of exercisePages) {
        const name = page.properties?.['Übung']?.title?.[0]?.plain_text || 'Unbekannt';
        if (name && name !== 'Unbekannt') {
            const result = db.createExercise(name);
            exerciseIdMap.set(page.id, result.id);
            console.log(`   + ${name}`);
        }
    }
    console.log(`   ${exerciseIdMap.size} Übungen importiert\n`);

    // 5. Workouts importieren
    console.log('5. Importiere Workouts...');
    const workoutIdMap = new Map(); // alte ID -> neue ID
    const workoutDateMap = new Map(); // alte ID -> Datum
    
    for (const page of workoutPages) {
        const date = page.properties?.['Datum']?.date?.start;
        if (date) {
            const dateStr = date.split('T')[0];
            const result = db.createWorkout(dateStr);
            workoutIdMap.set(page.id, result.id);
            workoutDateMap.set(page.id, dateStr);
            console.log(`   + ${dateStr}`);
        }
    }
    console.log(`   ${workoutIdMap.size} Workouts importiert\n`);

    // 6. Sätze importieren
    console.log('6. Importiere Sätze...');
    let setsImported = 0;
    let setsSkipped = 0;

    // Cache für Übungsnamen
    const exerciseNameCache = new Map();
    for (const page of exercisePages) {
        const name = page.properties?.['Übung']?.title?.[0]?.plain_text;
        if (name) {
            exerciseNameCache.set(page.id, name);
        }
    }

    for (const page of setPages) {
        try {
            const props = page.properties;
            
            // Übung finden
            const exerciseRelId = props['Übung']?.relation?.[0]?.id;
            let exerciseId = exerciseIdMap.get(exerciseRelId);
            
            // Falls Übung nicht im Map, versuche sie abzurufen und zu erstellen
            if (!exerciseId && exerciseRelId) {
                let exerciseName = exerciseNameCache.get(exerciseRelId);
                if (!exerciseName) {
                    exerciseName = await fetchExerciseName(exerciseRelId);
                    exerciseNameCache.set(exerciseRelId, exerciseName);
                }
                if (exerciseName && exerciseName !== 'Unbekannt') {
                    const result = db.createExercise(exerciseName);
                    exerciseId = result.id;
                    exerciseIdMap.set(exerciseRelId, exerciseId);
                    console.log(`   + Übung nachgeladen: ${exerciseName}`);
                }
            }

            // Workout finden
            const workoutRelId = props['Workout']?.relation?.[0]?.id;
            let workoutId = workoutIdMap.get(workoutRelId);
            
            // Falls kein Workout verknüpft, versuche über Datum
            if (!workoutId) {
                const date = props['Datum']?.date?.start;
                if (date) {
                    const dateStr = date.split('T')[0];
                    const result = db.createWorkout(dateStr);
                    workoutId = result.id;
                }
            }

            if (!exerciseId || !workoutId) {
                setsSkipped++;
                continue;
            }

            // Satz-Daten extrahieren
            const setNumber = props['Satz #']?.number || props['Satz']?.number || 1;
            const weight = props['Gewicht']?.number || 0;
            const reps = props['Wdh.']?.number || props['Wiederholungen']?.number || 0;
            const difficulty = props['Anstrengung']?.select?.name || 'Mittel';
            const createdAt = page.created_time;

            // Satz erstellen
            db.createSet(workoutId, exerciseId, setNumber, weight, reps, difficulty, createdAt);
            setsImported++;

            if (setsImported % 50 === 0) {
                console.log(`   ${setsImported} Sätze importiert...`);
            }
        } catch (err) {
            console.error(`   Fehler bei Satz: ${err.message}`);
            setsSkipped++;
        }
    }
    console.log(`   ${setsImported} Sätze importiert, ${setsSkipped} übersprungen\n`);

    // 7. Dauern berechnen
    console.log('7. Berechne Trainingsdauern und bereinige Ausreißer...');
    db.calculateAndCleanDurations();
    console.log('   Fertig\n');

    // 8. Statistiken anzeigen
    console.log('8. Import-Statistiken:');
    const statsObj = db.getStats(null, null); // start=null for all time, userId=null for all users (if applicable, though migration usually is single context or we should assume null context)
    const stats = statsObj.totals;
    
    console.log(`   - Workouts: ${stats.total_workouts}`);
    console.log(`   - Übungen: ${stats.active_exercises}`);
    console.log(`   - Sätze: ${stats.total_sets}`);
    console.log(`   - Gesamtvolumen: ${Math.round(stats.total_volume || 0)} kg`);
    
    console.log('\n=== Migration abgeschlossen! ===\n');
    console.log('Die Datenbank wurde erstellt unter: data/training.db');
    console.log('Du kannst nun den Server starten mit: node server.js\n');

    db.close();
}

// Migration starten
migrate().catch(err => {
    console.error('\nFehler bei der Migration:', err);
    process.exit(1);
});
