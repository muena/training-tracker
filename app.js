/**
 * LIFT - Application Logic
 */

// ============================================
// State
// ============================================
const state = {
    currentDate: getTodayDate(),
    exercises: [],           // Alle Übungen aus DB
    sets: [],               // Alle Sätze
    warmups: [],            // Alle Warmups
    workouts: [],           // Letzte Workouts
    currentExercise: null,  // Aktuell ausgewählte Übung für Modal
    loading: true,
    statsPeriod: '1m',      // Standard: 1 Monat
    statsData: null,        // Statistik-Daten vom Server
    user: null,             // User data
    // Coach State
    coach: {
        goals: null,
        conversations: [],
        currentConversationId: null,
        messages: [],
        isLoading: false
    },
    // Settings & Timer State
    settings: {
        restTimerEnabled: true,
        defaultRestTime: 90
    },
    timer: {
        remaining: 0,
        interval: null,
        isActive: false
    }
};

// Vordefinierte Warmup-Typen
const WARMUP_TYPES = [
    { id: 'rudergeraet', name: 'Rudergerät', icon: '🚣' },
    { id: 'ergometer', name: 'Ergometer', icon: '🚴' },
    { id: 'laufband', name: 'Laufband', icon: '🏃' },
    { id: 'crosstrainer', name: 'Crosstrainer', icon: '🏃‍♂️' },
    { id: 'seilspringen', name: 'Seilspringen', icon: '🪢' },
    { id: 'dehnen', name: 'Dehnen', icon: '🧘' },
    { id: 'sonstiges', name: 'Sonstiges', icon: '⚡' }
];

// ============================================
// DOM Elements
// ============================================
const elements = {
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    currentDate: document.getElementById('currentDate'),
    exerciseList: document.getElementById('exerciseList'),
    allExercisesList: document.getElementById('allExercisesList'),
    exerciseSearch: document.getElementById('exerciseSearch'),
    overallStats: document.getElementById('overallStats'),
    exerciseStatsContainer: document.getElementById('exerciseStatsContainer'),
    chartContainer: document.getElementById('chartContainer'),
    exerciseModal: document.getElementById('exerciseModal'),
    modalContainer: document.getElementById('modalContainer')
};

// ============================================
// Utility Functions
// ============================================
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (dateString === getTodayDate()) return 'Heute';
    if (dateString === yesterday.toISOString().split('T')[0]) return 'Gestern';
    
    return date.toLocaleDateString('de-DE', { 
        weekday: 'short', 
        day: '2-digit', 
        month: '2-digit' 
    });
}

function formatDateFull(dateString) {
    return new Date(dateString).toLocaleDateString('de-DE', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    });
}

