const http = require('http');
const fs = require('fs');
const path = require('path');

// Environment Variables
const PORT = process.env.PORT || 8765;
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'changeme';
const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';

// Datenbank laden
const db = require('./database');

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

// Basic Auth Helper
function checkAuth(req) {
    if (!AUTH_ENABLED) return true;
    
    const authHeader = req.headers.authorization;
    if (!authHeader) return false;
    
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');
    
    return username === AUTH_USERNAME && password === AUTH_PASSWORD;
}

// JSON Response Helper
function jsonResponse(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// Request Body Parser
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

// API Handler
async function handleApi(req, res, endpoint) {
    try {
        // GET Endpoints
        if (req.method === 'GET') {
            switch (endpoint) {
                case 'exercises':
                    return jsonResponse(res, 200, { exercises: db.getExercises() });
                
                case 'workouts':
                    const limit = parseInt(new URL(req.url, 'http://localhost').searchParams.get('limit')) || 5;
                    const workouts = db.getLastNWorkouts(limit);
                    return jsonResponse(res, 200, { 
                        workouts,
                        dates: workouts.map(w => w.date)
                    });
                
                case 'sets':
                    return jsonResponse(res, 200, { sets: db.getAllSetsWithDetails() });
                
                case 'stats':
                    return jsonResponse(res, 200, { 
                        overall: db.getOverallStats(),
                        exercises: db.getExerciseStats()
                    });
                
                case 'stats/exercise': {
                    const exerciseId = parseInt(new URL(req.url, 'http://localhost').searchParams.get('id'));
                    if (!exerciseId) {
                        return jsonResponse(res, 400, { error: 'Exercise ID required' });
                    }
                    return jsonResponse(res, 200, { 
                        progression: db.getWeightProgressionForExercise(exerciseId)
                    });
                }
                
                default:
                    return jsonResponse(res, 404, { error: 'Unknown endpoint' });
            }
        }
        
        // POST Endpoints
        if (req.method === 'POST') {
            const body = await parseBody(req);
            
            switch (endpoint) {
                case 'exercises': {
                    const { name } = body;
                    if (!name) {
                        return jsonResponse(res, 400, { error: 'Name ist erforderlich' });
                    }
                    const result = db.createExercise(name);
                    return jsonResponse(res, 201, result);
                }
                
                case 'workouts': {
                    const { date } = body;
                    if (!date) {
                        return jsonResponse(res, 400, { error: 'Datum ist erforderlich' });
                    }
                    // Prüfen ob Workout bereits existiert
                    const existing = db.getWorkoutByDate(date);
                    if (existing) {
                        return jsonResponse(res, 400, { error: `Workout für ${date} existiert bereits` });
                    }
                    const result = db.createWorkout(date);
                    return jsonResponse(res, 201, result);
                }
                
                case 'sets': {
                    const { workoutDate, exerciseId, exerciseName, setNumber, weight, reps, difficulty } = body;
                    
                    // Workout finden oder erstellen
                    let workout = db.getWorkoutByDate(workoutDate);
                    if (!workout) {
                        workout = db.createWorkout(workoutDate);
                    }
                    
                    // Übung finden oder erstellen
                    let exercise;
                    if (exerciseId) {
                        exercise = db.getExerciseById(exerciseId);
                    } else if (exerciseName) {
                        exercise = db.getExerciseByName(exerciseName);
                        if (!exercise) {
                            exercise = db.createExercise(exerciseName);
                        }
                    }
                    
                    if (!exercise) {
                        return jsonResponse(res, 400, { error: 'Übung nicht gefunden' });
                    }
                    
                    const result = db.createSet(
                        workout.id,
                        exercise.id,
                        setNumber || 1,
                        weight || 0,
                        reps || 0,
                        difficulty || 'Mittel'
                    );

                    const createdAt = db.db
                        .prepare('SELECT created_at FROM sets WHERE id = ?')
                        .get(result.id)?.created_at;
                    
                    return jsonResponse(res, 201, {
                        id: result.id,
                        workout_id: workout.id,
                        exercise_id: exercise.id,
                        exercise_name: exercise.name,
                        set_number: setNumber || 1,
                        weight,
                        reps,
                        difficulty,
                        created_at: createdAt
                    });
                }
                
                case 'sets/complete': {
                    const { id } = body;
                    if (!id) {
                        return jsonResponse(res, 400, { error: 'Set ID required' });
                    }
                    db.completeSet(id);
                    return jsonResponse(res, 200, { success: true });
                }
                
                default:
                    return jsonResponse(res, 404, { error: 'Unknown endpoint' });
            }
        }
        
        // PUT/PATCH Endpoints
        if (req.method === 'PUT' || req.method === 'PATCH') {
            const body = await parseBody(req);
            
            if (endpoint.startsWith('sets/')) {
                const id = parseInt(endpoint.split('/')[1]);
                const { weight, reps, difficulty } = body;
                
                if (!id) {
                    return jsonResponse(res, 400, { error: 'Set ID required' });
                }
                
                db.updateSet(id, weight, reps, difficulty);
                return jsonResponse(res, 200, { success: true, id });
            }
            
            return jsonResponse(res, 404, { error: 'Unknown endpoint' });
        }
        
        // DELETE Endpoints
        if (req.method === 'DELETE') {
            if (endpoint.startsWith('sets/')) {
                const id = parseInt(endpoint.split('/')[1]);
                if (!id) {
                    return jsonResponse(res, 400, { error: 'Set ID required' });
                }
                const result = db.deleteSet(id);
                return jsonResponse(res, 200, { success: true, ...result });
            }
            
            if (endpoint.startsWith('exercises/')) {
                const id = parseInt(endpoint.split('/')[1]);
                if (!id) {
                    return jsonResponse(res, 400, { error: 'Exercise ID required' });
                }
                db.deleteExercise(id);
                return jsonResponse(res, 200, { success: true });
            }
            
            return jsonResponse(res, 404, { error: 'Unknown endpoint' });
        }
        
        return jsonResponse(res, 405, { error: 'Method not allowed' });
        
    } catch (error) {
        console.error('API Error:', error);
        return jsonResponse(res, 500, { error: error.message });
    }
}

// Server erstellen
const server = http.createServer(async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // Parse URL
    const urlPath = req.url.split('?')[0];
    
    // API Routen (Auth erforderlich)
    if (urlPath.startsWith('/api/')) {
        if (AUTH_ENABLED && !checkAuth(req)) {
            res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Training Tracker"' });
            res.end('Authentifizierung erforderlich');
            return;
        }
        
        const endpoint = urlPath.replace('/api/', '');
        return handleApi(req, res, endpoint);
    }

    // Static Files
    let filePath = '.' + urlPath;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('404 - File Not Found');
            } else {
                res.writeHead(500);
                res.end('500 - Internal Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║   Training Tracker Server                ║
╠══════════════════════════════════════════╣
║                                          ║
║   URL: http://localhost:${PORT}           ║
║   Database: SQLite (data/training.db)    ║
║                                          ║
║   Drücke Ctrl+C zum Beenden             ║
║                                          ║
╚══════════════════════════════════════════╝
    `);
});

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('\nServer wird beendet...');
    db.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nServer wird beendet...');
    db.close();
    process.exit(0);
});
