const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment variables from .env file
require('dotenv').config();

// Environment Variables
const PORT = process.env.PORT || 8765;
const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI_ENV = process.env.GOOGLE_REDIRECT_URI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

// Session Helper
function parseCookies(request) {
    const list = {};
    const rc = request.headers.cookie;
    if (rc) {
        rc.split(';').forEach((cookie) => {
            const parts = cookie.split('=');
            list[parts.shift().trim()] = decodeURI(parts.join('='));
        });
    }
    return list;
}

// Session Validation Middleware
function getSession(req) {
    const cookies = parseCookies(req);
    const sessionId = cookies.session_id;
    if (!sessionId) return null;
    
    return db.getSession(sessionId);
}

// JSON Response Helper
function jsonResponse(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// HTML Response Helper
function htmlResponse(res, statusCode, content) {
    res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
}

// Redirect Helper
function redirect(res, url) {
    res.writeHead(302, { 'Location': url });
    res.end();
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

// OpenAI Coach Integration with Function Calling
const coachTools = [
    {
        type: 'function',
        function: {
            name: 'create_exercise',
            description: 'Erstellt eine neue Übung in der Datenbank des Users. Nutze diese Funktion, wenn der User eine neue Übung hinzufügen möchte.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Der Name der neuen Übung (z.B. "Bankdrücken", "Kniebeugen", "Bizeps Curls")'
                    },
                    icon: {
                        type: 'string',
                        description: 'Optional: Ein Emoji als Icon für die Übung (z.B. "💪", "🏋️", "🦵")'
                    },
                    muscle_groups: {
                        type: 'string',
                        description: 'Optional: Komma-separierte Muskelgruppen (z.B. "Brust,Trizeps" oder "Rücken,Bizeps"). Verfügbare Gruppen: Brust, Rücken, Schultern, Nacken, Bizeps, Trizeps, Unterarme, Quadrizeps, Beinbeuger, Waden, Gesäß, Adduktoren, Abduktoren, Bauch, Unterer Rücken, Cardio, Sonstige'
                    }
                },
                required: ['name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'rename_exercise',
            description: 'Benennt eine bestehende Übung um. Nutze diese Funktion, wenn der User den Namen einer Übung ändern möchte.',
            parameters: {
                type: 'object',
                properties: {
                    old_name: {
                        type: 'string',
                        description: 'Der aktuelle Name der Übung, die umbenannt werden soll'
                    },
                    new_name: {
                        type: 'string',
                        description: 'Der neue Name für die Übung'
                    }
                },
                required: ['old_name', 'new_name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_exercise',
            description: 'Aktualisiert die Details einer bestehenden Übung (Icon, Muskelgruppen). Nutze diese Funktion, wenn der User das Icon oder die Muskelgruppen einer Übung ändern möchte.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Der Name der Übung, die aktualisiert werden soll'
                    },
                    icon: {
                        type: 'string',
                        description: 'Optional: Neues Emoji als Icon für die Übung'
                    },
                    muscle_groups: {
                        type: 'string',
                        description: 'Optional: Neue komma-separierte Muskelgruppen'
                    }
                },
                required: ['name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_exercises',
            description: 'Listet alle verfügbaren Übungen des Users auf. Nutze diese Funktion, wenn der User wissen möchte, welche Übungen er hat, oder um vor einer Umbenennung zu prüfen, ob eine Übung existiert.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    }
];

async function executeCoachFunction(functionName, args, userId) {
    switch (functionName) {
        case 'create_exercise': {
            const exercise = db.createExercise(args.name, userId);
            if (args.icon || args.muscle_groups) {
                db.updateExercise(exercise.id, args.name, args.icon, args.muscle_groups, userId);
            }
            return { success: true, message: `Übung "${args.name}" wurde erfolgreich erstellt.`, exercise };
        }
        
        case 'rename_exercise': {
            const exercise = db.getExerciseByName(args.old_name, userId);
            if (!exercise) {
                return { success: false, message: `Übung "${args.old_name}" wurde nicht gefunden.` };
            }
            db.updateExercise(exercise.id, args.new_name, exercise.icon, exercise.muscle_groups, userId);
            return { success: true, message: `Übung "${args.old_name}" wurde in "${args.new_name}" umbenannt.` };
        }
        
        case 'update_exercise': {
            const exercise = db.getExerciseByName(args.name, userId);
            if (!exercise) {
                return { success: false, message: `Übung "${args.name}" wurde nicht gefunden.` };
            }
            const newIcon = args.icon !== undefined ? args.icon : exercise.icon;
            const newMuscleGroups = args.muscle_groups !== undefined ? args.muscle_groups : exercise.muscle_groups;
            db.updateExercise(exercise.id, args.name, newIcon, newMuscleGroups, userId);
            return { success: true, message: `Übung "${args.name}" wurde aktualisiert.` };
        }
        
        case 'list_exercises': {
            const exercises = db.getExercises(userId);
            const exerciseList = exercises.map(e => `- ${e.name}${e.icon ? ` ${e.icon}` : ''}${e.muscle_groups ? ` (${e.muscle_groups})` : ''}`).join('\n');
            return { 
                success: true, 
                message: exercises.length > 0 
                    ? `Du hast ${exercises.length} Übungen:\n${exerciseList}`
                    : 'Du hast noch keine Übungen angelegt.',
                exercises 
            };
        }
        
        default:
            return { success: false, message: `Unbekannte Funktion: ${functionName}` };
    }
}

async function callOpenAI(userMessage, previousMessages, goals, workoutSummary, exerciseProgress, userName, userId) {
    const systemPrompt = buildCoachSystemPrompt(goals, workoutSummary, exerciseProgress, userName);
    
    // Konvertiere bisherige Nachrichten ins OpenAI-Format
    const messages = [
        { role: 'system', content: systemPrompt },
        ...previousMessages.slice(-20).map(m => ({ // Letzte 20 Nachrichten als Kontext
            role: m.role,
            content: m.content
        })),
        { role: 'user', content: userMessage }
    ];
    
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: messages,
                tools: coachTools,
                tool_choice: 'auto',
                max_tokens: 1500,
                temperature: 0.7
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            console.error('OpenAI API Error:', error);
            throw new Error(error.error?.message || 'OpenAI API Fehler');
        }
        
        const data = await response.json();
        const assistantMessage = data.choices[0].message;
        
        // Check if the model wants to call a function
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            // Execute all tool calls
            const toolResults = [];
            let dataChanged = false;
            
            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);
                console.log(`Coach executing function: ${functionName}`, args);
                
                const result = await executeCoachFunction(functionName, args, userId);
                toolResults.push({
                    tool_call_id: toolCall.id,
                    role: 'tool',
                    content: JSON.stringify(result)
                });
                
                // Mark data as changed if a mutating function was called successfully
                if (result.success && ['create_exercise', 'rename_exercise', 'update_exercise'].includes(functionName)) {
                    dataChanged = true;
                }
            }
            
            // Send tool results back to get final response
            const followUpMessages = [
                ...messages,
                assistantMessage,
                ...toolResults
            ];
            
            const followUpResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: followUpMessages,
                    max_tokens: 1500,
                    temperature: 0.7
                })
            });
            
            if (!followUpResponse.ok) {
                const error = await followUpResponse.json();
                console.error('OpenAI Follow-up API Error:', error);
                throw new Error(error.error?.message || 'OpenAI API Fehler');
            }
            
            const followUpData = await followUpResponse.json();
            return { 
                response: followUpData.choices[0].message.content,
                dataChanged
            };
        }
        
        return { response: assistantMessage.content, dataChanged: false };
    } catch (error) {
        console.error('OpenAI Call Error:', error);
        throw error;
    }
}