function formatDateFullCompact(dateString) {
    // Compact for tight UI (e.g. swipe cards)
    return new Date(dateString).toLocaleDateString('de-DE', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

function getDifficultyEmoji(difficulty) {
    const map = {
        'Leicht': '🟢',
        'Mittel': '🟡',
        'Schwer': '🟠',
        'Sehr schwer': '🔴'
    };
    return map[difficulty] || '🟡';
}

// ============================================
// Rest Timer Logic
// ============================================
function startRestTimer(seconds) {
    if (!state.settings.restTimerEnabled) return;
    
    // Bestehenden Timer stoppen
    if (state.timer.interval) {
        clearInterval(state.timer.interval);
    }
    
    state.timer.remaining = seconds || state.settings.defaultRestTime;
    state.timer.isActive = true;
    
    const overlay = document.getElementById('restTimerOverlay');
    const display = document.getElementById('timerDisplay');
    
    overlay.classList.remove('finished');
    overlay.style.display = 'block';
    updateTimerDisplay();
    
    state.timer.interval = setInterval(() => {
        state.timer.remaining--;
        updateTimerDisplay();
        
        if (state.timer.remaining <= 0) {
            finishRestTimer();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const display = document.getElementById('timerDisplay');
    if (!display) return;
    
    const mins = Math.floor(Math.abs(state.timer.remaining) / 60);
    const secs = Math.abs(state.timer.remaining) % 60;
    const sign = state.timer.remaining < 0 ? '-' : '';
    display.textContent = `${sign}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function adjustTimer(seconds) {
    state.timer.remaining += seconds;
    if (state.timer.remaining < 0) state.timer.remaining = 0;
    updateTimerDisplay();
}

function finishRestTimer() {
    const overlay = document.getElementById('restTimerOverlay');
    overlay.classList.add('finished');
    
    // Vibration (falls unterstützt)
    if ("vibrate" in navigator) {
        navigator.vibrate([200, 100, 200]);
    }
    
    // Nach 5 Sekunden im Minus stoppen wir den Timer nicht, lassen ihn aber weiterlaufen
    // damit der User sieht wie viel er überzogen hat.
}

function stopRestTimer() {
    if (state.timer.interval) {
        clearInterval(state.timer.interval);
        state.timer.interval = null;
    }
    state.timer.isActive = false;
    document.getElementById('restTimerOverlay').style.display = 'none';
}

// ============================================
// User & Auth
// ============================================
function renderUserHeader(user) {
    const header = document.querySelector('.header');
    if (!header || document.getElementById('userProfile')) return;
    
    const profile = document.createElement('div');
    profile.id = 'userProfile';
    profile.className = 'user-profile';
    profile.innerHTML = `
        <img src="${user.picture}" alt="${user.name}" class="user-avatar" title="${user.name}">
        <button class="logout-btn" onclick="logout()" title="Abmelden">🚪</button>
    `;
    
    header.appendChild(profile);
}

async function logout() {
    try {
        await api('auth/logout', { method: 'POST' });
        window.location.reload();
    } catch (e) {
        console.error('Logout failed', e);
        window.location.reload();
    }
}

// ============================================
// Data Export
// ============================================
function exportDataToCSV() {
    if (!state.sets || state.sets.length === 0) {
        showToast('Keine Daten zum Exportieren vorhanden', 'error');
        return;
    }

    const headers = ['Datum', 'Übung', 'Satz', 'Gewicht', 'Wiederholungen', 'Schwierigkeit', 'Zeit'];
    const rows = state.sets.map(s => [
        s.workout_date,
        s.exercise_name,
        s.set_number,
        s.weight,
        s.reps,
        s.difficulty,
        s.duration_cleaned || s.duration_seconds || ''
    ]);

    const csvContent = [
        headers.join(','),
        ...rows.map(r => r.map(val => `"${val}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `training_data_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('Export gestartet');
}
async function loadSettings() {
    try {
        const settings = await api('settings');
        if (settings && Object.keys(settings).length > 0) {
            state.settings = { ...state.settings, ...settings };
        }
        updateSettingsUI();
    } catch (e) {
        console.error('Failed to load settings from server', e);
    }
}

async function saveSettings() {
    try {
        await api('settings', {
            method: 'POST',
            body: JSON.stringify(state.settings)
        });
    } catch (e) {
        console.error('Failed to save settings to server', e);
        showToast('Fehler beim Speichern der Einstellungen', 'error');
    }
}

function updateSettingsUI() {
    const enabledInput = document.getElementById('settingRestTimerEnabled');
    const timeInput = document.getElementById('settingDefaultRestTime');
    
    if (enabledInput) enabledInput.checked = state.settings.restTimerEnabled;
    if (timeInput) timeInput.value = state.settings.defaultRestTime;
}

function initSettingsListeners() {
    const enabledInput = document.getElementById('settingRestTimerEnabled');
    const timeInput = document.getElementById('settingDefaultRestTime');
    
    if (enabledInput) {
        enabledInput.addEventListener('change', (e) => {
            state.settings.restTimerEnabled = e.target.checked;
            saveSettings();
        });
    }
    
    if (timeInput) {
        timeInput.addEventListener('change', (e) => {
            state.settings.defaultRestTime = parseInt(e.target.value) || 90;
            saveSettings();
        });
    }
}

// Automatische Icon-Erkennung basierend auf dem Namen
function getExerciseIconAuto(exerciseName) {
    const name = exerciseName.toLowerCase();
    
    // Brust
    if (name.includes('bankdrück') || name.includes('bench') || name.includes('brust')) return '🏋️';
    if (name.includes('flieg') || name.includes('fly') || name.includes('butterfly')) return '🦋';
    if (name.includes('dip')) return '⬇️';
    
    // Rücken
    if (name.includes('latzug') || name.includes('lat') || name.includes('pulldown')) return '🔽';
    if (name.includes('ruder') || name.includes('row')) return '🚣';
    if (name.includes('klimmzug') || name.includes('pullup') || name.includes('pull-up')) return '⬆️';
    if (name.includes('kreuzheben') || name.includes('deadlift')) return '🏗️';
    if (name.includes('hyperextension') || name.includes('rückenstreck')) return '🔙';
    
    // Schultern
    if (name.includes('schulter') || name.includes('shoulder') || name.includes('press')) return '🎯';
    if (name.includes('seitheben') || name.includes('lateral')) return '↔️';
    if (name.includes('frontheben')) return '⬆️';
    if (name.includes('face pull') || name.includes('facepull')) return '🎭';
    
    // Arme
    if (name.includes('bizeps') || name.includes('bicep') || name.includes('curl')) return '💪';
    if (name.includes('trizeps') || name.includes('tricep')) return '🔱';
    if (name.includes('unterarm') || name.includes('forearm')) return '✊';
    
    // Beine
    if (name.includes('kniebeuge') || name.includes('squat')) return '🦵';
    if (name.includes('beinpresse') || name.includes('leg press')) return '🦿';
    if (name.includes('beinstreck') || name.includes('leg extension')) return '🦵';
    if (name.includes('beinbeug') || name.includes('leg curl') || name.includes('hamstring')) return '🦵';
    if (name.includes('ausfallschritt') || name.includes('lunge')) return '🚶';
    if (name.includes('wade') || name.includes('calf')) return '🦶';
    
    // Core
    if (name.includes('bauch') || name.includes('crunch') || name.includes('sit-up') || name.includes('situp')) return '🎯';
    if (name.includes('plank')) return '📏';
    
    // Standard
    return '🏋️';
}

// Holt das Icon für eine Übung (gespeichertes Icon bevorzugt)
function getExerciseIcon(exerciseNameOrObj, icon = null) {
    // Falls ein Objekt übergeben wurde
    if (typeof exerciseNameOrObj === 'object' && exerciseNameOrObj !== null) {
        if (exerciseNameOrObj.icon) return exerciseNameOrObj.icon;
        return getExerciseIconAuto(exerciseNameOrObj.name || '');
    }
    // Falls ein gespeichertes Icon übergeben wurde
    if (icon) return icon;
    // Fallback: Auto-Erkennung
    return getExerciseIconAuto(exerciseNameOrObj);
}

// Liste aller verfügbaren Icons für die Auswahl
const AVAILABLE_ICONS = [
    '🏋️', '💪', '🦵', '🦶', '🏃', '🚴', '🏊', '🧘',
    '🦋', '🚣', '🔽', '⬆️', '⬇️', '↔️', '🔱', '✊',
    '🎯', '📏', '🏗️', '🔙', '🎭', '🦿', '🚶', '⭐',
    '🔥', '💥', '⚡', '🎖️', '🏆', '💎', '🛡️', '⚔️'
];

// Liste aller verfügbaren Muskelgruppen
const MUSCLE_GROUPS = [
    'Brust',
    'Rücken',
    'Schultern',
    'Nacken',
    'Bizeps',
    'Trizeps',
    'Unterarme',
    'Quadrizeps',
    'Beinbeuger',
    'Waden',
    'Gesäß',
    'Adduktoren',
    'Abduktoren',
    'Bauch',
    'Unterer Rücken',
    'Cardio',
    'Sonstige'
];

// Keyword-basierte Auto-Erkennung für Muskelgruppen (gibt Array zurück)
function detectMuscleGroups(exerciseName) {
    const name = exerciseName.toLowerCase();
    const groups = [];
    
    // Brust
    if (name.includes('bank') || name.includes('brust') || name.includes('flieg') || 
        name.includes('butterfly') || name.includes('fly') || name.includes('cable cross') || 
        name.includes('liegestütz') || name.includes('push-up') || name.includes('pushup')) {
        // Butterfly hinterer Delta -> Schultern, nicht Brust
        if (!name.includes('hinterer') && !name.includes('rear')) {
            groups.push('Brust');
        }
    }
    
    // Rücken (nicht "Rückenstrecker" - das ist unterer Rücken)
    if ((name.includes('rücken') && !name.includes('streck')) || name.includes('lat') || 
        name.includes('ruder') || name.includes('row') || name.includes('pull') || 
        name.includes('deadlift') || name.includes('klimmzug') || name.includes('chin') || 
        name.includes('t-bar')) {
        groups.push('Rücken');
    }
    
    // Schultern (inkl. hinterer Delta)
    if (name.includes('schulter') || name.includes('shoulder') || name.includes('seitheben') || 
        name.includes('lateral') || name.includes('military') || name.includes('hinterer delta') || 
        name.includes('rear delt') || name.includes('frontheben') || name.includes('front raise') ||
        (name.includes('butterfly') && name.includes('hinterer'))) {
        groups.push('Schultern');
    }
    
    // Nacken
    if (name.includes('shrug') || name.includes('nacken') || name.includes('trap')) {
        groups.push('Nacken');
    }
    
    // Bizeps
    if (name.includes('bizeps') || name.includes('bicep') || name.includes('curl') || 
        name.includes('hammer')) {
        groups.push('Bizeps');
    }
    
    // Trizeps
    if (name.includes('trizeps') || name.includes('tricep') || name.includes('pushdown') || 
        name.includes('skull') || name.includes('french') ||
        (name.includes('drücken') && name.includes('kabel'))) {
        groups.push('Trizeps');
    }
    
    // Unterarme
    if (name.includes('unterarm') || name.includes('forearm') || name.includes('grip') || 
        name.includes('wrist')) {
        groups.push('Unterarme');
    }
    
    // Quadrizeps (Oberschenkel Vorderseite)
    if (name.includes('beinstreck') || name.includes('leg extension') || 
        name.includes('squat') || name.includes('kniebeuge') || 
        name.includes('beinpresse') || name.includes('leg press') ||
        name.includes('lunge') || name.includes('ausfallschritt')) {
        groups.push('Quadrizeps');
    }
    
    // Beinbeuger (Hamstrings)
    if (name.includes('beinbeug') || name.includes('leg curl') || name.includes('hamstring') ||
        name.includes('beinbeuger')) {
        groups.push('Beinbeuger');
    }
    
    // Waden
    if (name.includes('wade') || name.includes('calf') || name.includes('wadenmaschine')) {
        groups.push('Waden');
    }
    
    // Gesäß
    if (name.includes('gesäß') || name.includes('glute') || name.includes('hip thrust') || 
        name.includes('po ')) {
        groups.push('Gesäß');
    }
    
    // Adduktoren
    if (name.includes('addukt')) {
        groups.push('Adduktoren');
    }
    
    // Abduktoren
    if (name.includes('abdukt')) {
        groups.push('Abduktoren');
    }
    
    // Bauch
    if (name.includes('bauch') || name.includes('crunch') || name.includes('plank') || 
        name.includes('sit-up') || name.includes('situp') || name.includes(' ab ') || 
        name.includes('core')) {
        groups.push('Bauch');
    }
    
    // Unterer Rücken
    if (name.includes('rückenstreck') || name.includes('hyperextension') || 
        name.includes('lower back') || name.includes('good morning')) {
        groups.push('Unterer Rücken');
    }
    
    // Cardio / Warmup
    if (name.includes('warmup') || name.includes('warm-up') || name.includes('aufwärm') ||
        name.includes('laufband') || name.includes('treadmill') || name.includes('fahrrad') || 
        name.includes('bike') || name.includes('rudergerät') || name.includes('stepper') ||
        name.includes('cardio')) {
        groups.push('Cardio');
    }
    
    // Fallback
    if (groups.length === 0) {
        groups.push('Sonstige');
    }
    
    return groups;
}

// Holt Muskelgruppen für eine Übung (DB-Wert bevorzugt, Fallback auf Auto-Erkennung)
function getMuscleGroups(exercise) {
    // Falls exercise ein String ist, nur Auto-Erkennung
    if (typeof exercise === 'string') {
        return detectMuscleGroups(exercise);
    }
    
    // Falls DB-Wert vorhanden, diesen parsen (CSV-String)
    if (exercise.muscle_groups) {
        return exercise.muscle_groups.split(',').map(g => g.trim()).filter(g => g);
    }
    
    // Fallback auf Auto-Erkennung
    return detectMuscleGroups(exercise.name || '');
}

function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
}

// ============================================
// API Functions
// ============================================
async function api(endpoint, options = {}) {
    const url = `/api/${endpoint}`;
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    
    if (response.status === 401) {
        window.location.reload();
        return;
    }
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'API Error');
    }
    
    return response.json();
}

async function loadData() {
    try {
        showLoading(true);
        
        const [exercisesRes, setsRes, warmupsRes, workoutsRes, meRes] = await Promise.all([
            api('exercises'),
            api('sets'),
            api('warmups'),
            api('workouts?limit=10'),
            api('me').catch(() => null)
        ]);
        
        state.exercises = exercisesRes.exercises || [];
        state.sets = setsRes.sets || [];
        state.warmups = warmupsRes.warmups || [];
        state.workouts = workoutsRes.workouts || [];
        if (meRes) state.user = meRes;
        
        renderAll();
        if (state.user) {
            renderUserHeader(state.user);
        }
    } catch (error) {
        showError(error.message);
    } finally {
        showLoading(false);
    }
}



function getStatsStartDate(period) {
    const d = new Date();
    switch (period) {
        case '1m': d.setMonth(d.getMonth() - 1); break;
        case '3m': d.setMonth(d.getMonth() - 3); break;
        case '6m': d.setMonth(d.getMonth() - 6); break;
        case '1y': d.setFullYear(d.getFullYear() - 1); break;
        case 'all': return '1970-01-01';
    }
    return d.toISOString().split('T')[0];
}

async function loadStats() {
    try {
        const start = getStatsStartDate(state.statsPeriod);
        state.statsData = await api(`stats?start=${start}`);
        renderStats();
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// ============================================
// Render Functions
// ============================================
function showLoading(show) {
    elements.loading.style.display = show ? 'flex' : 'none';
}

function showError(message) {
    elements.error.textContent = message;
    elements.error.style.display = 'block';
    setTimeout(() => elements.error.style.display = 'none', 5000);
}

function renderAll() {
    renderWorkoutView();
    renderExercisesView();
    updateDateDisplay();
}

function updateDateDisplay() {
    elements.currentDate.textContent = formatDate(state.currentDate);
}

function getLastWorkoutOrder() {
    // Finde das letzte Workout (nicht das aktuelle Datum)
    const workoutDates = [...new Set(state.sets
        .filter(s => s.workout_date !== state.currentDate)
        .map(s => s.workout_date))]
        .sort()
        .reverse();
    
    if (workoutDates.length === 0) return new Map();
    
    const lastWorkoutDate = workoutDates[0];
    
    // Hole alle Sätze des letzten Workouts
    const lastWorkoutSets = state.sets
        .filter(s => s.workout_date === lastWorkoutDate);
    
    // Finde den ersten Satz (früheste Zeit) pro Übung
    const firstSetPerExercise = new Map();
    lastWorkoutSets.forEach(set => {
        const setTime = new Date(set.created_at).getTime();
        const currentFirst = firstSetPerExercise.get(set.exercise_id);
        if (!currentFirst || setTime < currentFirst.time) {
            firstSetPerExercise.set(set.exercise_id, { time: setTime, exerciseId: set.exercise_id });
        }
    });
    
    // Sortiere Übungen nach der Zeit ihres ersten Satzes (aufsteigend = zuerst trainiert zuerst)
    const sortedExercises = [...firstSetPerExercise.values()]
        .sort((a, b) => a.time - b.time);
    
    // Erstelle eine Map mit der Reihenfolge (0 = zuerst trainiert)
    const orderMap = new Map();
    sortedExercises.forEach((entry, index) => {
        orderMap.set(entry.exerciseId, index);
    });
    
    return orderMap;
}

function renderWorkoutView() {
    // Render Warmups zuerst
    renderWarmupSection();
    
    // Workout-Dauer anzeigen
    renderWorkoutDuration();
    
    // Gruppiere Sätze nach Übung für den aktuellen Tag
    const currentSets = state.sets.filter(s => s.workout_date === state.currentDate);
    const exercisesWithSets = new Map();
    
    currentSets.forEach(set => {
        if (!exercisesWithSets.has(set.exercise_id)) {
            exercisesWithSets.set(set.exercise_id, {
                id: set.exercise_id,
                name: set.exercise_name,
                sets: []
            });
        }
        exercisesWithSets.get(set.exercise_id).sets.push(set);
    });
    
    // Hole Reihenfolge des letzten Trainings
    const lastWorkoutOrder = getLastWorkoutOrder();
    
    // Alle Übungen sammeln
    const allExercises = state.exercises.map(e => {
        const sets = exercisesWithSets.get(e.id)?.sets || [];
        // Finde die früheste Zeit für diese Übung heute
        const firstSetTime = sets.length > 0 
            ? Math.min(...sets.map(s => new Date(s.created_at).getTime())) 
            : Infinity;
        return {
            id: e.id,
            name: e.name,
            icon: e.icon,
            sets: sets,
            hasCurrentSets: exercisesWithSets.has(e.id),
            firstSetTime: firstSetTime,
            lastWorkoutPosition: lastWorkoutOrder.get(e.id) ?? Infinity
        };
    });
    
    // Sortierung:
    // 1. Übungen mit heutigen Sätzen zuerst (zuerst trainiert = oben)
    // 2. Dann Übungen ohne heutige Sätze, nach Reihenfolge des letzten Trainings
    // 3. Dann der Rest alphabetisch
    allExercises.sort((a, b) => {
        // Beide haben heute Sätze -> zuerst trainiert kommt zuerst (frühere Zeit = früher)
        if (a.hasCurrentSets && b.hasCurrentSets) {
            return a.firstSetTime - b.firstSetTime;
        }
        
        // Nur eine hat heute Sätze -> die kommt zuerst
        if (a.hasCurrentSets) return -1;
        if (b.hasCurrentSets) return 1;
        
        // Keine hat heute Sätze -> nach Reihenfolge des letzten Trainings
        if (a.lastWorkoutPosition !== b.lastWorkoutPosition) {
            return a.lastWorkoutPosition - b.lastWorkoutPosition;
        }
        
        // Fallback: alphabetisch
        return a.name.localeCompare(b.name);
    });
    
    const exercisesInOrder = allExercises;
    
    if (exercisesInOrder.length === 0) {
        elements.exerciseList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">💪</div>
                <p>Noch keine Übungen vorhanden</p>
                <button class="primary-btn" onclick="showAddExerciseModal()">
                    Erste Übung hinzufügen
                </button>
            </div>
        `;
        return;
    }
    
    const isToday = state.currentDate === getTodayDate();
    const dateLabel = isToday ? 'heute' : formatDate(state.currentDate);
    
    elements.exerciseList.innerHTML = exercisesInOrder.map(exercise => {
        const currentSetsCount = exercise.sets.length;
        const hasSetsToday = currentSetsCount > 0;
        
        return `
            <div class="exercise-card ${hasSetsToday ? '' : 'no-sets'}" onclick="openExerciseModal(${exercise.id})">
                <div class="exercise-card-header">
                    <span class="exercise-name">${getExerciseIcon(exercise)} ${exercise.name}</span>
                    ${hasSetsToday ? `<span class="exercise-badge">${currentSetsCount} Sätze</span>` : ''}
                </div>
                ${hasSetsToday ? `
                    <div class="today-sets">
                        ${exercise.sets.map((s, i) => `
                            <span class="set-pill${s.superset_id ? ' superset' : ''}" ${s.superset_id ? `onclick="event.stopPropagation(); showSupersetInfo('${s.superset_id}')"` : ''}>
                                ${s.superset_id ? '<span class="superset-icon">🔗</span>' : ''}
                                <span class="weight">${s.weight}kg</span>
                                <span class="reps">×${s.reps}</span>
                                <span class="diff">${getDifficultyEmoji(s.difficulty)}</span>
                            </span>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

// ============================================
// Warmup Functions
// ============================================

function renderWarmupSection() {
    const currentWarmups = state.warmups.filter(w => w.workout_date === state.currentDate);
    
    // Prüfen ob Warmup-Section schon existiert
    let warmupSection = document.getElementById('warmupSection');
    
    if (!warmupSection) {
        // Erstelle die Warmup-Section vor der Exercise-Liste
        warmupSection = document.createElement('div');
        warmupSection.id = 'warmupSection';
        warmupSection.className = 'warmup-section';
        elements.exerciseList.parentNode.insertBefore(warmupSection, elements.exerciseList);
    }
    
    const warmupHtml = currentWarmups.map(warmup => {
        const type = WARMUP_TYPES.find(t => t.name === warmup.type) || { icon: '⚡', name: warmup.type };
        return `
            <div class="warmup-card" onclick="openWarmupModal(${warmup.id})">
                <div class="warmup-icon">${type.icon}</div>
                <div class="warmup-details">
                    <div class="warmup-type">${warmup.type}</div>
                    <div class="warmup-stats">
                        <span class="warmup-duration">${formatDuration(warmup.duration_seconds)}</span>
                        ${warmup.distance_meters ? `<span class="warmup-distance">${formatDistance(warmup.distance_meters)}</span>` : ''}
                        ${warmup.avg_heart_rate ? `<span class="warmup-hr">❤️ ${warmup.avg_heart_rate}</span>` : ''}
                        ${warmup.difficulty ? `<span class="warmup-diff">${getDifficultyEmoji(warmup.difficulty)}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    warmupSection.innerHTML = `
        <div class="warmup-header">
            <h3>🔥 Aufwärmen</h3>
            <button class="small-btn" onclick="showAddWarmupModal()">+ Hinzufügen</button>
        </div>
        ${currentWarmups.length > 0 ? `
            <div class="warmup-list">
                ${warmupHtml}
            </div>
        ` : `
            <div class="warmup-empty" onclick="showAddWarmupModal()">
                <span>Aufwärmen hinzufügen</span>
            </div>
        `}
    `;
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (secs === 0) return `${mins} Min`;
    return `${mins}:${secs.toString().padStart(2, '0')} Min`;
}

function formatDistance(meters) {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${meters} m`;
}

// Formatiert Set-Pausenzeit kompakt (z.B. "90s", "1:30", "2:15")
function formatRestTime(seconds) {
    if (!seconds || seconds <= 0) return null;
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (secs === 0) return `${mins}:00`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Berechnet Gesamtdauer eines Workouts (Warmups + Sets)
function calculateWorkoutDuration(workoutDate) {
    const currentWarmups = state.warmups.filter(w => w.workout_date === workoutDate);
    const currentSets = state.sets.filter(s => s.workout_date === workoutDate);
    
    // Warmup-Dauer (die tatsächliche Aktivitätszeit)
    const warmupDuration = currentWarmups.reduce((sum, w) => sum + (w.duration_seconds || 0), 0);
    
    // Set-Dauer (Pausenzeiten zwischen Sets)
    const setsDuration = currentSets.reduce((sum, s) => sum + (s.duration_cleaned || s.duration_seconds || 0), 0);
    
    return warmupDuration + setsDuration;
}

// Zeigt die Workout-Dauer im Header an
function renderWorkoutDuration() {
    const totalSeconds = calculateWorkoutDuration(state.currentDate);
    
    // Prüfen ob es Sätze oder Warmups gibt
    const hasSets = state.sets.some(s => s.workout_date === state.currentDate);
    const hasWarmups = state.warmups.some(w => w.workout_date === state.currentDate);
    
    // Dauer-Element erstellen oder aktualisieren
    let durationEl = document.getElementById('workoutDuration');
    
    if (!hasSets && !hasWarmups) {
        // Kein Workout - Element entfernen falls vorhanden
        if (durationEl) durationEl.remove();
        return;
    }
    
    if (!durationEl) {
        durationEl = document.createElement('div');
        durationEl.id = 'workoutDuration';
        durationEl.className = 'workout-duration';
        const workoutHeader = document.querySelector('.workout-header');
        if (workoutHeader) {
            workoutHeader.appendChild(durationEl);
        }
    }
    
    // Formatiere Dauer (Minuten oder Stunden:Minuten)
    if (totalSeconds > 0) {
        const hours = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        
        let durationText;
        if (hours > 0) {
            durationText = `${hours}h ${mins}min`;
        } else {
            durationText = `${mins} min`;
        }
        
        durationEl.innerHTML = `<span class="duration-icon">⏱️</span><span class="duration-text">${durationText}</span>`;
        durationEl.style.display = 'flex';
    } else {
        durationEl.style.display = 'none';
    }
}

function showAddWarmupModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'warmupModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>🔥 Aufwärmen hinzufügen</h2>
                <button class="close-modal" onclick="closeModal('warmupModal')">×</button>
            </div>
            <div class="modal-body">
                <div class="warmup-type-grid">
                    ${WARMUP_TYPES.map(type => `
                        <button class="warmup-type-btn" onclick="selectWarmupType('${type.name}', '${type.icon}')">
                            <span class="warmup-type-icon">${type.icon}</span>
                            <span class="warmup-type-name">${type.name}</span>
                        </button>
                    `).join('')}
                </div>
                
                <div id="warmupForm" style="display: none;">
                    <div class="selected-warmup-type">
                        <span id="selectedWarmupIcon"></span>
                        <span id="selectedWarmupName"></span>
                    </div>
                    
                    <div class="form-group">
                        <label>Dauer (Minuten)</label>
                        <div class="number-input">
                            <button onclick="adjustWarmupDuration(-1)">-</button>
                            <input type="number" id="warmupDuration" min="1" value="10">
                            <button onclick="adjustWarmupDuration(1)">+</button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>Distanz (optional, in Metern)</label>
                        <input type="number" id="warmupDistance" placeholder="z.B. 2000">
                    </div>
                    
                    <div class="form-group">
                        <label>Ø Herzfrequenz (optional)</label>
                        <input type="number" id="warmupHeartRate" placeholder="z.B. 130">
                    </div>
                    
                    <div class="form-group">
                        <label>Kalorien (optional)</label>
                        <input type="number" id="warmupCalories" placeholder="z.B. 150">
                    </div>
                    
                    <div class="difficulty-selector">
                        <label>Anstrengung (optional)</label>
                        <div class="difficulty-options">
                            <button class="diff-btn" data-value="Leicht" onclick="selectWarmupDifficulty(this)">🟢</button>
                            <button class="diff-btn" data-value="Mittel" onclick="selectWarmupDifficulty(this)">🟡</button>
                            <button class="diff-btn" data-value="Schwer" onclick="selectWarmupDifficulty(this)">🟠</button>
                            <button class="diff-btn" data-value="Sehr schwer" onclick="selectWarmupDifficulty(this)">🔴</button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>Notizen (optional)</label>
                        <textarea id="warmupNotes" placeholder="z.B. Intervalle, Steigung..."></textarea>
                    </div>
                    
                    <button class="primary-btn full-width" onclick="saveWarmup()">
                        Aufwärmen speichern
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

let selectedWarmupType = null;
let selectedWarmupDifficulty = null;

function selectWarmupType(name, icon) {
    selectedWarmupType = name;
    document.getElementById('selectedWarmupIcon').textContent = icon;
    document.getElementById('selectedWarmupName').textContent = name;
    document.querySelector('.warmup-type-grid').style.display = 'none';
    document.getElementById('warmupForm').style.display = 'block';
}

function selectWarmupDifficulty(btn) {
    document.querySelectorAll('#warmupModal .diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedWarmupDifficulty = btn.dataset.value;
}

function adjustWarmupDuration(delta) {
    const input = document.getElementById('warmupDuration');
    const newVal = Math.max(1, parseInt(input.value || 0) + delta);
    input.value = newVal;
}

async function saveWarmup() {
    const duration = parseInt(document.getElementById('warmupDuration').value) * 60; // Convert to seconds
    const distance = parseInt(document.getElementById('warmupDistance').value) || null;
    const heartRate = parseInt(document.getElementById('warmupHeartRate').value) || null;
    const calories = parseInt(document.getElementById('warmupCalories').value) || null;
    const notes = document.getElementById('warmupNotes').value || null;
    
    if (!selectedWarmupType || !duration) {
        showToast('Bitte Typ und Dauer angeben', 'error');
        return;
    }
    
    try {
        const result = await api('warmups', {
            method: 'POST',
            body: JSON.stringify({
                workoutDate: state.currentDate,
                type: selectedWarmupType,
                duration_seconds: duration,
                distance_meters: distance,
                avg_heart_rate: heartRate,
                difficulty: selectedWarmupDifficulty,
                calories: calories,
                notes: notes
            })
        });
        
        // Add to state
        state.warmups.push({
            ...result,
            workout_date: state.currentDate
        });
        
        closeModal('warmupModal');
        renderWarmupSection();
        showToast('Aufwärmen hinzugefügt', 'success');
        
        // Reset
        selectedWarmupType = null;
        selectedWarmupDifficulty = null;
    } catch (error) {
        showToast('Fehler: ' + error.message, 'error');
    }
}

function openWarmupModal(warmupId) {
    const warmup = state.warmups.find(w => w.id === warmupId);
    if (!warmup) return;
    
    const type = WARMUP_TYPES.find(t => t.name === warmup.type) || { icon: '⚡', name: warmup.type };
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'warmupDetailModal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h2>${type.icon} ${warmup.type}</h2>
                <button class="close-modal" onclick="closeModal('warmupDetailModal')">×</button>
            </div>
            <div class="modal-body">
                <div class="warmup-detail-grid">
                    <div class="warmup-detail-item">
                        <span class="label">Dauer</span>
                        <span class="value">${formatDuration(warmup.duration_seconds)}</span>
                    </div>
                    ${warmup.distance_meters ? `
                        <div class="warmup-detail-item">
                            <span class="label">Distanz</span>
                            <span class="value">${formatDistance(warmup.distance_meters)}</span>
                        </div>
                    ` : ''}
                    ${warmup.avg_heart_rate ? `
                        <div class="warmup-detail-item">
                            <span class="label">Ø Herzfrequenz</span>
                            <span class="value">❤️ ${warmup.avg_heart_rate} bpm</span>
                        </div>
                    ` : ''}
                    ${warmup.calories ? `
                        <div class="warmup-detail-item">
                            <span class="label">Kalorien</span>
                            <span class="value">🔥 ${warmup.calories} kcal</span>
                        </div>
                    ` : ''}
                    ${warmup.difficulty ? `
                        <div class="warmup-detail-item">
                            <span class="label">Anstrengung</span>
                            <span class="value">${getDifficultyEmoji(warmup.difficulty)} ${warmup.difficulty}</span>
                        </div>
                    ` : ''}
                    ${warmup.notes ? `
                        <div class="warmup-detail-item full-width">
                            <span class="label">Notizen</span>
                            <span class="value">${warmup.notes}</span>
                        </div>
                    ` : ''}
                </div>
                
                <button class="primary-btn full-width" style="background: var(--danger); margin-top: 20px;" onclick="deleteWarmup(${warmup.id})">
                    🗑️ Löschen
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function deleteWarmup(warmupId) {
    if (!confirm('Aufwärmen wirklich löschen?')) return;
    
    try {
        await api(`warmups/${warmupId}`, { method: 'DELETE' });
        state.warmups = state.warmups.filter(w => w.id !== warmupId);
        closeModal('warmupDetailModal');
        renderWarmupSection();
        showToast('Aufwärmen gelöscht', 'success');
    } catch (error) {
        showToast('Fehler: ' + error.message, 'error');
    }
}

// ============================================
// End Warmup Functions
// ============================================

function getLastSetForExercise(exerciseId, excludeDate = null) {
    const exerciseSets = state.sets
        .filter(s => s.exercise_id === exerciseId && s.workout_date !== excludeDate)
        .sort((a, b) => {
            const dateCompare = new Date(b.workout_date) - new Date(a.workout_date);
            if (dateCompare !== 0) return dateCompare;
            return b.set_number - a.set_number;
        });
    
    return exerciseSets[0] || null;
}

// Superset Helper Functions
function getSupersetPartners(set) {
    if (!set.superset_id) return [];
    return state.sets.filter(s => 
        s.superset_id === set.superset_id && 
        s.id !== set.id
    );
}

function showSupersetInfo(supersetId) {
    const sets = state.sets.filter(s => s.superset_id === supersetId);
    if (sets.length === 0) return;
    
    const infoHtml = sets.map(s => {
        const exercise = state.exercises.find(e => e.id === s.exercise_id);
        return `<div class="superset-info-item">
            <span class="exercise-name">${getExerciseIcon(exercise)} ${s.exercise_name}</span>
            <span class="set-details">${s.weight}kg × ${s.reps} ${getDifficultyEmoji(s.difficulty)}</span>
        </div>`;
    }).join('');
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'supersetInfoModal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 350px;">
            <div class="modal-header">
                <h2>🔗 Supersatz</h2>
                <button class="close-modal" onclick="closeModal('supersetInfoModal')">×</button>
            </div>
            <div class="modal-body">
                <p style="color: var(--text-secondary); margin-bottom: 12px; font-size: 14px;">
                    Diese Sätze wurden zusammen als Supersatz ausgeführt:
                </p>
                <div class="superset-info-list">
                    ${infoHtml}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function getSupersetLinkCandidates(sourceSet) {
    // Alle Sets vom gleichen Tag, außer dem aktuellen Set selbst
    // und Sets der gleichen Übung (die kann man meist nicht verknüpfen, außer man macht Zirkel mit gleichen Übungen?)
    // Normalerweise supersettet man verschiedene Übungen.
    const sameDaySets = state.sets.filter(s => s.workout_date === state.currentDate);
    const candidates = sameDaySets.filter(s => s.id !== sourceSet.id && s.exercise_id !== sourceSet.exercise_id);

    // Gruppiere nach Übung
    const byExercise = new Map();
    candidates.forEach(s => {
        if (!byExercise.has(s.exercise_id)) {
            byExercise.set(s.exercise_id, []);
        }
        byExercise.get(s.exercise_id).push(s);
    });

    // Sortiere Sets innerhalb der Übung nach Set-Nummer
    for (const sets of byExercise.values()) {
        sets.sort((a, b) => a.set_number - b.set_number);
    }

    return byExercise;
}

function openLinkSupersetModal(setId) {
    const sourceSet = state.sets.find(s => s.id === setId);
    if (!sourceSet) return;

    const candidatesByExercise = getSupersetLinkCandidates(sourceSet);
    if (candidatesByExercise.size === 0) {
        showToast('Keine Sätze zum Verknüpfen gefunden (heute)', 'error');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'linkSupersetModal';
    
    // HTML für die Liste generieren
    let listHtml = '';
    
    // Sortiere Übungen nach Zeitpunkt des letzten Satzes (neueste oben)
    const sortedEntries = [...candidatesByExercise.entries()].sort((a, b) => {
        const lastSetA = a[1][a[1].length - 1];
        const lastSetB = b[1][b[1].length - 1];
        return new Date(lastSetB.created_at) - new Date(lastSetA.created_at);
    });

    for (const [exerciseId, sets] of sortedEntries) {
        const exercise = state.exercises.find(e => e.id === exerciseId);
        listHtml += `
            <div class="superset-link-group">
                <div class="superset-link-group-title">${getExerciseIcon(exercise)} ${exercise.name}</div>
                ${sets.map(s => {
                    const alreadyLinked = s.superset_id ? ' • 🔗' : '';
                    return `
                        <button class="superset-link-option" onclick="linkSetsAsSuperset(${sourceSet.id}, ${s.id})">
                            <span class="set-number">#${s.set_number}</span>
                            <span class="set-meta">${s.weight}kg × ${s.reps} ${getDifficultyEmoji(s.difficulty)}${alreadyLinked}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 420px;">
            <div class="modal-header">
                <h2>⛓️ Supersatz verknüpfen</h2>
                <button class="close-modal" onclick="closeModal('linkSupersetModal')">×</button>
            </div>
            <div class="modal-body">
                <p style="color: var(--text-secondary); margin-bottom: 12px; font-size: 14px;">
                    Wähle einen Partner-Satz:
                </p>
                <div class="superset-link-list">
                    ${listHtml}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

async function linkSetsAsSuperset(setId, targetSetId) {
    const currentExerciseId = state.currentExercise?.id;

    try {
        await api('sets/link', {
            method: 'POST',
            body: JSON.stringify({ setId, targetSetId })
        });

        closeModal('linkSupersetModal');
        showToast('Supersatz verknüpft');

        // Reload to keep state consistent (inkl. möglicher Merge)
        await loadData();

        if (currentExerciseId) {
            openExerciseModal(currentExerciseId);
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function unlinkSetFromSuperset(setId) {
    if (!confirm('Möchtest du diesen Satz wirklich aus dem Supersatz lösen?')) {
        return;
    }

    const currentExerciseId = state.currentExercise?.id;

    try {
        await api(`sets/${setId}/superset`, {
            method: 'PUT',
            body: JSON.stringify({ superset_id: null })
        });

        const set = state.sets.find(s => s.id === setId);
        if (set) set.superset_id = null;

        showToast('Supersatz entfernt');

        if (currentExerciseId) {
            openExerciseModal(currentExerciseId);
        }
        renderWorkoutView();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function renderExercisesView() {
    const searchTerm = elements.exerciseSearch?.value?.toLowerCase() || '';
    
    const filtered = state.exercises.filter(e => 
        e.name.toLowerCase().includes(searchTerm)
    );
    
    // Sortiere nach Anzahl der Sätze (Häufigkeit)
    const exercisesWithStats = filtered.map(e => {
        const setCount = state.sets.filter(s => s.exercise_id === e.id).length;
        const lastSet = getLastSetForExercise(e.id);
        return { ...e, setCount, lastSet };
    });
    
    exercisesWithStats.sort((a, b) => b.setCount - a.setCount);
    
    elements.allExercisesList.innerHTML = exercisesWithStats.map(e => `
        <div class="all-exercise-item" onclick="showEditExerciseModal(${e.id})">
            <div style="flex: 1;">
                <span class="exercise-item-name">${getExerciseIcon(e)} ${e.name}</span>
                <div class="exercise-item-stats">
                    ${e.setCount} Sätze${e.lastSet ? ` • ${e.lastSet.weight}kg` : ''}
                </div>
            </div>
            <button class="delete-exercise-btn" onclick="event.stopPropagation(); confirmDeleteExercise(${e.id}, '${e.name.replace(/'/g, "\\'")}')">
                🗑️
            </button>
        </div>
    `).join('');
    
    if (exercisesWithStats.length === 0 && searchTerm) {
        elements.allExercisesList.innerHTML = `
            <div class="empty-state">
                <p>Keine Übungen gefunden</p>
                <button class="primary-btn" onclick="createExerciseFromSearch()">
                    "${searchTerm}" erstellen
                </button>
            </div>
        `;
    }
}

function switchStatsPeriod(period) {
    state.statsPeriod = period;
    loadStats();
    
    // Falls eine Übung im Chart ausgewählt ist, diese auch aktualisieren
    const select = document.getElementById('chartExerciseSelect');
    if (select && select.value) {
        loadExerciseChart(select.value);
    }
}

// Chart-Instanzen global speichern
let weeklyChart = null;
let splitChart = null;
let progressChart = null;

function renderStats() {
    const data = state.statsData;
    if (!data) return;

    const { totals, weekly, exercises } = data;
    
    // 1. Period Selector
    const periods = [
        { id: '1m', label: '1 M' },
        { id: '3m', label: '3 M' },
        { id: '6m', label: '6 M' },
        { id: '1y', label: '1 J' },
        { id: 'all', label: 'Max' }
    ];

    const periodHtml = `
        <div class="stats-filter">
            ${periods.map(p => `
                <button class="filter-btn ${state.statsPeriod === p.id ? 'active' : ''}" 
                        onclick="switchStatsPeriod('${p.id}')">
                    ${p.label}
                </button>
            `).join('')}
        </div>
    `;

    // 2. KPIs
    // Berechne Gesamtzeit aus allen Sätzen im Zeitraum (falls verfügbar)
    const totalSeconds = state.sets
        .filter(s => s.workout_date >= getStatsStartDate(state.statsPeriod))
        .reduce((sum, s) => sum + (s.duration_cleaned || s.duration_seconds || 0), 0);
    
    const totalHours = Math.round(totalSeconds / 3600);

    const kpiHtml = `
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-value">${totals?.total_workouts || 0}</div>
                <div class="stat-label">Workouts</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${totalHours}h</div>
                <div class="stat-label">Zeit gesamt</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${Math.round((totals?.total_volume || 0) / 1000)}t</div>
                <div class="stat-label">Volumen</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${totals?.total_sets || 0}</div>
                <div class="stat-label">Sätze</div>
            </div>
        </div>
    `;

    // 3. Weekly Chart Container
    const weeklyChartHtml = `
        <div class="stats-card">
            <h3>Verlauf (Wöchentlich)</h3>
            <div class="chart-wrapper" style="height: 250px;">
                <canvas id="weeklyChart"></canvas>
            </div>
        </div>
    `;

    // 4. Progress Chart Container (Wiederhergestellt)
    // Sortiere Übungen alphabetisch
    const sortedExercises = [...state.exercises].sort((a, b) => a.name.localeCompare(b.name));

    const progressChartHtml = `
        <div class="stats-card">
            <h3>Gewichtsverlauf (Übung)</h3>
            <select id="chartExerciseSelect" class="exercise-select" onchange="loadExerciseChart(this.value)">
                <option value="">Übung wählen...</option>
                ${sortedExercises.map(e => `<option value="${e.id}">${e.name.replace(/"/g, '&quot;')}</option>`).join('')}
            </select>
            <div class="chart-wrapper" style="height: 250px;">
                <canvas id="progressChart"></canvas>
            </div>
        </div>
    `;

    // 5. Split Chart Container
    const splitChartHtml = `
        <div class="stats-card">
            <h3>Muskelgruppen (Volumen)</h3>
            <div class="chart-wrapper" style="height: 250px; display: flex; justify-content: center;">
                <canvas id="splitChart"></canvas>
            </div>
        </div>
    `;

    // 6. Top Exercises List
    const topExercises = exercises.slice(0, 5);
    const topExercisesHtml = `
        <div class="stats-card">
            <h3>Top Übungen (Volumen)</h3>
            <div class="all-exercises-list">
                ${topExercises.map(e => `
                    <div class="all-exercise-item" style="cursor: default;">
                        <span class="exercise-item-name">${getExerciseIcon(e.name)} ${e.name}</span>
                        <span class="exercise-item-stats">
                            ${Math.round(e.volume / 1000)}t (${e.set_count} Sets)
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    elements.overallStats.innerHTML = periodHtml + kpiHtml;
    // Clear old containers
    elements.chartContainer.innerHTML = ''; 
    elements.exerciseStatsContainer.innerHTML = weeklyChartHtml + progressChartHtml + splitChartHtml + topExercisesHtml;

    // Charts rendern
    renderWeeklyChart(weekly);
    renderSplitChart(exercises);
    // Progress Chart wird erst gerendert, wenn eine Übung ausgewählt wird
}

// ... WeeklyChart ...

// ... MuscleGroup ...

// ... SplitChart ...

async function loadExerciseChart(exerciseId) {
    if (!exerciseId) {
        if (progressChart) {
            progressChart.destroy();
            progressChart = null;
        }
        return;
    }
    
    try {
        const data = await api(`stats/exercise?id=${exerciseId}`);
        renderProgressChart(data.progression);
    } catch (error) {
        console.error('Error loading chart:', error);
    }
}

function renderProgressChart(progression) {
    const ctx = document.getElementById('progressChart');
    if (!ctx) return;
    
    if (progressChart) {
        progressChart.destroy();
    }
    
    if (!progression || progression.length === 0) {
        return;
    }
    
    const labels = progression.map(p => {
        const date = new Date(p.workout_date);
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    });
    
    const weights = progression.map(p => p.max_weight);
    const volumes = progression.map(p => Math.round(p.total_volume));
    
    progressChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Max. Gewicht (kg)',
                    data: weights,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Volumen (kg)',
                    data: volumes,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#94a3b8',
                        font: { size: 12 }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b' },
                    grid: { color: 'rgba(51, 65, 85, 0.5)' }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    ticks: { color: '#3b82f6' },
                    grid: { color: 'rgba(51, 65, 85, 0.5)' },
                    title: {
                        display: true,
                        text: 'Gewicht (kg)',
                        color: '#3b82f6'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    ticks: { color: '#10b981' },
                    grid: { drawOnChartArea: false },
                    title: {
                        display: true,
                        text: 'Volumen (kg)',
                        color: '#10b981'
                    }
                }
            }
        }
    });
}

function renderWeeklyChart(weeklyData) {
    const ctx = document.getElementById('weeklyChart');
    if (!ctx) return;

    if (weeklyChart) weeklyChart.destroy();

    const labels = weeklyData.map(d => {
        // Format: "KW XX"
        // d.week kommt als "YYYY-WW" aus der Datenbank
        if (d.week) {
            const [year, week] = d.week.split('-');
            return `KW ${week}`;
        }
        // Fallback
        const date = new Date(d.week_start);
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    });

    weeklyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Workouts',
                    data: weeklyData.map(d => d.workout_count),
                    backgroundColor: '#3b82f6',
                    yAxisID: 'y',
                    order: 2
                },
                {
                    label: 'Volumen (t)',
                    data: weeklyData.map(d => d.volume / 1000),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    type: 'line',
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { ticks: { color: '#64748b' }, grid: { display: false } },
                y: { 
                    type: 'linear', position: 'left', 
                    ticks: { color: '#3b82f6', stepSize: 1 }, 
                    grid: { color: 'rgba(51, 65, 85, 0.3)' },
                    title: { display: true, text: 'Anzahl Workouts', color: '#3b82f6' }
                },
                y1: { 
                    type: 'linear', position: 'right', 
                    ticks: { color: '#10b981' }, 
                    grid: { display: false },
                    title: { display: true, text: 'Volumen (Tonnen)', color: '#10b981' }
                }
            },
            plugins: { 
                legend: { 
                    display: true,
                    labels: { color: '#94a3b8' }
                } 
            }
        }
    });
}

function renderSplitChart(exercises) {
    const ctx = document.getElementById('splitChart');
    if (!ctx) return;

    if (splitChart) splitChart.destroy();

    // Aggregieren nach Muskelgruppe (1:n - eine Übung kann mehrere Gruppen haben)
    const groups = {};
    exercises.forEach(e => {
        // Finde die Übung im State, um muscle_groups aus DB zu holen
        const exerciseFromState = state.exercises.find(ex => ex.name === e.name);
        const muscleGroups = getMuscleGroups(exerciseFromState || e.name);
        
        // Volumen auf alle Muskelgruppen aufteilen
        const volumePerGroup = e.volume / muscleGroups.length;
        muscleGroups.forEach(group => {
            if (!groups[group]) groups[group] = 0;
            groups[group] += volumePerGroup;
        });
    });

    const labels = Object.keys(groups);
    const data = Object.values(groups);
    
    // Farben für Gruppen (erweitert für mehr Kategorien)
    const colorMap = {
        'Brust': '#3b82f6',
        'Rücken': '#10b981',
        'Schultern': '#f59e0b',
        'Nacken': '#a855f7',
        'Bizeps': '#ef4444',
        'Trizeps': '#ec4899',
        'Unterarme': '#f97316',
        'Quadrizeps': '#14b8a6',
        'Beinbeuger': '#06b6d4',
        'Waden': '#84cc16',
        'Gesäß': '#d946ef',
        'Adduktoren': '#8b5cf6',
        'Abduktoren': '#6366f1',
        'Bauch': '#eab308',
        'Unterer Rücken': '#22c55e',
        'Cardio': '#64748b',
        'Sonstige': '#94a3b8'
    };
    const colors = labels.map(l => colorMap[l] || '#94a3b8');

    splitChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#94a3b8' } }
            }
        }
    });
}

async function loadExerciseChart(exerciseId) {
    // Falls keine ID übergeben wurde (z.B. durch leere Auswahl), Chart löschen
    if (!exerciseId) {
        if (progressChart) {
            progressChart.destroy();
            progressChart = null;
        }
        return;
    }
    
    try {
        const start = getStatsStartDate(state.statsPeriod);
        const data = await api(`stats/exercise?id=${exerciseId}&start=${start}`);
        renderProgressChart(data.progression);
    } catch (error) {
        console.error('Error loading chart:', error);
    }
}

function renderProgressChart(progression) {
    const ctx = document.getElementById('progressChart');
    if (!ctx) return;
    
    if (progressChart) {
        progressChart.destroy();
    }
    
    if (!progression || progression.length === 0) {
        return;
    }
    
    const labels = progression.map(p => {
        const date = new Date(p.workout_date);
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    });
    
    const weights = progression.map(p => p.max_weight);
    const avgWeights = progression.map(p => Math.round(p.avg_weight * 10) / 10);
    const volumes = progression.map(p => Math.round(p.total_volume));
    const avgReps = progression.map(p => Math.round(p.avg_reps * 10) / 10);
    const setCounts = progression.map(p => p.set_count);
    const hasSuperset = progression.map(p => !!p.has_superset);
    
    progressChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Max. Gewicht (kg)',
                    data: weights,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'y',
                    order: 1,
                    pointStyle: hasSuperset.map(v => v ? 'rectRot' : 'circle'),
                    pointRadius: hasSuperset.map(v => v ? 5 : 3),
                    pointHoverRadius: hasSuperset.map(v => v ? 6 : 4)
                },
                {
                    label: 'Ø Gewicht (kg)',
                    data: avgWeights,
                    borderColor: '#60a5fa',
                    borderDash: [5, 5],
                    backgroundColor: 'transparent',
                    pointRadius: 0,
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'y',
                    order: 2
                },
                {
                    label: 'Volumen (kg)',
                    data: volumes,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1',
                    order: 5 // Ganz hinten
                },
                {
                    label: 'Ø Wdh.',
                    data: avgReps,
                    type: 'bar',
                    backgroundColor: 'rgba(148, 163, 184, 0.5)',
                    borderColor: 'rgba(148, 163, 184, 0.8)',
                    borderWidth: 1,
                    barPercentage: 0.5,
                    yAxisID: 'y2',
                    order: 3
                },
                {
                    label: 'Sätze',
                    data: setCounts,
                    type: 'line',
                    borderColor: '#f59e0b', // Orange/Amber
                    backgroundColor: '#f59e0b',
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0, // Eckig/Direkt
                    fill: false,
                    yAxisID: 'y2',
                    order: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#94a3b8',
                        font: { size: 11 },
                        usePointStyle: true,
                        boxWidth: 8
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#f8fafc',
                    bodyColor: '#cbd5e1',
                    borderColor: '#334155',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y;
                            }
                            return label;
                        },
                        afterBody: function(items) {
                            const index = items?.[0]?.dataIndex;
                            if (index === undefined) return [];
                            return hasSuperset[index] ? ['🔗 Supersatz'] : [];
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b' },
                    grid: { color: 'rgba(51, 65, 85, 0.5)' }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    ticks: { color: '#3b82f6' },
                    grid: { color: 'rgba(51, 65, 85, 0.3)' },
                    title: { display: true, text: 'Gewicht (kg)', color: '#3b82f6', font: { size: 10 } }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    ticks: { color: '#10b981' },
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Volumen', color: '#10b981', font: { size: 10 } }
                },
                y2: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#94a3b8' },
                    title: { display: true, text: 'Wdh. / Sätze', color: '#94a3b8', font: { size: 10 } },
                    // Skala anpassen, damit Sätze/Reps gut sichtbar sind (z.B. min 0)
                    min: 0
                }
            }
        }
    });
}

// ============================================
// Modal Functions
// ============================================
function getWorkoutHistoryForExercise(exerciseId, beforeDate, limit = 5) {
    // "Vergangene Trainings" = Workouts vor dem aktuell ausgewählten Datum
    const cutoffDate = beforeDate || '9999-12-31';
    const exerciseSets = state.sets
        .filter(s => s.exercise_id === exerciseId && s.workout_date < cutoffDate);

    if (exerciseSets.length === 0) return [];

    // Gruppiere nach Workout-Datum
    const byDate = new Map();
    exerciseSets.forEach(set => {
        if (!byDate.has(set.workout_date)) byDate.set(set.workout_date, []);
        byDate.get(set.workout_date).push(set);
    });

    // Neueste zuerst
    const dates = [...byDate.keys()].sort().reverse().slice(0, limit);

    return dates.map(date => ({
        date,
        sets: byDate.get(date).slice().sort((a, b) => a.set_number - b.set_number)
    }));
}

function openExerciseModal(exerciseId) {
    const exercise = state.exercises.find(e => e.id === exerciseId);
    if (!exercise) return;
    
    state.currentExercise = exercise;
    
    // Sätze für aktuelles Datum
    const currentSets = state.sets
        .filter(s => s.exercise_id === exerciseId && s.workout_date === state.currentDate)
        .sort((a, b) => a.set_number - b.set_number);
    
    // Verlauf: letzte 5 vergangene Trainings (vor aktuellem Datum)
    const workoutHistory = getWorkoutHistoryForExercise(exerciseId, state.currentDate, 5);
    const lastWorkoutEntry = workoutHistory[0] || null;
    const lastWorkoutDate = lastWorkoutEntry?.date || null;
    const lastWorkoutSets = lastWorkoutEntry?.sets || [];
    const olderWorkouts = workoutHistory.slice(1);
    
    // Next set number
    const nextSetNumber = currentSets.length > 0 
        ? Math.max(...currentSets.map(s => s.set_number)) + 1 
        : 1;
    
    // Vorschlagswerte: gleiche Satznummer vom letzten Training, oder letzter Satz als Fallback
    const matchingSet = lastWorkoutSets.find(s => s.set_number === nextSetNumber);
    const fallbackSet = lastWorkoutSets[lastWorkoutSets.length - 1]; // letzter Satz
    const suggestedSet = matchingSet || fallbackSet;
    
    // Modal befüllen
    document.getElementById('exerciseModalTitle').textContent = exercise.name;
    document.getElementById('lastWorkoutDate').textContent = lastWorkoutDate 
        ? formatDate(lastWorkoutDate) 
        : 'Noch nie trainiert';
    
    // Inputs vorbefüllen
    document.getElementById('newWeight').value = suggestedSet?.weight || 0;
    document.getElementById('newReps').value = suggestedSet?.reps || 0;
    
    // Difficulty reset
    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === (suggestedSet?.difficulty || 'Mittel'));
    });
    
    // Render history as horizontal swipe cards (Referenz)
    const lastSetsContainer = document.getElementById('lastSetsContainer') || createLastSetsContainer();
    if (workoutHistory.length > 0) {
        const historyCount = workoutHistory.length;

        lastSetsContainer.innerHTML = `
            <h3>Vergangene Trainings (letzte ${historyCount})</h3>
            <div class="history-carousel" aria-label="Vergangene Trainings">
                ${workoutHistory.map(workout => `
                    <div class="history-card">
                        <div class="history-card-header">${formatDateFullCompact(workout.date)}</div>
                        <div class="last-sets-list">
                            ${workout.sets.map(set => {
                                const partners = getSupersetPartners(set);
                                const hasSuperset = partners.length > 0;
                                return `
                                <div class="last-set-row ${set.set_number === nextSetNumber ? 'highlighted' : ''} ${hasSuperset ? 'has-superset' : ''}">
                                    <span class="set-number">${set.set_number}</span>
                                    <span class="set-metric"><span class="weight">${set.weight}kg</span><span class="reps">×${set.reps}</span></span>
                                    <span class="set-difficulty">${getDifficultyEmoji(set.difficulty)}</span>
                                    ${hasSuperset ? `
                                        <span class="superset-indicator small" title="Supersatz mit: ${partners.map(p => p.exercise_name).join(', ')}"
                                              onclick="event.stopPropagation(); showSupersetInfo('${set.superset_id}')">🔗</span>
                                    ` : ''}
                                </div>
                            `;
                            }).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
            ${historyCount > 1 ? `<div class="history-swipe-hint">Wischen für ältere Trainings</div>` : ''}
        `;
        lastSetsContainer.style.display = 'block';
    } else {
        lastSetsContainer.innerHTML = '';
        lastSetsContainer.style.display = 'none';
    }
    
    // Render current sets
    const setsContainer = document.getElementById('setsContainer');
    const isToday = state.currentDate === getTodayDate();
    const setsTitle = isToday ? 'Heutige Sätze' : `Sätze (${formatDate(state.currentDate)})`;
    
    if (currentSets.length > 0) {
        setsContainer.innerHTML = `
            <h3>${setsTitle}</h3>
            ${currentSets.map(set => {
                const supersetPartners = getSupersetPartners(set);
                const hasSupersetPartner = supersetPartners.length > 0;
                const restTime = formatRestTime(set.duration_cleaned || set.duration_seconds);
                return `
                <div class="set-row ${hasSupersetPartner ? 'has-superset' : ''}" data-set-id="${set.id}" ${set.superset_id ? `data-superset-id="${set.superset_id}"` : ''}>
                    <span class="set-number">${set.set_number}</span>
                    <div class="set-details">
                        <span class="set-weight">${set.weight} kg</span>
                        <span class="set-reps">${set.reps} Wdh.</span>
                    </div>
                    <span class="set-difficulty">${getDifficultyEmoji(set.difficulty)}</span>
                    ${restTime ? `<span class="set-rest-time" title="Pausenzeit">⏱️${restTime}</span>` : ''}
                    ${hasSupersetPartner ? `
                        <span class="superset-indicator" title="Supersatz mit: ${supersetPartners.map(p => p.exercise_name).join(', ')}" 
                              onclick="event.stopPropagation(); showSupersetInfo('${set.superset_id}')">
                            🔗
                        </span>
                    ` : ''}
                    <div class="set-actions">
                        <button class="set-action-btn" onclick="openLinkSupersetModal(${set.id})" title="Supersatz verknüpfen">⛓️</button>
                        ${set.superset_id ? `<button class="set-action-btn" onclick="unlinkSetFromSuperset(${set.id})" title="Supersatz entfernen">🔓</button>` : ''}
                        <button class="set-action-btn" onclick="editSet(${set.id})">✏️</button>
                        <button class="set-action-btn delete" onclick="deleteSet(${set.id})">🗑️</button>
                    </div>
                </div>
            `}).join('')}
        `;
    } else {
        setsContainer.innerHTML = '';
    }
    
    // Store next set number
    elements.exerciseModal.dataset.nextSet = nextSetNumber;
    
    // Show modal
    elements.exerciseModal.style.display = 'flex';
}

function createLastSetsContainer() {
    const container = document.createElement('div');
    container.id = 'lastSetsContainer';
    container.className = 'last-sets-container';
    // Vor dem setsContainer einfügen
    const setsContainer = document.getElementById('setsContainer');
    setsContainer.parentNode.insertBefore(container, setsContainer);
    return container;
}

function closeExerciseModal() {
    elements.exerciseModal.style.display = 'none';
    state.currentExercise = null;
}

function showAddExerciseModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'addExerciseModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Übung hinzufügen</h2>
                <button class="close-modal" onclick="closeModal('addExerciseModal')">×</button>
            </div>
            <div class="modal-body">
                <div class="exercise-selector">
                    ${state.exercises.map(e => `
                        <div class="exercise-option" onclick="selectExercise(${e.id})">
                            <span>${e.name}</span>
                            <span style="color: var(--text-muted);">→</span>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top: 20px;">
                    <button class="primary-btn full-width" onclick="showCreateExerciseModal()">
                        + Neue Übung erstellen
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function selectExercise(exerciseId) {
    closeModal('addExerciseModal');
    openExerciseModal(exerciseId);
}

function showCreateExerciseModal() {
    closeModal('addExerciseModal');
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'createExerciseModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Neue Übung</h2>
                <button class="close-modal" onclick="closeModal('createExerciseModal')">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Übungsname</label>
                    <input type="text" id="newExerciseName" placeholder="z.B. Bankdrücken" autofocus>
                </div>
                <button class="primary-btn full-width" onclick="createExercise()">
                    Übung erstellen
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('newExerciseName').focus();
}

async function createExercise() {
    const name = document.getElementById('newExerciseName').value.trim();
    if (!name) {
        showToast('Bitte Namen eingeben', 'error');
        return;
    }
    
    try {
        const result = await api('exercises', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        
        state.exercises.push(result);
        closeModal('createExerciseModal');
        showToast(`"${name}" erstellt`);
        renderAll();
        
        // Direkt öffnen
        openExerciseModal(result.id);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function createExerciseFromSearch() {
    const name = elements.exerciseSearch.value.trim();
    if (name) {
        document.getElementById('newExerciseName')?.remove();
        showCreateExerciseModal();
        setTimeout(() => {
            const input = document.getElementById('newExerciseName');
            if (input) input.value = name;
        }, 100);
    }
}

// Übung bearbeiten
function showEditExerciseModal(exerciseId) {
    const exercise = state.exercises.find(e => e.id === exerciseId);
    if (!exercise) return;
    
    const currentIcon = exercise.icon || getExerciseIconAuto(exercise.name);
    const currentMuscleGroups = getMuscleGroups(exercise);
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'editExerciseModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Übung bearbeiten</h2>
                <button class="close-modal" onclick="closeModal('editExerciseModal')">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" id="editExerciseName" value="${exercise.name.replace(/"/g, '&quot;')}">
                </div>
                
                <div class="form-group">
                    <label>Symbol</label>
                    <div class="icon-selector">
                        <div class="current-icon" id="currentExerciseIcon">${currentIcon}</div>
                        <div class="icon-grid" id="iconGrid">
                            ${AVAILABLE_ICONS.map(icon => `
                                <button type="button" class="icon-option ${icon === currentIcon ? 'active' : ''}" 
                                        data-icon="${icon}" 
                                        onclick="selectExerciseIcon('${icon}')">
                                    ${icon}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Muskelgruppen</label>
                    <div class="muscle-group-selector" id="muscleGroupSelector">
                        <div class="muscle-group-display" onclick="toggleMuscleGroupDropdown()">
                            <div class="muscle-group-tags" id="muscleGroupTags">
                                ${currentMuscleGroups.map(g => `<span class="muscle-tag">${g}</span>`).join('')}
                            </div>
                            <span class="dropdown-arrow">▼</span>
                        </div>
                        <div class="muscle-group-dropdown" id="muscleGroupDropdown">
                            ${MUSCLE_GROUPS.map(group => `
                                <label class="muscle-group-option">
                                    <input type="checkbox" value="${group}" 
                                           ${currentMuscleGroups.includes(group) ? 'checked' : ''}
                                           onchange="updateMuscleGroupTags()">
                                    <span>${group}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button class="primary-btn full-width" onclick="saveExerciseEdit(${exerciseId})">
                        Speichern
                    </button>
                    <button class="primary-btn full-width" style="background: var(--bg-input);" onclick="openExerciseModal(${exerciseId}); closeModal('editExerciseModal');">
                        Sätze
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('editExerciseName').focus();
    
    // Click outside dropdown schließt es
    document.addEventListener('click', closeMuscleGroupDropdownOnClickOutside);
}

function toggleMuscleGroupDropdown() {
    const dropdown = document.getElementById('muscleGroupDropdown');
    dropdown.classList.toggle('open');
}

function closeMuscleGroupDropdownOnClickOutside(e) {
    const selector = document.getElementById('muscleGroupSelector');
    const dropdown = document.getElementById('muscleGroupDropdown');
    if (selector && dropdown && !selector.contains(e.target)) {
        dropdown.classList.remove('open');
    }
}

function updateMuscleGroupTags() {
    const checkboxes = document.querySelectorAll('#muscleGroupDropdown input[type="checkbox"]:checked');
    const selected = Array.from(checkboxes).map(cb => cb.value);
    
    const tagsContainer = document.getElementById('muscleGroupTags');
    if (selected.length === 0) {
        tagsContainer.innerHTML = '<span class="muscle-tag empty">Keine ausgewählt</span>';
    } else {
        tagsContainer.innerHTML = selected.map(g => `<span class="muscle-tag">${g}</span>`).join('');
    }
}

function getSelectedMuscleGroups() {
    const checkboxes = document.querySelectorAll('#muscleGroupDropdown input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

function selectExerciseIcon(icon) {
    // Aktuelles Icon anzeigen
    document.getElementById('currentExerciseIcon').textContent = icon;
    
    // Aktiven Button aktualisieren
    document.querySelectorAll('#iconGrid .icon-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.icon === icon);
    });
}

async function saveExerciseEdit(exerciseId) {
    const name = document.getElementById('editExerciseName').value.trim();
    const icon = document.getElementById('currentExerciseIcon').textContent;
    const muscleGroups = getSelectedMuscleGroups();
    
    if (!name) {
        showToast('Name darf nicht leer sein', 'error');
        return;
    }
    
    // Event Listener aufräumen
    document.removeEventListener('click', closeMuscleGroupDropdownOnClickOutside);
    
    try {
        const updated = await api(`exercises/${exerciseId}`, {
            method: 'PUT',
            body: JSON.stringify({ 
                name, 
                icon,
                muscle_groups: muscleGroups.join(',')
            })
        });
        
        // Lokalen State aktualisieren
        const exercise = state.exercises.find(e => e.id === exerciseId);
        if (exercise) {
            exercise.name = updated.name;
            exercise.icon = updated.icon;
            exercise.muscle_groups = updated.muscle_groups;
        }
        
        closeModal('editExerciseModal');
        showToast('Übung aktualisiert');
        renderExercisesView();
        renderWorkoutView();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Datumswähler mit Liste der letzten Workouts
function showDatePicker() {
    // Sammle alle Workout-Daten aus den Sets
    const workoutDates = [...new Set(state.sets.map(s => s.workout_date))].sort().reverse();
    const recentWorkouts = workoutDates.slice(0, 10); // Letzte 10 Workouts
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'datePickerModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Workout wählen</h2>
                <button class="close-modal" onclick="closeModal('datePickerModal')">×</button>
            </div>
            <div class="modal-body">
                <!-- Schnellauswahl -->
                <div class="quick-dates">
                    <button class="quick-date-btn ${state.currentDate === getTodayDate() ? 'active' : ''}" 
                            onclick="quickSelectDate('${getTodayDate()}')">
                        Heute
                    </button>
                </div>
                
                <!-- Letzte Workouts -->
                ${recentWorkouts.length > 0 ? `
                    <div class="recent-workouts">
                        <label>Letzte Workouts:</label>
                        <div class="workout-list">
                            ${recentWorkouts.map(date => {
                                const setsCount = state.sets.filter(s => s.workout_date === date).length;
                                const isActive = date === state.currentDate;
                                return `
                                    <button class="workout-date-btn ${isActive ? 'active' : ''}" 
                                            onclick="quickSelectDate('${date}')">
                                        <span class="date">${formatDateFull(date)}</span>
                                        <span class="sets-count">${setsCount} Sätze</span>
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    </div>
                ` : ''}
                
                <!-- Kalender für neues Datum -->
                <div class="custom-date">
                    <label>Anderes Datum:</label>
                    <div class="date-input-row">
                        <input type="date" id="selectDate" value="${state.currentDate}">
                        <button class="primary-btn" onclick="selectDate()">OK</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function quickSelectDate(date) {
    state.currentDate = date;
    closeModal('datePickerModal');
    renderAll();
}

async function selectDate() {
    const date = document.getElementById('selectDate').value;
    state.currentDate = date;
    closeModal('datePickerModal');
    renderAll();
}

// Alte Funktionen als Aliases für Kompatibilität
function showNewWorkoutModal() {
    showDatePicker();
}

function showChangeDateModal() {
    showDatePicker();
}

function changeDate() {
    selectDate();
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.remove();
}

// ============================================
// Set CRUD Functions
// ============================================
async function addSet() {
    if (!state.currentExercise) return;
    
    const weight = parseFloat(document.getElementById('newWeight').value) || 0;
    const reps = parseInt(document.getElementById('newReps').value) || 0;
    const difficulty = document.querySelector('.diff-btn.active')?.dataset.value || 'Mittel';
    const setNumber = parseInt(elements.exerciseModal.dataset.nextSet) || 1;
    
    try {
        const result = await api('sets', {
            method: 'POST',
            body: JSON.stringify({
                workoutDate: state.currentDate,
                exerciseId: state.currentExercise.id,
                setNumber,
                weight,
                reps,
                difficulty
            })
        });
        
        // Lokalen State aktualisieren
        state.sets.push({
            id: result.id,
            workout_id: result.workout_id,
            workout_date: state.currentDate,
            exercise_id: state.currentExercise.id,
            exercise_name: state.currentExercise.name,
            set_number: setNumber,
            weight,
            reps,
            difficulty,
            superset_id: result.superset_id || null,
            created_at: result.created_at || new Date().toISOString()
        });
        
        showToast(`Satz ${setNumber} gespeichert`);
        
        // Modal neu rendern
        openExerciseModal(state.currentExercise.id);
        
        // Timer starten
        startRestTimer();
        
        // Liste aktualisieren
        renderWorkoutView();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function editSet(setId) {
    const set = state.sets.find(s => s.id === setId);
    if (!set) return;
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'editSetModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Satz ${set.set_number} bearbeiten</h2>
                <button class="close-modal" onclick="closeModal('editSetModal')">×</button>
            </div>
            <div class="modal-body">
                <div class="set-inputs">
                    <div class="input-group">
                        <label>Gewicht (kg)</label>
                        <div class="number-input">
                            <button class="decrement" onclick="adjustInput('editWeight', -1)">-</button>
                            <input type="number" id="editWeight" step="1" min="0" value="${set.weight}">
                            <button class="increment" onclick="adjustInput('editWeight', 1)">+</button>
                        </div>
                    </div>
                    <div class="input-group">
                        <label>Wiederholungen</label>
                        <div class="number-input">
                            <button class="decrement" onclick="adjustInput('editReps', -1)">-</button>
                            <input type="number" id="editReps" min="0" value="${set.reps}">
                            <button class="increment" onclick="adjustInput('editReps', 1)">+</button>
                        </div>
                    </div>
                </div>
                <div class="difficulty-selector">
                    <label>Anstrengung:</label>
                    <div class="difficulty-options" id="editDiffOptions">
                        <button class="diff-btn ${set.difficulty === 'Leicht' ? 'active' : ''}" data-value="Leicht">🟢</button>
                        <button class="diff-btn ${set.difficulty === 'Mittel' ? 'active' : ''}" data-value="Mittel">🟡</button>
                        <button class="diff-btn ${set.difficulty === 'Schwer' ? 'active' : ''}" data-value="Schwer">🟠</button>
                        <button class="diff-btn ${set.difficulty === 'Sehr schwer' ? 'active' : ''}" data-value="Sehr schwer">🔴</button>
                    </div>
                </div>
                <button class="primary-btn full-width" onclick="saveSetEdit(${setId})">
                    Speichern
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Difficulty buttons
    document.querySelectorAll('#editDiffOptions .diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#editDiffOptions .diff-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

async function saveSetEdit(setId) {
    const weight = parseFloat(document.getElementById('editWeight').value) || 0;
    const reps = parseInt(document.getElementById('editReps').value) || 0;
    const difficulty = document.querySelector('#editDiffOptions .diff-btn.active')?.dataset.value || 'Mittel';
    
    try {
        await api(`sets/${setId}`, {
            method: 'PUT',
            body: JSON.stringify({ weight, reps, difficulty })
        });
        
        // Lokalen State aktualisieren
        const set = state.sets.find(s => s.id === setId);
        if (set) {
            set.weight = weight;
            set.reps = reps;
            set.difficulty = difficulty;
        }
        
        closeModal('editSetModal');
        showToast('Satz aktualisiert');
        
        // Views aktualisieren
        if (state.currentExercise) {
            openExerciseModal(state.currentExercise.id);
        }
        renderWorkoutView();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteSet(setId) {
    if (!confirm('Satz wirklich löschen?')) return;

    const deletedSet = state.sets.find(s => s.id === setId);

    try {
        await api(`sets/${setId}`, { method: 'DELETE' });

        // Aus lokalem State entfernen
        state.sets = state.sets.filter(s => s.id !== setId);

        // Lokal renumbern, damit UI sofort stimmt
        if (deletedSet) {
            const affected = state.sets
                .filter(s => s.exercise_id === deletedSet.exercise_id && s.workout_id === deletedSet.workout_id)
                .sort((a, b) => a.set_number - b.set_number);

            affected.forEach((set, index) => {
                set.set_number = index + 1;
            });
        }

        showToast('Satz gelöscht');

        // Views aktualisieren
        if (state.currentExercise) {
            openExerciseModal(state.currentExercise.id);
        }
        renderWorkoutView();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function confirmDeleteExercise(exerciseId, exerciseName) {
    const setCount = state.sets.filter(s => s.exercise_id === exerciseId).length;
    const message = setCount > 0 
        ? `"${exerciseName}" löschen?\n\nACHTUNG: ${setCount} Sätze werden ebenfalls gelöscht!`
        : `"${exerciseName}" löschen?`;
    
    if (!confirm(message)) return;
    
    try {
        await api(`exercises/${exerciseId}`, { method: 'DELETE' });
        
        // Aus lokalem State entfernen
        state.exercises = state.exercises.filter(e => e.id !== exerciseId);
        state.sets = state.sets.filter(s => s.exercise_id !== exerciseId);
        
        showToast(`"${exerciseName}" gelöscht`);
        renderExercisesView();
        renderWorkoutView();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================
// Input Helpers
// ============================================
function adjustInput(inputId, delta) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    const current = parseFloat(input.value) || 0;
    const step = parseFloat(input.step) || 1;
    const min = parseFloat(input.min) || 0;
    
    const newValue = Math.max(min, current + delta);
    input.value = newValue;
}

// ============================================
// Navigation
// ============================================
function switchView(viewName) {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === viewName);
    });
    
    document.querySelectorAll('.view').forEach(view => {
        view.classList.toggle('active', view.id === `${viewName}View`);
    });
    
    // Load stats when switching to stats view
    if (viewName === 'stats') {
        loadStats();
    }
    
    // Load coach data when switching to coach view
    if (viewName === 'coach') {
        loadCoachData();
    }
}

// ============================================
// Event Listeners
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Initial load
    loadData();
    loadSettings();
    initSettingsListeners();
    
    // Tab navigation
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.view));
    });
    
    // Workout header - date selector
    document.getElementById('dateSelector')?.addEventListener('click', showDatePicker);
    document.getElementById('addExerciseBtn')?.addEventListener('click', showAddExerciseModal);
    
    // Exercise modal
    document.getElementById('addSetBtn')?.addEventListener('click', addSet);
    document.querySelector('#exerciseModal .close-modal')?.addEventListener('click', closeExerciseModal);
    elements.exerciseModal?.addEventListener('click', (e) => {
        if (e.target === elements.exerciseModal) closeExerciseModal();
    });
    
    // Difficulty buttons in exercise modal
    document.querySelectorAll('.difficulty-options .diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.difficulty-options .diff-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
    
    // Number input buttons (1kg / 1 rep steps)
    document.querySelectorAll('.number-input .increment').forEach(btn => {
        btn.addEventListener('click', () => {
            const field = btn.dataset.field;
            const input = document.getElementById(field === 'weight' ? 'newWeight' : 'newReps');
            if (input) input.value = (parseFloat(input.value) || 0) + 1;
        });
    });
    
    document.querySelectorAll('.number-input .decrement').forEach(btn => {
        btn.addEventListener('click', () => {
            const field = btn.dataset.field;
            const input = document.getElementById(field === 'weight' ? 'newWeight' : 'newReps');
            if (input) input.value = Math.max(0, (parseFloat(input.value) || 0) - 1);
        });
    });
    
    // Exercise search
    elements.exerciseSearch?.addEventListener('input', renderExercisesView);
    
    // Exercises view button
    document.getElementById('createExerciseBtn')?.addEventListener('click', showCreateExerciseModal);
    
    // Chart exercise selector
    document.getElementById('chartExerciseSelect')?.addEventListener('change', (e) => {
        loadExerciseChart(e.target.value);
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeExerciseModal();
        closeModal('addExerciseModal');
        closeModal('createExerciseModal');
        closeModal('newWorkoutModal');
        closeModal('changeDateModal');
        closeModal('editSetModal');
        closeModal('datePickerModal');
        closeModal('conversationHistoryModal');
    }
});

// ============================================
// Coach Functions
// ============================================

async function loadCoachData() {
    try {
        const [goalsRes, conversationsRes] = await Promise.all([
            api('coach/goals'),
            api('coach/conversations')
        ]);
        
        state.coach.goals = goalsRes.goals;
        state.coach.conversations = conversationsRes.conversations || [];
        
        // Update goals form
        if (state.coach.goals) {
            document.getElementById('userGoals').value = state.coach.goals.goals || '';
            document.getElementById('experienceLevel').value = state.coach.goals.experience_level || '';
            document.getElementById('trainingFrequency').value = state.coach.goals.training_frequency || '';
        }
        
        // Enable chat input
        setupChatInput();
    } catch (error) {
        console.error('Error loading coach data:', error);
    }
}

function setupChatInput() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendChatBtn');
    
    if (input && sendBtn) {
        input.addEventListener('input', () => {
            sendBtn.disabled = !input.value.trim();
            // Auto-resize textarea
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });
    }
}

function toggleGoalsSection() {
    const content = document.getElementById('goalsContent');
    const toggle = document.querySelector('.goals-toggle');
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        toggle.classList.add('open');
    } else {
        content.style.display = 'none';
        toggle.classList.remove('open');
    }
}

async function saveGoals() {
    const goals = document.getElementById('userGoals').value;
    const experienceLevel = document.getElementById('experienceLevel').value;
    const trainingFrequency = document.getElementById('trainingFrequency').value;
    
    try {
        const result = await api('coach/goals', {
            method: 'POST',
            body: JSON.stringify({
                goals,
                experience_level: experienceLevel,
                training_frequency: trainingFrequency
            })
        });
        
        state.coach.goals = result.goals;
        
        // Close goals section
        toggleGoalsSection();
        
        // Show success feedback
        showToast('Ziele gespeichert!');
    } catch (error) {
        showError('Fehler beim Speichern: ' + error.message);
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--success);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        z-index: 10000;
        animation: fadeInOut 2s ease-in-out;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

function handleChatKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message || state.coach.isLoading) return;
    
    // Clear input
    input.value = '';
    input.style.height = 'auto';
    document.getElementById('sendChatBtn').disabled = true;
    
    // Add user message to UI
    addMessageToUI('user', message);
    
    // Hide welcome screen
    const welcome = document.querySelector('.chat-welcome');
    if (welcome) welcome.style.display = 'none';
    
    // Show typing indicator
    const typingIndicator = addTypingIndicator();
    
    state.coach.isLoading = true;
    
    try {
        const result = await api('coach/chat', {
            method: 'POST',
            body: JSON.stringify({
                conversation_id: state.coach.currentConversationId,
                message: message
            })
        });
        
        // Remove typing indicator
        typingIndicator.remove();
        
        // Update conversation ID if new
        if (!state.coach.currentConversationId) {
            state.coach.currentConversationId = result.conversation_id;
            document.getElementById('chatTitle').textContent = '💬 Chat';
        }
        
        // Add assistant response
        addMessageToUI('assistant', result.response);
        
        // Reload data if coach made changes (e.g., created/renamed exercises)
        if (result.dataChanged) {
            console.log('Coach made data changes, reloading...');
            await loadData();
        }
        
    } catch (error) {
        typingIndicator.remove();
        addMessageToUI('assistant', '❌ Fehler: ' + error.message);
    } finally {
        state.coach.isLoading = false;
    }
}

function sendQuickPrompt(prompt) {
    document.getElementById('chatInput').value = prompt;
    document.getElementById('sendChatBtn').disabled = false;
    sendChatMessage();
}

function addMessageToUI(role, content) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${role}`;
    
    // Simple markdown-like formatting
    let formattedContent = content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
    
    messageEl.innerHTML = formattedContent;
    messagesContainer.appendChild(messageEl);
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addTypingIndicator() {
    const messagesContainer = document.getElementById('chatMessages');
    const indicator = document.createElement('div');
    indicator.className = 'chat-message assistant typing';
    indicator.innerHTML = '<span></span><span></span><span></span>';
    messagesContainer.appendChild(indicator);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return indicator;
}

function startNewConversation() {
    state.coach.currentConversationId = null;
    state.coach.messages = [];
    
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.innerHTML = `
        <div class="chat-welcome">
            <div class="coach-avatar">🏋️</div>
            <h3>Hallo! Ich bin dein TrainBot.</h3>
            <p>Ich kann dir helfen mit:</p>
            <ul>
                <li>📋 Trainingspläne erstellen</li>
                <li>📊 Fortschritt analysieren</li>
                <li>💡 Trainingsempfehlungen</li>
                <li>❓ Fragen beantworten</li>
            </ul>
            <div class="quick-prompts">
                <button onclick="sendQuickPrompt('Erstelle mir einen Trainingsplan für diese Woche')">📋 Trainingsplan erstellen</button>
                <button onclick="sendQuickPrompt('Analysiere meinen Fortschritt der letzten Wochen')">📊 Fortschritt analysieren</button>
                <button onclick="sendQuickPrompt('Was sollte ich heute trainieren?')">💪 Workout-Empfehlung</button>
            </div>
        </div>
    `;
    
    document.getElementById('chatTitle').textContent = '💬 Neuer Chat';
}

async function showConversationHistory() {
    try {
        const result = await api('coach/conversations');
        state.coach.conversations = result.conversations || [];
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'conversationHistoryModal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 450px;">
                <div class="modal-header">
                    <h2>📋 Chat-Verlauf</h2>
                    <button class="close-modal" onclick="closeModal('conversationHistoryModal')">×</button>
                </div>
                <div class="modal-body">
                    ${state.coach.conversations.length === 0 ? `
                        <p style="color: var(--text-secondary); text-align: center; padding: 20px;">
                            Noch keine Unterhaltungen vorhanden.
                        </p>
                    ` : `
                        <div class="conversation-list">
                            ${state.coach.conversations.map(conv => `
                                <div class="conversation-item ${conv.id === state.coach.currentConversationId ? 'active' : ''}" 
                                     onclick="loadConversation(${conv.id})">
                                    <div class="conversation-info">
                                        <div class="conversation-title">${conv.title || 'Unterhaltung'}</div>
                                        <div class="conversation-preview">${conv.last_message ? conv.last_message.substring(0, 50) + '...' : ''}</div>
                                    </div>
                                    <button class="conversation-delete" onclick="event.stopPropagation(); deleteConversation(${conv.id})">🗑️</button>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
            </div>
        `;
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal('conversationHistoryModal');
        });
        
        document.getElementById('modalContainer').appendChild(modal);
        setTimeout(() => modal.classList.add('active'), 10);
    } catch (error) {
        showError('Fehler beim Laden: ' + error.message);
    }
}

async function loadConversation(conversationId) {
    try {
        const result = await api(`coach/conversations/${conversationId}/messages`);
        
        state.coach.currentConversationId = conversationId;
        state.coach.messages = result.messages || [];
        
        // Find conversation title
        const conv = state.coach.conversations.find(c => c.id === conversationId);
        document.getElementById('chatTitle').textContent = '💬 ' + (conv?.title || 'Chat');
        
        // Render messages
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.innerHTML = '';
        
        for (const msg of state.coach.messages) {
            addMessageToUI(msg.role, msg.content);
        }
        
        closeModal('conversationHistoryModal');
    } catch (error) {
        showError('Fehler beim Laden: ' + error.message);
    }
}

async function deleteConversation(conversationId) {
    if (!confirm('Diese Unterhaltung wirklich löschen?')) return;
    
    try {
        await api(`coach/conversations/${conversationId}`, { method: 'DELETE' });
        
        // If deleting current conversation, start new one
        if (state.coach.currentConversationId === conversationId) {
            startNewConversation();
        }
        
        // Refresh the modal
        closeModal('conversationHistoryModal');
        showConversationHistory();
    } catch (error) {
        showError('Fehler beim Löschen: ' + error.message);
    }
}
