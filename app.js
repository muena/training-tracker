/**
 * Training Tracker - Mobile-First App
 */

// ============================================
// State
// ============================================
const state = {
    currentDate: getTodayDate(),
    exercises: [],           // Alle Übungen aus DB
    sets: [],               // Alle Sätze
    workouts: [],           // Letzte Workouts
    currentExercise: null,  // Aktuell ausgewählte Übung für Modal
    loading: true,
    statsPeriod: '1m',      // Standard: 1 Monat
    statsData: null         // Statistik-Daten vom Server
};

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
        'leicht': '🟢',
        'Mittel': '🟡',
        'mittel': '🟡',
        'Schwer': '🟠',
        'schwer': '🟠',
        'Sehr schwer': '🔴',
        'sehr schwer': '🔴'
    };
    return map[difficulty] || '🟡';
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
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'API Error');
    }
    
    return response.json();
}

async function loadData() {
    try {
        showLoading(true);
        
        // Parallel laden
        const [exercisesRes, setsRes, workoutsRes] = await Promise.all([
            api('exercises'),
            api('sets'),
            api('workouts?limit=10')
        ]);
        
        state.exercises = exercisesRes.exercises || [];
        state.sets = setsRes.sets || [];
        state.workouts = workoutsRes.workouts || [];
        
        renderAll();
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
                            <span class="set-pill">
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
    const kpiHtml = `
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-value">${totals?.total_workouts || 0}</div>
                <div class="stat-label">Workouts</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${Math.round((totals?.total_volume || 0) / 1000)}t</div>
                <div class="stat-label">Volumen</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${totals?.total_sets || 0}</div>
                <div class="stat-label">Sätze</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${totals?.active_exercises || 0}</div>
                <div class="stat-label">Übungen</div>
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

function getMuscleGroup(exerciseName) {
    const name = exerciseName.toLowerCase();
    if (name.includes('bank') || name.includes('brust') || name.includes('flieg') || name.includes('butterfly') || name.includes('dip')) return 'Brust';
    if (name.includes('rücken') || name.includes('lat') || name.includes('ruder') || name.includes('pull') || name.includes('deadlift')) return 'Rücken';
    if (name.includes('schulter') || name.includes('shoulder') || name.includes('seitheben') || name.includes('front') || name.includes('press')) return 'Schultern';
    if (name.includes('bizeps') || name.includes('curl')) return 'Bizeps';
    if (name.includes('trizeps') || name.includes('tricep') || name.includes('drücken')) return 'Trizeps'; // Kabeldrücken etc.
    if (name.includes('bein') || name.includes('squat') || name.includes('lunge') || name.includes('wade') || name.includes('streck') || name.includes('beug')) return 'Beine';
    if (name.includes('bauch') || name.includes('crunch') || name.includes('plank')) return 'Bauch';
    return 'Sonstige';
}

function renderSplitChart(exercises) {
    const ctx = document.getElementById('splitChart');
    if (!ctx) return;

    if (splitChart) splitChart.destroy();

    // Aggregieren nach Muskelgruppe
    const groups = {};
    exercises.forEach(e => {
        const group = getMuscleGroup(e.name);
        if (!groups[group]) groups[group] = 0;
        groups[group] += e.volume;
    });

    const labels = Object.keys(groups);
    const data = Object.values(groups);
    
    // Farben für Gruppen
    const colors = [
        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
        '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6'
    ];

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
                    order: 1
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
                            ${workout.sets.map(set => `
                                <div class="last-set-row ${set.set_number === nextSetNumber ? 'highlighted' : ''}">
                                    <span class="set-number">${set.set_number}</span>
                                    <span class="set-metric"><span class="weight">${set.weight}kg</span><span class="reps">×${set.reps}</span></span>
                                    <span class="set-difficulty">${getDifficultyEmoji(set.difficulty)}</span>
                                </div>
                            `).join('')}
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
            ${currentSets.map(set => `
                <div class="set-row" data-set-id="${set.id}">
                    <span class="set-number">${set.set_number}</span>
                    <div class="set-details">
                        <span class="set-weight">${set.weight} kg</span>
                        <span class="set-reps">${set.reps} Wdh.</span>
                    </div>
                    <span class="set-difficulty">${getDifficultyEmoji(set.difficulty)}</span>
                    <div class="set-actions">
                        <button class="set-action-btn" onclick="editSet(${set.id})">✏️</button>
                        <button class="set-action-btn delete" onclick="deleteSet(${set.id})">🗑️</button>
                    </div>
                </div>
            `).join('')}
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
    
    if (!name) {
        showToast('Name darf nicht leer sein', 'error');
        return;
    }
    
    try {
        const updated = await api(`exercises/${exerciseId}`, {
            method: 'PUT',
            body: JSON.stringify({ name, icon })
        });
        
        // Lokalen State aktualisieren
        const exercise = state.exercises.find(e => e.id === exerciseId);
        if (exercise) {
            exercise.name = updated.name;
            exercise.icon = updated.icon;
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
            created_at: result.created_at || new Date().toISOString()
        });
        
        showToast(`Satz ${setNumber} gespeichert`);
        
        // Modal neu rendern
        openExerciseModal(state.currentExercise.id);
        
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
}

// ============================================
// Event Listeners
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Initial load
    loadData();
    
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
    }
});