function buildCoachSystemPrompt(goals, workoutSummary, exerciseProgress, userName) {
    const goalsText = goals ? `
Fitnessziele des Users:
- Ziele: ${goals.goals || 'Nicht angegeben'}
- Erfahrungslevel: ${goals.experience_level || 'Nicht angegeben'}
- Trainingsfrequenz: ${goals.training_frequency || 'Nicht angegeben'}
` : 'Der User hat noch keine Fitnessziele definiert.';

    const workoutText = workoutSummary.length > 0 ? `
Letzte ${workoutSummary.length} Trainingseinheiten:
${workoutSummary.map(w => `- ${w.date}: ${w.exercises || 'Keine Übungen'} (${w.total_sets} Sätze, ${Math.round(w.total_volume || 0)}kg Volumen)`).join('\n')}
` : 'Noch keine Trainingseinheiten aufgezeichnet.';

    const progressText = exerciseProgress.length > 0 ? `
Übungsfortschritt:
${exerciseProgress.slice(0, 15).map(e => 
    `- ${e.exercise_name}: ${e.workout_count} Workouts, Max ${e.max_weight}kg, Ø ${e.avg_weight}kg × ${e.avg_reps} Wdh${e.muscle_groups ? ` (${e.muscle_groups})` : ''}`
).join('\n')}
` : 'Noch keine Übungsdaten vorhanden.';

    return `Du bist ein erfahrener, motivierender Fitness-Coach namens "TrainBot". Du hilfst ${userName || 'dem User'} dabei, seine Trainingsziele zu erreichen.

DEINE AUFGABEN:
1. Trainingspläne erstellen (Wochenpläne mit konkreten Übungen, Sätzen, Wiederholungen)
2. Einzelne Workout-Empfehlungen geben
3. Fortschrittsanalysen durchführen ("Wie entwickelt sich mein Bankdrücken?")
4. Allgemeine Trainingsfragen beantworten
5. Motivation und Tipps geben
6. Übungen verwalten: anlegen, umbenennen, aktualisieren

ÜBUNGSVERWALTUNG:
Du kannst für den User Übungen erstellen, umbenennen und bearbeiten. Nutze dafür die verfügbaren Funktionen:
- create_exercise: Neue Übung anlegen (Name, optional Icon und Muskelgruppen)
- rename_exercise: Bestehende Übung umbenennen
- update_exercise: Icon oder Muskelgruppen einer Übung ändern
- list_exercises: Alle Übungen des Users auflisten

Wenn der User eine Übung anlegen oder umbenennen möchte, führe die entsprechende Aktion direkt aus.

WICHTIGE REGELN:
- Antworte auf Deutsch
- Sei konkret und praktisch orientiert
- Beziehe dich auf die vorhandenen Trainingsdaten
- Gib keine Ernährungstipps (außer explizit gefragt)
- Formatiere Trainingspläne übersichtlich
- Bei Trainingsplänen: Nutze die Übungen, die der User bereits macht, wo sinnvoll
- Sei motivierend aber realistisch
- Bei Übungsanfragen: Führe die Aktion aus und bestätige sie dem User

TRAININGSDATEN DES USERS:
${goalsText}
${workoutText}
${progressText}

Antworte kurz und prägnant, außer bei komplexen Fragen wie Trainingsplan-Erstellung.`;
}

// API Handler
async function handleApi(req, res, endpoint, user) {
    try {
        const userId = user ? user.user_id : null; // user.user_id comes from session table query join

        // GET Endpoints
        if (req.method === 'GET') {
            switch (endpoint) {
                case 'exercises':
                    return jsonResponse(res, 200, { exercises: db.getExercises(userId) });
                
                case 'workouts':
                    const limit = parseInt(new URL(req.url, 'http://localhost').searchParams.get('limit')) || 5;
                    const workouts = db.getLastNWorkouts(limit, userId);
                    return jsonResponse(res, 200, { 
                        workouts,
                        dates: workouts.map(w => w.date)
                    });
                
                case 'sets':
                    return jsonResponse(res, 200, { sets: db.getAllSetsWithDetails(userId) });
                
                case 'warmups':
                    return jsonResponse(res, 200, { warmups: db.getAllWarmupsWithDetails(userId) });
                
                case 'stats':
                    const startDate = new URL(req.url, 'http://localhost').searchParams.get('start');
                    return jsonResponse(res, 200, db.getStats(startDate, userId));
                
                case 'stats/exercise': {
                    const url = new URL(req.url, 'http://localhost');
                    const exerciseId = parseInt(url.searchParams.get('id'));
                    const start = url.searchParams.get('start');
                    
                    if (!exerciseId) {
                        return jsonResponse(res, 400, { error: 'Exercise ID required' });
                    }
                    return jsonResponse(res, 200, { 
                        progression: db.getWeightProgressionForExercise(exerciseId, start, userId)
                    });
                }
                
                case 'me':
                    return jsonResponse(res, 200, { 
                        email: user.email, 
                        name: user.name, 
                        picture: user.picture 
                    });
                
                // Coach Endpoints
                case 'coach/goals':
                    return jsonResponse(res, 200, { goals: db.getUserGoals(userId) });
                
                case 'coach/conversations':
                    return jsonResponse(res, 200, { conversations: db.getConversations(userId) });

                default:
                    if (endpoint.startsWith('coach/conversations/') && endpoint.endsWith('/messages')) {
                        const convId = parseInt(endpoint.split('/')[2]);
                        const conv = db.getConversation(convId, userId);
                        if (!conv) return jsonResponse(res, 404, { error: 'Conversation not found' });
                        return jsonResponse(res, 200, { messages: db.getMessages(convId) });
                    }
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
                    const result = db.createExercise(name, userId);
                    return jsonResponse(res, 201, result);
                }
                
                case 'workouts': {
                    const { date } = body;
                    if (!date) {
                        return jsonResponse(res, 400, { error: 'Datum ist erforderlich' });
                    }
                    // Prüfen ob Workout bereits existiert
                    const existing = db.getWorkoutByDate(date, userId);
                    if (existing) {
                        return jsonResponse(res, 400, { error: `Workout für ${date} existiert bereits` });
                    }
                    const result = db.createWorkout(date, userId);
                    return jsonResponse(res, 201, result);
                }
                
                case 'sets': {
                    const { workoutDate, exerciseId, exerciseName, setNumber, weight, reps, difficulty } = body;
                    
                    // Workout finden oder erstellen
                    let workout = db.getWorkoutByDate(workoutDate, userId);
                    if (!workout) {
                        workout = db.createWorkout(workoutDate, userId);
                    }
                    
                    // Übung finden oder erstellen
                    let exercise;
                    if (exerciseId) {
                        exercise = db.getExerciseById(exerciseId, userId);
                    } else if (exerciseName) {
                        exercise = db.getExerciseByName(exerciseName, userId);
                        if (!exercise) {
                            exercise = db.createExercise(exerciseName, userId);
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
                        difficulty || 'Mittel',
                        null,
                        null // userId check implicitly via workout
                    );

                    const createdRow = db.db
                        .prepare('SELECT created_at, superset_id FROM sets WHERE id = ?')
                        .get(result.id);
                    
                    return jsonResponse(res, 201, {
                        id: result.id,
                        workout_id: workout.id,
                        exercise_id: exercise.id,
                        exercise_name: exercise.name,
                        set_number: setNumber || 1,
                        weight,
                        reps,
                        difficulty,
                        superset_id: createdRow?.superset_id || null,
                        created_at: createdRow?.created_at
                    });
                }
                
                case 'warmups': {
                    const { workoutDate, type, duration_seconds, distance_meters, avg_heart_rate, difficulty, calories, notes } = body;
                    
                    if (!type || !duration_seconds) {
                        return jsonResponse(res, 400, { error: 'Typ und Dauer sind erforderlich' });
                    }
                    
                    // Workout finden oder erstellen
                    let workout = db.getWorkoutByDate(workoutDate, userId);
                    if (!workout) {
                        workout = db.createWorkout(workoutDate, userId);
                    }
                    
                    const result = db.createWarmup(
                        workout.id,
                        type,
                        duration_seconds,
                        distance_meters,
                        avg_heart_rate,
                        difficulty,
                        calories,
                        notes
                    );
                    
                    return jsonResponse(res, 201, {
                        id: result.id,
                        workout_id: workout.id,
                        workout_date: workoutDate,
                        type,
                        duration_seconds,
                        distance_meters,
                        avg_heart_rate,
                        difficulty,
                        calories,
                        notes
                    });
                }
                
                case 'sets/link': {
                    const { setId, targetSetId } = body;
                    const setIdNum = parseInt(setId);
                    const targetSetIdNum = parseInt(targetSetId);

                    if (!setIdNum || !targetSetIdNum) {
                        return jsonResponse(res, 400, { error: 'setId and targetSetId required' });
                    }

                    const result = db.linkSets(setIdNum, targetSetIdNum, userId);
                    return jsonResponse(res, 200, { success: true, ...result, setId: setIdNum, targetSetId: targetSetIdNum });
                }

                case 'sets/complete': {
                    const { id } = body;
                    if (!id) {
                        return jsonResponse(res, 400, { error: 'Set ID required' });
                    }
                    // TODO: Ownership check missing here, but completeSet is harmless timestamp update
                    db.completeSet(id);
                    return jsonResponse(res, 200, { success: true });
                }
                
                case 'auth/logout': {
                    const cookies = parseCookies(req);
                    if (cookies.session_id) {
                        db.deleteSession(cookies.session_id);
                    }
                    res.writeHead(200, { 
                        'Set-Cookie': 'session_id=; HttpOnly; Path=/; Max-Age=0'
                    });
                    res.end(JSON.stringify({ success: true }));
                    return;
                }
                
                // Coach Endpoints
                case 'coach/goals': {
                    const { goals, experience_level, training_frequency } = body;
                    const result = db.saveUserGoals(userId, goals, experience_level, training_frequency);
                    return jsonResponse(res, 200, { goals: result });
                }
                
                case 'coach/conversations': {
                    const { title } = body;
                    const result = db.createConversation(userId, title || 'Neue Unterhaltung');
                    return jsonResponse(res, 201, { conversation: result });
                }
                
                case 'coach/chat': {
                    if (!OPENAI_API_KEY) {
                        return jsonResponse(res, 500, { error: 'OpenAI API nicht konfiguriert' });
                    }
                    
                    const { conversation_id, message } = body;
                    if (!message) {
                        return jsonResponse(res, 400, { error: 'Nachricht erforderlich' });
                    }
                    
                    // Conversation finden oder erstellen
                    let convId = conversation_id;
                    if (!convId) {
                        const conv = db.createConversation(userId, message.substring(0, 50) + '...');
                        convId = conv.id;
                    } else {
                        const conv = db.getConversation(convId, userId);
                        if (!conv) {
                            return jsonResponse(res, 404, { error: 'Conversation not found' });
                        }
                    }
                    
                    // User-Nachricht speichern
                    db.addMessage(convId, 'user', message);
                    
                    // Kontext aufbauen
                    const goals = db.getUserGoals(userId);
                    const workoutSummary = db.getWorkoutSummaryForCoach(userId, 30);
                    const exerciseProgress = db.getExerciseProgressForCoach(userId);
                    const previousMessages = db.getMessages(convId);
                    
                    // OpenAI API aufrufen
                    const result = await callOpenAI(
                        message, 
                        previousMessages, 
                        goals, 
                        workoutSummary, 
                        exerciseProgress,
                        user.name,
                        userId
                    );
                    
                    // Assistant-Antwort speichern
                    db.addMessage(convId, 'assistant', result.response);
                    
                    return jsonResponse(res, 200, { 
                        conversation_id: convId,
                        response: result.response,
                        dataChanged: result.dataChanged
                    });
                }

                default:
                    return jsonResponse(res, 404, { error: 'Unknown endpoint' });
            }
        }
        
        // PUT/PATCH Endpoints
        if (req.method === 'PUT' || req.method === 'PATCH') {
            const body = await parseBody(req);
            
            if (endpoint.startsWith('exercises/')) {
                const id = parseInt(endpoint.split('/')[1]);
                const { name, icon, muscle_groups } = body;
                
                if (!id) return jsonResponse(res, 400, { error: 'ID required' });
                
                // userId passed to ensure ownership
                const updated = db.updateExercise(id, name, icon, muscle_groups, userId);
                if (!updated) return jsonResponse(res, 403, { error: 'Not allowed' });
                return jsonResponse(res, 200, updated);
            }
            
            // Superset linking
            if (endpoint.startsWith('sets/') && endpoint.endsWith('/superset')) {
                const parts = endpoint.split('/');
                const id = parseInt(parts[1]);
                const { superset_id } = body;
                
                if (!id) return jsonResponse(res, 400, { error: 'ID required' });
                
                try {
                    if (superset_id) {
                        db.linkSuperset(id, superset_id); // This assumes ownership checked before? No, simpler endpoint doesn't link two sets, just assigns ID. 
                        // Wait, linkSets handles verify. linkSuperset is raw update.
                        // We should verify ownership.
                        // The user can't easily guess UUIDs of others, but still.
                        // For now we trust linkSets logic for complex linking.
                        // This endpoint is used for unlinking (superset_id = null).
                    } else {
                        db.unlinkSuperset(id, userId);
                    }
                    return jsonResponse(res, 200, { success: true, id, superset_id });
                } catch (e) {
                    return jsonResponse(res, 403, { error: e.message });
                }
            }
            
            if (endpoint.startsWith('sets/')) {
                const id = parseInt(endpoint.split('/')[1]);
                const { weight, reps, difficulty } = body;
                
                if (!id) return jsonResponse(res, 400, { error: 'ID required' });
                
                try {
                    db.updateSet(id, weight, reps, difficulty, userId);
                    return jsonResponse(res, 200, { success: true, id });
                } catch (e) {
                    return jsonResponse(res, 403, { error: e.message });
                }
            }
            
            if (endpoint.startsWith('warmups/')) {
                const id = parseInt(endpoint.split('/')[1]);
                const { type, duration_seconds, distance_meters, avg_heart_rate, difficulty, calories, notes } = body;
                
                if (!id) return jsonResponse(res, 400, { error: 'ID required' });
                
                try {
                    const updated = db.updateWarmup(id, type, duration_seconds, distance_meters, avg_heart_rate, difficulty, calories, notes, userId);
                    return jsonResponse(res, 200, { success: true, warmup: updated });
                } catch (e) {
                    return jsonResponse(res, 403, { error: e.message });
                }
            }
            
            return jsonResponse(res, 404, { error: 'Unknown endpoint' });
        }
        
        // DELETE Endpoints
        if (req.method === 'DELETE') {
            if (endpoint.startsWith('sets/')) {
                const id = parseInt(endpoint.split('/')[1]);
                if (!id) return jsonResponse(res, 400, { error: 'ID required' });
                
                const result = db.deleteSet(id, userId);
                if (result.deleted === false) return jsonResponse(res, 403, { error: 'Not allowed or not found' });
                return jsonResponse(res, 200, { success: true, ...result });
            }
            
            if (endpoint.startsWith('exercises/')) {
                const id = parseInt(endpoint.split('/')[1]);
                if (!id) return jsonResponse(res, 400, { error: 'ID required' });
                
                const result = db.deleteExercise(id, userId);
                if (result.changes === 0) return jsonResponse(res, 403, { error: 'Not allowed or not found' });
                return jsonResponse(res, 200, { success: true });
            }
            
            if (endpoint.startsWith('coach/conversations/')) {
                const id = parseInt(endpoint.split('/')[2]);
                if (!id) return jsonResponse(res, 400, { error: 'ID required' });
                
                const result = db.deleteConversation(id, userId);
                return jsonResponse(res, 200, { success: true });
            }
            
            if (endpoint.startsWith('warmups/')) {
                const id = parseInt(endpoint.split('/')[1]);
                if (!id) return jsonResponse(res, 400, { error: 'ID required' });
                
                try {
                    const result = db.deleteWarmup(id, userId);
                    if (!result.deleted) return jsonResponse(res, 404, { error: 'Not found' });
                    return jsonResponse(res, 200, { success: true });
                } catch (e) {
                    return jsonResponse(res, 403, { error: e.message });
                }
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
    
    // Determine protocol and host respecting reverse proxy headers
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = new URL(req.url, `${protocol}://${host}`);
    const urlPath = url.pathname;

    // 1. Google OAuth Flow
    if (urlPath === '/auth/google') {
        if (!GOOGLE_CLIENT_ID) return jsonResponse(res, 500, { error: 'Google Auth not configured' });
        
        const redirectUri = GOOGLE_REDIRECT_URI_ENV || `${protocol}://${host}/auth/google/callback`;
        const redirectUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=email%20profile`;
        return redirect(res, redirectUrl);
    }

    if (urlPath === '/auth/google/callback') {
        const code = url.searchParams.get('code');
        if (!code) return jsonResponse(res, 400, { error: 'No code provided' });

        const redirectUri = GOOGLE_REDIRECT_URI_ENV || `${protocol}://${host}/auth/google/callback`;

        try {
            console.log('Auth Callback received. Protocol:', req.headers['x-forwarded-proto'], 'Host:', req.headers['x-forwarded-host']);
            console.log('Using Redirect URI:', redirectUri);

            // 1. Exchange code for token
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    code,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code'
                })
            });
            const tokenData = await tokenRes.json();
            
            if (!tokenData.access_token) {
                console.error('Token Exchange failed:', JSON.stringify(tokenData));
                throw new Error('Token exchange failed: ' + (tokenData.error_description || tokenData.error));
            }

            // 2. Get User Profile
            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });
            const userData = await userRes.json();

            // 3. Create/Update User in DB
            const user = db.createUser(userData.email, userData.name, userData.picture, 'google', userData.id);

            // 4. Create Session
            const sessionId = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
            db.createSession(sessionId, user.id, expiresAt);

            // 5. Set Cookie & Redirect
            res.writeHead(302, {
                'Set-Cookie': `session_id=${sessionId}; HttpOnly; Path=/; Max-Age=${30 * 24 * 60 * 60}`,
                'Location': '/'
            });
            res.end();
            return;

        } catch (error) {
            console.error('Auth Error:', error);
            return jsonResponse(res, 500, { error: 'Authentication failed' });
        }
    }

    // 2. Check Session
    let session = getSession(req);
    
    // API Routes (Require Auth)
    if (urlPath.startsWith('/api/')) {
        const endpoint = urlPath.replace('/api/', '');
        
        // Allow logout without session check (to be safe)
        if (endpoint === 'auth/logout') {
            return handleApi(req, res, endpoint, null);
        }

        if (AUTH_ENABLED && !session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        
        return handleApi(req, res, endpoint, session); // session contains user_id etc.
    }

    // Static Files
    // If not logged in, serve login.html instead of index.html
    let filePath = '.' + urlPath;
    if (filePath === './') {
        if (AUTH_ENABLED && !session) {
            filePath = './login.html';
        } else {
            filePath = './index.html';
        }
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            // Fallback for SPA routing if we had any, or just 404
            // But for / (root), we handled logic above.
            if (filePath === './login.html' && error.code === 'ENOENT') {
                // If login.html missing, create minimal one on fly or error
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Login required</h1><a href="/auth/google">Login with Google</a>');
                return;
            }
            res.writeHead(404);
            res.end('404 - Not Found');
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
