/* ============================================================
   PIANO PALS — App Logic
   A kids' piano learning app with MIDI, Web Audio, and lessons.
   ============================================================ */

// ────────────────────────────────────────────────────────────
// 1. STATE MANAGEMENT
// ────────────────────────────────────────────────────────────

const AppState = {
  currentProfile: null, // 'little-star' or 'rock-star'
  profiles: {
    'little-star': {
      mode: 'toddler',
      difficulty: 'easy',   // 'easy', 'medium', 'hard'
      completedSongs: {},    // { songId: { stars: 3, bestScore: 95 } }
      unlockedSongs: ['twinkle', 'mary', 'hotcross', 'ode', 'jingle']
    },
    'rock-star': {
      mode: 'older',
      difficulty: 'medium',
      completedSongs: {},
      unlockedSongs: ['twinkle', 'mary', 'hotcross', 'ode', 'jingle']
    }
  },
  midiAccess: null,
  midiConnected: false,
  midiInputs: [],
  selectedMidiId: null,
  volume: 0.7,
  // Lesson state
  currentSong: null,
  currentNoteIndex: 0,
  score: 0,
  streak: 0,
  totalNotes: 0,
  correctNotes: 0,
  lessonActive: false,
  noteTrackAnimFrame: null,
  // Active keys tracking
  activeKeys: new Set(),
  // Audio
  audioCtx: null,
  // Microphone listening
  micActive: false,
  micStream: null,
  micAnalyser: null,
  micBuffer: null,
  micAnimFrame: null,
  micLastNote: -1,
  micNoteOffTimer: null,
  micSilenceCount: 0,
  // Input mode: 'mic' or 'midi'
  inputMode: 'mic',
  // Mute the app's own sounds when using mic (avoids feedback loop)
  muteSynth: false
};

// ────────────────────────────────────────────────────────────
// 2. SONG DATA
// ────────────────────────────────────────────────────────────

const SONGS = [
  {
    id: 'twinkle',
    name: 'Twinkle Twinkle Little Star',
    icon: '⭐',
    difficulty: 1,
    color: '#FFDC00',
    notes: [60,60,67,67,69,69,67, 65,65,64,64,62,62,60]
  },
  {
    id: 'mary',
    name: 'Mary Had a Little Lamb',
    icon: '🐑',
    difficulty: 1,
    color: '#2ECC40',
    notes: [64,62,60,62,64,64,64, 62,62,62, 64,67,67]
  },
  {
    id: 'hotcross',
    name: 'Hot Cross Buns',
    icon: '🍞',
    difficulty: 1,
    color: '#FF851B',
    notes: [64,62,60, 64,62,60, 60,60,62,62,64,62,60]
  },
  {
    id: 'ode',
    name: 'Ode to Joy',
    icon: '🎵',
    difficulty: 2,
    color: '#0074D9',
    notes: [64,64,65,67,67,65,64,62,60,60,62,64,64,62,62]
  },
  {
    id: 'jingle',
    name: 'Jingle Bells (Chorus)',
    icon: '🔔',
    difficulty: 2,
    color: '#FF4136',
    notes: [64,64,64, 64,64,64, 64,67,60,62,64]
  }
];

// ────────────────────────────────────────────────────────────
// 3. NOTE COLORS & NAMES
// ────────────────────────────────────────────────────────────

const NOTE_COLORS = {
  0: '#FF4136',  // C - Red
  1: '#FF6B35',  // C#
  2: '#FF851B',  // D - Orange
  3: '#FFAA00',  // D#
  4: '#FFDC00',  // E - Yellow
  5: '#2ECC40',  // F - Green
  6: '#00B894',  // F#
  7: '#0074D9',  // G - Blue
  8: '#5B5EA6',  // G#
  9: '#6C5CE7',  // A - Indigo
  10:'#9B59B6',  // A#
  11:'#B10DC9'   // B - Violet
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const TODDLER_EMOJIS = ['⭐','🌟','🐱','🐶','🦋','🌈','🎈','🐸','🐥','🌺','🍎','🎪'];
const TODDLER_MESSAGES = [
  'Great job! 🎉', 'You\'re amazing! ⭐', 'Keep going! 🌟',
  'Wonderful! 🌈', 'So cool! 🎈', 'Hooray! 🎪', 'Awesome! 🌟',
  'Yay! 🎵', 'Fantastic! 💫', 'Bravo! 👏'
];

const RAINBOW_COLORS = [
  '#FF4136','#FF851B','#FFDC00','#2ECC40','#0074D9','#6C5CE7','#B10DC9',
  '#FF6B6B','#FFA94D','#FFE066','#69DB7C','#4DABF7','#9775FA','#E599F7'
];

// ────────────────────────────────────────────────────────────
// 4A. MICROPHONE PITCH DETECTION
// Uses the Web Audio API to listen through the iPad/laptop mic,
// detect which piano note is being played, and trigger it in the app.
// This means NO cables needed — just prop the iPad near the keyboard.
// ────────────────────────────────────────────────────────────

/**
 * Start listening through the device microphone.
 * Asks the user for permission, then continuously analyzes the audio
 * to figure out which note is being played on the real piano.
 */
function startMicrophone() {
  if (AppState.micActive) return; // Already listening

  // Show a "requesting permission" state
  updateInputStatus('asking', 'Asking for mic access...');

  navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
    AppState.micStream = stream;
    AppState.micActive = true;
    AppState.muteSynth = true; // Don't play app sounds — the real piano is making sound

    var audioCtx = getAudioContext();
    var source = audioCtx.createMediaStreamSource(stream);

    // Create an analyser to read the sound wave
    var analyser = audioCtx.createAnalyser();
    analyser.fftSize = 4096; // Bigger = more accurate pitch, slightly more delay
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);

    AppState.micAnalyser = analyser;
    AppState.micBuffer = new Float32Array(analyser.fftSize);

    updateInputStatus('connected', '🎤 Microphone On — Play your keyboard!');
    updateMicButtonState(true);

    // Start the pitch detection loop
    micDetectionLoop();

  }).catch(function(err) {
    console.error('Microphone error:', err);
    var msg = 'Mic access denied';
    if (err.name === 'NotAllowedError') {
      msg = 'Mic blocked — tap the lock icon in Safari to allow';
    } else if (err.name === 'NotFoundError') {
      msg = 'No microphone found';
    }
    updateInputStatus('disconnected', msg);
  });
}

/**
 * Stop listening through the microphone.
 */
function stopMicrophone() {
  if (AppState.micAnimFrame) {
    cancelAnimationFrame(AppState.micAnimFrame);
    AppState.micAnimFrame = null;
  }
  if (AppState.micStream) {
    AppState.micStream.getTracks().forEach(function(t) { t.stop(); });
    AppState.micStream = null;
  }
  AppState.micActive = false;
  AppState.muteSynth = false;
  AppState.micLastNote = -1;
  AppState.micAnalyser = null;
  updateInputStatus('disconnected', 'Microphone off');
  updateMicButtonState(false);

  // Release any stuck notes
  AppState.activeKeys.forEach(function(n) { noteOff(n); });
}

/**
 * The main detection loop — runs ~60 times per second.
 * Reads the microphone audio, finds the pitch, converts to a note.
 */
function micDetectionLoop() {
  if (!AppState.micActive || !AppState.micAnalyser) return;

  AppState.micAnalyser.getFloatTimeDomainData(AppState.micBuffer);

  // Check if there's enough sound (not silence)
  var rms = 0;
  for (var i = 0; i < AppState.micBuffer.length; i++) {
    rms += AppState.micBuffer[i] * AppState.micBuffer[i];
  }
  rms = Math.sqrt(rms / AppState.micBuffer.length);

  // Silence threshold — if the room is quiet, don't detect anything
  if (rms < 0.015) {
    AppState.micSilenceCount++;
    // After ~10 frames of silence (~170ms), release the note
    if (AppState.micSilenceCount > 10 && AppState.micLastNote !== -1) {
      noteOff(AppState.micLastNote);
      AppState.micLastNote = -1;
    }
    AppState.micAnimFrame = requestAnimationFrame(micDetectionLoop);
    return;
  }

  AppState.micSilenceCount = 0;

  // Detect the pitch using autocorrelation
  var frequency = detectPitch(AppState.micBuffer, getAudioContext().sampleRate);

  if (frequency > 0) {
    // Convert frequency to the nearest MIDI note number
    // Formula: MIDI = 69 + 12 * log2(freq / 440)
    var midiNote = Math.round(69 + 12 * Math.log2(frequency / 440));

    // Only accept notes in a reasonable piano range (A0=21 to C8=108)
    if (midiNote >= 36 && midiNote <= 96) {
      if (midiNote !== AppState.micLastNote) {
        // New note detected — release the old one, trigger the new one
        if (AppState.micLastNote !== -1) {
          noteOff(AppState.micLastNote);
        }
        AppState.micLastNote = midiNote;
        noteOn(midiNote, 100);

        // Auto-release after a short time (notes ring out)
        clearTimeout(AppState.micNoteOffTimer);
        AppState.micNoteOffTimer = setTimeout(function() {
          if (AppState.micLastNote === midiNote) {
            // Will be released by silence detection or next note
          }
        }, 600);
      }
    }
  }

  AppState.micAnimFrame = requestAnimationFrame(micDetectionLoop);
}

/**
 * Autocorrelation pitch detection algorithm.
 * This is the gold standard for detecting musical pitch from audio.
 * It works by looking for repeating patterns in the sound wave —
 * the distance between repetitions tells us the frequency.
 */
function detectPitch(buffer, sampleRate) {
  var SIZE = buffer.length;

  // Find the first point where the wave crosses zero (going positive)
  // This helps us ignore the initial attack noise
  var start = 0;
  for (var i = 0; i < SIZE / 2; i++) {
    if (buffer[i] < 0 && buffer[i + 1] >= 0) {
      start = i;
      break;
    }
  }

  // Autocorrelation: compare the wave with shifted copies of itself
  // The shift that produces the best match = the period of the note
  var bestCorrelation = 0;
  var bestLag = -1;

  // Search range: 50 Hz (lag ~960) to 2000 Hz (lag ~24) at 48kHz sample rate
  var minLag = Math.floor(sampleRate / 2000); // highest freq we care about
  var maxLag = Math.floor(sampleRate / 50);    // lowest freq we care about
  if (maxLag > SIZE / 2) maxLag = Math.floor(SIZE / 2);

  for (var lag = minLag; lag < maxLag; lag++) {
    var correlation = 0;
    var count = 0;
    for (var j = start; j < SIZE / 2; j++) {
      if (j + lag < SIZE) {
        correlation += buffer[j] * buffer[j + lag];
        count++;
      }
    }
    if (count > 0) correlation /= count;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  // Only accept if the correlation is strong enough (good match)
  if (bestCorrelation > 0.01 && bestLag > 0) {
    // Refine using parabolic interpolation for sub-sample accuracy
    var frequency = sampleRate / bestLag;

    // Sanity check — should be in musical range
    if (frequency >= 50 && frequency <= 2000) {
      return frequency;
    }
  }

  return -1; // No clear pitch detected
}

/**
 * Update the input status display (replaces the old MIDI-only status).
 */
function updateInputStatus(state, text) {
  // Home screen status badge
  var dot = document.getElementById('midi-dot');
  var txt = document.getElementById('midi-text');
  if (dot) {
    dot.className = 'midi-dot ' + (state === 'connected' ? 'connected' : state === 'asking' ? 'asking' : 'disconnected');
  }
  if (txt) txt.textContent = text;

  // Free play / lesson header dot
  var dotFP = document.getElementById('midi-dot-fp');
  if (dotFP) {
    dotFP.className = 'midi-dot-small ' + (state === 'connected' ? 'connected' : 'disconnected');
  }
}

/**
 * Update the mic button appearance on the home screen.
 */
function updateMicButtonState(isActive) {
  var btn = document.getElementById('mic-start-btn');
  if (!btn) return;
  if (isActive) {
    btn.textContent = '🎤 Microphone is ON — Listening!';
    btn.classList.add('mic-active');
    btn.onclick = function() { stopMicrophone(); };
  } else {
    btn.textContent = '🎤 Tap to Turn On Microphone';
    btn.classList.remove('mic-active');
    btn.onclick = function() { startMicrophone(); };
  }
}

// ────────────────────────────────────────────────────────────
// 4B. MIDI HANDLING (still works if they plug in a cable)
// ────────────────────────────────────────────────────────────

function initMIDI() {
  if (!navigator.requestMIDIAccess) {
    // No MIDI support (common on iPad) — that's fine, we have the mic
    return;
  }

  try {
    navigator.requestMIDIAccess().then(
      function onMIDISuccess(midiAccess) {
        AppState.midiAccess = midiAccess;
        connectMIDIInputs(midiAccess);

        // Listen for device changes
        midiAccess.onstatechange = function(e) {
          connectMIDIInputs(midiAccess);
        };
      },
      function onMIDIFailure() {
        updateMIDIStatus(false, 'MIDI access denied');
      }
    ).catch(function() {
      updateMIDIStatus(false, 'MIDI unavailable');
    });
  } catch(e) {
    updateMIDIStatus(false, 'MIDI unavailable');
  }
}

function connectMIDIInputs(midiAccess) {
  const inputs = [];
  for (let input of midiAccess.inputs.values()) {
    inputs.push(input);
    input.onmidimessage = onMIDIMessage;
  }

  AppState.midiInputs = inputs;
  AppState.midiConnected = inputs.length > 0;
  updateMIDIStatus(
    inputs.length > 0,
    inputs.length > 0 ? 'MIDI: ' + inputs[0].name : 'No MIDI device'
  );

  // Update MIDI selector in settings
  updateMIDISelector();
}

function onMIDIMessage(message) {
  const [status, note, velocity] = message.data;
  // Note On
  if (status >= 144 && status <= 159 && velocity > 0) {
    noteOn(note, velocity);
  }
  // Note Off
  if (status >= 128 && status <= 143 || (status >= 144 && status <= 159 && velocity === 0)) {
    noteOff(note);
  }
}

function updateMIDIStatus(connected, text) {
  // Only update the status display if mic is NOT the active input
  // (MIDI auto-detection runs in background; don't overwrite mic status)
  if (AppState.micActive) return;

  if (connected) {
    // MIDI device found — switch to MIDI mode automatically
    AppState.inputMode = 'midi';
    AppState.muteSynth = false;
    updateInputStatus('connected', text);
  } else if (!AppState.micActive) {
    updateInputStatus('disconnected', text);
  }
}

function updateMIDISelector() {
  const select = document.getElementById('midi-select');
  if (!select) return;
  select.innerHTML = '<option value="">No MIDI device</option>';
  AppState.midiInputs.forEach(function(input, i) {
    const opt = document.createElement('option');
    opt.value = input.id;
    opt.textContent = input.name || 'Device ' + (i + 1);
    select.appendChild(opt);
  });
  if (AppState.midiInputs.length > 0) {
    select.value = AppState.midiInputs[0].id;
  }
}

function selectMidiDevice(deviceId) {
  AppState.selectedMidiId = deviceId;
}

// ────────────────────────────────────────────────────────────
// 5. AUDIO SYNTHESIS (Web Audio API)
// ────────────────────────────────────────────────────────────

function getAudioContext() {
  if (!AppState.audioCtx) {
    AppState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (iOS requirement)
  if (AppState.audioCtx.state === 'suspended') {
    AppState.audioCtx.resume();
  }
  return AppState.audioCtx;
}

/**
 * Play a synthesized piano-like note.
 * Uses a mix of triangle + sine oscillators with a piano-like ADSR envelope.
 */
function playNote(midiNote, duration) {
  if (typeof duration === 'undefined') duration = 0.8;
  var audioCtx = getAudioContext();
  var freq = 440 * Math.pow(2, (midiNote - 69) / 12);
  var vol = AppState.volume;

  // Create oscillators for a richer tone
  var osc1 = audioCtx.createOscillator();
  var osc2 = audioCtx.createOscillator();
  var osc3 = audioCtx.createOscillator();
  var gainNode = audioCtx.createGain();

  // Triangle for body
  osc1.type = 'triangle';
  osc1.frequency.value = freq;

  // Sine for fundamental
  osc2.type = 'sine';
  osc2.frequency.value = freq;

  // Sine at 2x frequency for brightness (very soft)
  osc3.type = 'sine';
  osc3.frequency.value = freq * 2;

  // Mixer gains
  var mix1 = audioCtx.createGain();
  var mix2 = audioCtx.createGain();
  var mix3 = audioCtx.createGain();
  mix1.gain.value = 0.35 * vol;
  mix2.gain.value = 0.35 * vol;
  mix3.gain.value = 0.08 * vol;

  osc1.connect(mix1);
  osc2.connect(mix2);
  osc3.connect(mix3);
  mix1.connect(gainNode);
  mix2.connect(gainNode);
  mix3.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  // Piano-like envelope
  var now = audioCtx.currentTime;
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(0.5, now + 0.015);  // fast attack
  gainNode.gain.exponentialRampToValueAtTime(0.2, now + 0.15); // decay
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration); // release

  osc1.start(now);
  osc2.start(now);
  osc3.start(now);
  osc1.stop(now + duration);
  osc2.stop(now + duration);
  osc3.stop(now + duration);
}

// ────────────────────────────────────────────────────────────
// 6. PIANO KEYBOARD RENDERING
// ────────────────────────────────────────────────────────────

// Piano range: C3 (48) to B4 (71) = 2 octaves, 25 keys total
var PIANO_START = 48; // C3
var PIANO_END   = 71; // B4

/**
 * Returns true if the given MIDI note is a black key.
 */
function isBlackKey(midiNote) {
  var n = midiNote % 12;
  return [1, 3, 6, 8, 10].indexOf(n) !== -1;
}

/**
 * Renders a piano keyboard into the given container element.
 * Returns a map of midiNote -> key element.
 */
function renderPiano(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return {};
  container.innerHTML = '';

  var keyboard = document.createElement('div');
  keyboard.className = 'piano-keyboard';
  keyboard.setAttribute('role', 'group');
  keyboard.setAttribute('aria-label', 'Piano keyboard');

  var keyMap = {};

  for (var note = PIANO_START; note <= PIANO_END; note++) {
    if (isBlackKey(note)) continue; // Render white keys first

    var key = createKeyElement(note, false);
    keyboard.appendChild(key);
    keyMap[note] = key;
  }

  // Now insert black keys (absolutely positioned relative to keyboard)
  for (var note = PIANO_START; note <= PIANO_END; note++) {
    if (!isBlackKey(note)) continue;

    var key = createKeyElement(note, true);
    // Find the white key before this black key and insert after it
    var prevWhite = note - 1;
    if (isBlackKey(prevWhite)) prevWhite = note - 2; // Shouldn't happen in standard layout
    if (keyMap[prevWhite]) {
      keyMap[prevWhite].after(key);
    }
    keyMap[note] = key;
  }

  container.appendChild(keyboard);

  // Add touch/mouse event listeners
  setupKeyboardInteraction(keyboard, keyMap);

  return keyMap;
}

function createKeyElement(midiNote, isBlack) {
  var key = document.createElement('button');
  var noteName = NOTE_NAMES[midiNote % 12];
  var octave = Math.floor(midiNote / 12) - 1;

  key.className = isBlack ? 'piano-key piano-key-black' : 'piano-key piano-key-white';
  key.dataset.note = midiNote;
  key.setAttribute('aria-label', noteName + octave);

  // Show label
  var label = document.createElement('span');
  label.className = 'key-label';
  label.textContent = noteName;
  key.appendChild(label);

  return key;
}

/**
 * Sets up mouse & touch interaction on the piano keyboard.
 */
function setupKeyboardInteraction(keyboard, keyMap) {
  var isPointerDown = false;

  // Prevent scrolling on the keyboard
  keyboard.addEventListener('touchstart', function(e) { e.preventDefault(); }, { passive: false });
  keyboard.addEventListener('touchmove', function(e) { e.preventDefault(); }, { passive: false });

  // Mouse events
  keyboard.addEventListener('mousedown', function(e) {
    isPointerDown = true;
    var key = e.target.closest('.piano-key');
    if (key) {
      var n = parseInt(key.dataset.note);
      noteOn(n, 100);
    }
  });

  keyboard.addEventListener('mouseup', function(e) {
    isPointerDown = false;
    var key = e.target.closest('.piano-key');
    if (key) {
      noteOff(parseInt(key.dataset.note));
    }
  });

  keyboard.addEventListener('mouseleave', function() {
    if (isPointerDown) {
      isPointerDown = false;
      // Release all active keys
      AppState.activeKeys.forEach(function(n) { noteOff(n); });
    }
  });

  keyboard.addEventListener('mouseover', function(e) {
    if (isPointerDown) {
      var key = e.target.closest('.piano-key');
      if (key) noteOn(parseInt(key.dataset.note), 100);
    }
  });
  keyboard.addEventListener('mouseout', function(e) {
    if (isPointerDown) {
      var key = e.target.closest('.piano-key');
      if (key) noteOff(parseInt(key.dataset.note));
    }
  });

  // Touch events (multi-touch)
  keyboard.addEventListener('touchstart', function(e) {
    handleTouches(e, keyMap, true);
  }, { passive: false });

  keyboard.addEventListener('touchmove', function(e) {
    handleTouches(e, keyMap, true);
  }, { passive: false });

  keyboard.addEventListener('touchend', function(e) {
    handleTouches(e, keyMap, false);
  }, { passive: false });

  keyboard.addEventListener('touchcancel', function(e) {
    handleTouches(e, keyMap, false);
  }, { passive: false });
}

function handleTouches(e, keyMap, isActive) {
  // Get all currently-touched keys
  var touchedNotes = new Set();

  if (isActive) {
    for (var i = 0; i < e.touches.length; i++) {
      var touch = e.touches[i];
      var el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el) {
        var key = el.closest('.piano-key');
        if (key) touchedNotes.add(parseInt(key.dataset.note));
      }
    }
  }

  // Note on for newly touched
  touchedNotes.forEach(function(n) {
    if (!AppState.activeKeys.has(n)) {
      noteOn(n, 100);
    }
  });

  // Note off for released
  AppState.activeKeys.forEach(function(n) {
    if (!touchedNotes.has(n)) {
      noteOff(n);
    }
  });
}

// ────────────────────────────────────────────────────────────
// 7. NOTE ON / NOTE OFF (Central Handlers)
// ────────────────────────────────────────────────────────────

function noteOn(midiNote, velocity) {
  if (AppState.activeKeys.has(midiNote)) return; // Already active
  AppState.activeKeys.add(midiNote);

  // Play sound (muted when using mic to avoid feedback)
  if (!AppState.muteSynth) {
    playNote(midiNote);
  }

  // Visual feedback on piano keys
  highlightKey(midiNote, true);

  // Mode-specific behaviors
  var currentScreen = getCurrentScreen();

  if (currentScreen === 'screen-free-play') {
    showFreePlayNote(midiNote);
    spawnParticles(midiNote, 'particle-container');
  }

  if (currentScreen === 'screen-lesson-play' && AppState.lessonActive) {
    checkLessonNote(midiNote);
  }
}

function noteOff(midiNote) {
  AppState.activeKeys.delete(midiNote);
  highlightKey(midiNote, false);
}

/**
 * Highlights/unhighlights a key on ALL rendered pianos.
 */
function highlightKey(midiNote, on) {
  var keys = document.querySelectorAll('.piano-key[data-note="' + midiNote + '"]');
  var profile = AppState.profiles[AppState.currentProfile];
  var isToddler = profile && profile.mode === 'toddler';

  keys.forEach(function(key) {
    if (on) {
      key.classList.add('pressed', 'color-pressed');
      var noteIdx = midiNote % 12;
      var color;
      if (isToddler) {
        // Rainbow colors — random bright color each press
        color = RAINBOW_COLORS[Math.floor(Math.random() * RAINBOW_COLORS.length)];
      } else {
        color = NOTE_COLORS[noteIdx];
      }
      if (key.classList.contains('piano-key-white')) {
        key.style.background = color;
        key.style.color = '#fff';
      } else {
        key.style.background = color;
      }
    } else {
      key.classList.remove('pressed', 'color-pressed');
      if (key.classList.contains('piano-key-white')) {
        key.style.background = '';
        key.style.color = '';
      } else {
        key.style.background = '';
      }
    }
  });
}

// ────────────────────────────────────────────────────────────
// 8. FREE PLAY MODE LOGIC
// ────────────────────────────────────────────────────────────

function showFreePlayNote(midiNote) {
  var noteName = NOTE_NAMES[midiNote % 12];
  var octave = Math.floor(midiNote / 12) - 1;
  var noteIdx = midiNote % 12;
  var color = NOTE_COLORS[noteIdx];
  var profile = AppState.profiles[AppState.currentProfile];
  var isToddler = profile && profile.mode === 'toddler';

  var letterEl = document.getElementById('note-letter');
  var emojiEl = document.getElementById('note-emoji');
  var inner = document.getElementById('note-display-inner');

  if (isToddler) {
    // Big note name, random animal/star emoji
    letterEl.textContent = noteName;
    letterEl.style.color = RAINBOW_COLORS[Math.floor(Math.random() * RAINBOW_COLORS.length)];
    letterEl.style.fontSize = 'clamp(3rem, 10vw, 6rem)';
    emojiEl.textContent = TODDLER_EMOJIS[Math.floor(Math.random() * TODDLER_EMOJIS.length)];
    emojiEl.style.fontSize = 'clamp(3rem, 10vw, 5rem)';
  } else {
    letterEl.textContent = noteName + octave;
    letterEl.style.color = color;
    letterEl.style.fontSize = '';
    emojiEl.textContent = '';
  }

  // Trigger pop animation
  inner.classList.remove('pop');
  void inner.offsetWidth; // force reflow
  inner.classList.add('pop');
}

// ────────────────────────────────────────────────────────────
// 9. PARTICLE / SPARKLE EFFECTS
// ────────────────────────────────────────────────────────────

function spawnParticles(midiNote, containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var profile = AppState.profiles[AppState.currentProfile];
  var isToddler = profile && profile.mode === 'toddler';
  var count = isToddler ? 12 : 6;
  var noteIdx = midiNote % 12;

  for (var i = 0; i < count; i++) {
    var p = document.createElement('div');
    p.className = 'particle';
    var size = isToddler ? (8 + Math.random() * 14) : (4 + Math.random() * 10);
    var color;
    if (isToddler) {
      color = RAINBOW_COLORS[Math.floor(Math.random() * RAINBOW_COLORS.length)];
    } else {
      color = NOTE_COLORS[noteIdx];
    }
    var dx = (Math.random() - 0.5) * 200;
    var dy = -(40 + Math.random() * 160);
    var startX = 50 + (midiNote - PIANO_START) / (PIANO_END - PIANO_START) * 50;
    // Clamp startX
    if (startX < 5) startX = 5;
    if (startX > 95) startX = 95;

    p.style.width = size + 'px';
    p.style.height = size + 'px';
    p.style.background = color;
    p.style.left = startX + '%';
    p.style.bottom = '20%';
    p.style.setProperty('--dx', dx + 'px');
    p.style.setProperty('--dy', dy + 'px');

    container.appendChild(p);
    // Clean up after animation
    setTimeout(function(el) { el.remove(); }, 900, p);
  }

  // Toddler: also spawn emoji particles
  if (isToddler) {
    var emoji = document.createElement('div');
    emoji.className = 'emoji-particle';
    emoji.textContent = TODDLER_EMOJIS[Math.floor(Math.random() * TODDLER_EMOJIS.length)];
    emoji.style.left = (40 + Math.random() * 20) + '%';
    emoji.style.bottom = '30%';
    container.appendChild(emoji);
    setTimeout(function() { emoji.remove(); }, 1300);
  }
}

// ────────────────────────────────────────────────────────────
// 10. LESSON MODE LOGIC
// ────────────────────────────────────────────────────────────

var lessonKeyMap = {};

function startLesson(songId) {
  var song = SONGS.find(function(s) { return s.id === songId; });
  if (!song) return;

  AppState.currentSong = song;
  AppState.currentNoteIndex = 0;
  AppState.score = 0;
  AppState.streak = 0;
  AppState.correctNotes = 0;
  AppState.totalNotes = song.notes.length;
  AppState.lessonActive = true;

  navigate('lesson-play');

  // Update title
  document.getElementById('lesson-song-title').textContent = song.name;

  // Render piano
  lessonKeyMap = renderPiano('piano-lesson');

  // Show/hide stats based on mode
  var profile = AppState.profiles[AppState.currentProfile];
  var statsEl = document.getElementById('lesson-stats');
  if (profile && profile.mode === 'toddler') {
    statsEl.style.display = 'none';
  } else {
    statsEl.style.display = 'flex';
    updateLessonStats();
  }

  // Start note track rendering
  renderNoteTrack();
}

function renderNoteTrack() {
  var track = document.getElementById('note-track');
  track.innerHTML = '';
  if (!AppState.currentSong) return;

  var notes = AppState.currentSong.notes;
  var profile = AppState.profiles[AppState.currentProfile];
  var isToddler = profile && profile.mode === 'toddler';

  // Create all note bubbles
  for (var i = 0; i < notes.length; i++) {
    var noteEl = document.createElement('div');
    noteEl.className = 'track-note';
    noteEl.id = 'track-note-' + i;
    var midiNote = notes[i];
    var noteIdx = midiNote % 12;
    var noteName = NOTE_NAMES[noteIdx];

    noteEl.textContent = noteName;
    noteEl.style.background = NOTE_COLORS[noteIdx];

    if (i === AppState.currentNoteIndex) {
      noteEl.classList.add('current');
    }

    track.appendChild(noteEl);
  }

  // Start animation loop
  if (AppState.noteTrackAnimFrame) {
    cancelAnimationFrame(AppState.noteTrackAnimFrame);
  }
  animateNoteTrack();
}

function animateNoteTrack() {
  if (!AppState.lessonActive) return;

  var notes = AppState.currentSong.notes;
  var profile = AppState.profiles[AppState.currentProfile];
  var isToddler = profile && profile.mode === 'toddler';
  var container = document.querySelector('.note-guide-container');
  if (!container) return;
  var containerWidth = container.offsetWidth;

  // Position spacing
  var hitZoneCenter = 100; // center of hit zone in px
  var noteSpacing = isToddler ? 100 : 80;

  for (var i = 0; i < notes.length; i++) {
    var el = document.getElementById('track-note-' + i);
    if (!el) continue;

    var offset = i - AppState.currentNoteIndex;
    var leftPos = hitZoneCenter + offset * noteSpacing;
    el.style.left = leftPos + 'px';

    // Mark current
    if (i === AppState.currentNoteIndex) {
      el.classList.add('current');
    } else {
      el.classList.remove('current');
    }

    // Dim past notes
    if (i < AppState.currentNoteIndex) {
      el.style.opacity = '0.25';
      el.style.transform = 'translateY(-50%) scale(0.7)';
    }
  }

  AppState.noteTrackAnimFrame = requestAnimationFrame(animateNoteTrack);
}

function checkLessonNote(midiNote) {
  if (!AppState.currentSong || !AppState.lessonActive) return;
  if (AppState.currentNoteIndex >= AppState.currentSong.notes.length) return;

  var targetNote = AppState.currentSong.notes[AppState.currentNoteIndex];
  var profile = AppState.profiles[AppState.currentProfile];
  var isToddler = profile && profile.mode === 'toddler';

  var isCorrect = false;

  if (isToddler) {
    // Accept within 2 semitones
    isCorrect = Math.abs(midiNote - targetNote) <= 2;
  } else {
    isCorrect = midiNote === targetNote;
  }

  if (isCorrect) {
    AppState.correctNotes++;
    AppState.streak++;

    // Mark as hit
    var trackNote = document.getElementById('track-note-' + AppState.currentNoteIndex);
    if (trackNote) trackNote.classList.add('hit');

    // Feedback
    if (isToddler) {
      showLessonFeedback(TODDLER_MESSAGES[Math.floor(Math.random() * TODDLER_MESSAGES.length)], '#2ECC40');
      spawnParticles(midiNote, 'lesson-particle-container');
    } else {
      if (AppState.streak >= 5) {
        showLessonFeedback('Perfect! 🔥', '#FF851B');
      } else if (AppState.streak >= 3) {
        showLessonFeedback('Good! 👍', '#2ECC40');
      } else {
        showLessonFeedback('Nice!', '#0074D9');
      }
    }

    AppState.currentNoteIndex++;
    updateLessonStats();

    // Check if song is complete
    if (AppState.currentNoteIndex >= AppState.currentSong.notes.length) {
      completeSong();
    }
  } else {
    // Wrong note
    AppState.streak = 0;
    if (!isToddler) {
      showLessonFeedback('Try again!', '#FF4136');
      updateLessonStats();
    }
  }
}

function updateLessonStats() {
  var pct = AppState.totalNotes > 0 ? Math.round((AppState.correctNotes / AppState.totalNotes) * 100) : 0;
  document.getElementById('stat-score').textContent = 'Score: ' + pct + '%';
  document.getElementById('stat-streak').textContent = '🔥 ' + AppState.streak;
}

function showLessonFeedback(message, color) {
  var fb = document.getElementById('lesson-feedback');
  fb.textContent = message;
  fb.style.color = color;
  fb.classList.remove('show');
  void fb.offsetWidth;
  fb.classList.add('show');
}

function completeSong() {
  AppState.lessonActive = false;
  if (AppState.noteTrackAnimFrame) {
    cancelAnimationFrame(AppState.noteTrackAnimFrame);
  }

  var pct = Math.round((AppState.correctNotes / AppState.totalNotes) * 100);
  var stars = pct >= 90 ? 3 : (pct >= 70 ? 2 : 1);
  var profile = AppState.profiles[AppState.currentProfile];
  var isToddler = profile && profile.mode === 'toddler';

  // Toddlers always get 3 stars
  if (isToddler) {
    stars = 3;
    pct = 100;
  }

  // Save completion
  if (profile) {
    var existing = profile.completedSongs[AppState.currentSong.id];
    if (!existing || stars > existing.stars) {
      profile.completedSongs[AppState.currentSong.id] = { stars: stars, bestScore: pct };
    }
  }

  // Show complete screen after a short delay
  setTimeout(function() {
    showLessonComplete(stars, pct, isToddler);
  }, 600);
}

function showLessonComplete(stars, score, isToddler) {
  navigate('lesson-complete');

  // Stars
  var starsEl = document.getElementById('complete-stars');
  var starStr = '';
  for (var i = 0; i < 3; i++) {
    starStr += i < stars ? '⭐' : '☆';
  }
  starsEl.textContent = starStr;

  // Score
  var scoreEl = document.getElementById('complete-score');
  scoreEl.textContent = isToddler ? '' : 'Score: ' + score + '%';

  // Title
  var titles = isToddler
    ? ['You did it!', 'Amazing!', 'Superstar!', 'Wonderful!', 'Hooray!']
    : ['Great job!', 'Well done!', 'Awesome!', 'Fantastic!', 'Brilliant!'];
  document.getElementById('complete-title').textContent = titles[Math.floor(Math.random() * titles.length)];

  // Encouragement
  var msgs = isToddler
    ? ['You\'re the best pianist ever!', 'Music is so fun with you!', 'You make beautiful music!']
    : ['Keep practicing to get 3 stars!', 'You\'re getting better every time!', 'Music practice makes perfect!'];
  document.getElementById('complete-encouragement').textContent = msgs[Math.floor(Math.random() * msgs.length)];

  // Confetti!
  launchConfetti();
}

function replayLesson() {
  if (AppState.currentSong) {
    startLesson(AppState.currentSong.id);
  }
}

function exitLesson() {
  AppState.lessonActive = false;
  if (AppState.noteTrackAnimFrame) {
    cancelAnimationFrame(AppState.noteTrackAnimFrame);
  }
  navigate('lesson');
}

// ────────────────────────────────────────────────────────────
// 11. CONFETTI ANIMATION
// ────────────────────────────────────────────────────────────

function launchConfetti() {
  var container = document.getElementById('confetti-container');
  container.innerHTML = '';

  var colors = ['#FF4136','#FF851B','#FFDC00','#2ECC40','#0074D9','#6C5CE7','#B10DC9','#FF6B6B','#00B894'];

  for (var i = 0; i < 60; i++) {
    var piece = document.createElement('div');
    piece.className = 'confetti-piece';
    var color = colors[Math.floor(Math.random() * colors.length)];
    var left = Math.random() * 100;
    var duration = 2 + Math.random() * 3;
    var delay = Math.random() * 1.5;
    var rotation = (Math.random() - 0.5) * 720;
    var shape = Math.random() > 0.5 ? '50%' : '2px';

    piece.style.left = left + '%';
    piece.style.background = color;
    piece.style.borderRadius = shape;
    piece.style.width = (8 + Math.random() * 10) + 'px';
    piece.style.height = (8 + Math.random() * 10) + 'px';
    piece.style.setProperty('--duration', duration + 's');
    piece.style.setProperty('--rotation', rotation + 'deg');
    piece.style.animationDuration = duration + 's';
    piece.style.animationDelay = delay + 's';

    container.appendChild(piece);
  }

  // Clean up confetti after animations end
  setTimeout(function() {
    container.innerHTML = '';
  }, 6000);
}

// ────────────────────────────────────────────────────────────
// 12. PARENT SETTINGS LOGIC
// ────────────────────────────────────────────────────────────

function setMode(profileId, mode) {
  AppState.profiles[profileId].mode = mode;

  // Update toggle UI
  var group = document.getElementById('mode-toggle-' + profileId);
  if (group) {
    group.querySelectorAll('.toggle-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.value === mode);
    });
  }
}

function setDifficulty(profileId, value) {
  var levels = ['easy', 'medium', 'hard'];
  AppState.profiles[profileId].difficulty = levels[value];
}

function setVolume(value) {
  AppState.volume = value / 100;
}

function setInputMode(mode) {
  AppState.inputMode = mode;

  // Update toggle UI
  var group = document.getElementById('input-mode-toggle');
  if (group) {
    group.querySelectorAll('.toggle-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.value === mode);
    });
  }

  // Update hint text
  var hint = document.getElementById('input-mode-hint');
  if (hint) {
    if (mode === 'mic') {
      hint.textContent = 'Microphone: just place the iPad near your keyboard. No cables needed.';
    } else {
      hint.textContent = 'USB/MIDI: connect your keyboard with a cable and adapter.';
    }
  }

  // Switch modes
  if (mode === 'mic') {
    startMicrophone();
  } else {
    stopMicrophone();
    initMIDI();
  }
}

function resetProgress(profileId) {
  // Don't use confirm() — blocked in sandboxed iframes
  AppState.profiles[profileId].completedSongs = {};
  // Show feedback
  var btn = event.target;
  var origText = btn.textContent;
  btn.textContent = 'Progress Reset! ✓';
  btn.style.background = '#2ECC40';
  btn.style.color = '#fff';
  btn.style.borderColor = '#2ECC40';
  setTimeout(function() {
    btn.textContent = origText;
    btn.style.background = '';
    btn.style.color = '';
    btn.style.borderColor = '';
  }, 2000);
}

function renderSettingsSongCheckboxes() {
  ['little-star', 'rock-star'].forEach(function(profileId) {
    var container = document.getElementById('songs-' + profileId);
    if (!container) return;
    container.innerHTML = '';

    SONGS.forEach(function(song) {
      var row = document.createElement('div');
      row.className = 'song-checkbox-row';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'cb-' + profileId + '-' + song.id;
      cb.checked = AppState.profiles[profileId].unlockedSongs.indexOf(song.id) !== -1;
      cb.addEventListener('change', function() {
        var list = AppState.profiles[profileId].unlockedSongs;
        if (this.checked) {
          if (list.indexOf(song.id) === -1) list.push(song.id);
        } else {
          var idx = list.indexOf(song.id);
          if (idx !== -1) list.splice(idx, 1);
        }
      });

      var label = document.createElement('label');
      label.htmlFor = cb.id;
      label.textContent = song.icon + ' ' + song.name;

      row.appendChild(cb);
      row.appendChild(label);
      container.appendChild(row);
    });
  });
}

function syncSettingsUI() {
  ['little-star', 'rock-star'].forEach(function(profileId) {
    var prof = AppState.profiles[profileId];

    // Mode toggle
    var group = document.getElementById('mode-toggle-' + profileId);
    if (group) {
      group.querySelectorAll('.toggle-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.value === prof.mode);
      });
    }

    // Difficulty slider
    var diffSlider = document.getElementById('diff-' + profileId);
    if (diffSlider) {
      var diffVal = { easy: 0, medium: 1, hard: 2 };
      diffSlider.value = diffVal[prof.difficulty] || 0;
    }
  });

  // Volume
  var volSlider = document.getElementById('volume-slider');
  if (volSlider) volSlider.value = Math.round(AppState.volume * 100);

  // Input mode toggle
  var inputGroup = document.getElementById('input-mode-toggle');
  if (inputGroup) {
    inputGroup.querySelectorAll('.toggle-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.value === AppState.inputMode);
    });
  }
}

// ────────────────────────────────────────────────────────────
// 13. SONG LIST RENDERING
// ────────────────────────────────────────────────────────────

function renderSongList() {
  var container = document.getElementById('song-list');
  if (!container) return;
  container.innerHTML = '';

  var profile = AppState.profiles[AppState.currentProfile];
  if (!profile) return;

  SONGS.forEach(function(song) {
    var card = document.createElement('button');
    card.className = 'song-card';

    var isUnlocked = profile.unlockedSongs.indexOf(song.id) !== -1;
    if (!isUnlocked) card.classList.add('locked');

    card.style.borderLeft = '6px solid ' + song.color;

    card.onclick = function() {
      if (isUnlocked) startLesson(song.id);
    };

    // Icon
    var iconEl = document.createElement('span');
    iconEl.className = 'song-card-icon';
    iconEl.textContent = song.icon;

    // Info
    var info = document.createElement('div');
    info.className = 'song-card-info';

    var nameEl = document.createElement('div');
    nameEl.className = 'song-card-name';
    nameEl.textContent = song.name;

    var diffEl = document.createElement('div');
    diffEl.className = 'song-card-diff';
    var stars = '';
    for (var i = 0; i < 3; i++) stars += i < song.difficulty ? '★' : '☆';
    diffEl.textContent = stars + (isUnlocked ? '' : ' 🔒');

    info.appendChild(nameEl);
    info.appendChild(diffEl);

    card.appendChild(iconEl);
    card.appendChild(info);

    // Completion check
    var completed = profile.completedSongs[song.id];
    if (completed) {
      var check = document.createElement('span');
      check.className = 'song-card-check';
      var completedStars = '';
      for (var j = 0; j < 3; j++) completedStars += j < completed.stars ? '⭐' : '☆';
      check.textContent = completedStars;
      card.appendChild(check);
    }

    container.appendChild(card);
  });
}

// ────────────────────────────────────────────────────────────
// 14. NAVIGATION / ROUTING
// ────────────────────────────────────────────────────────────

var freePlayKeyMap = {};

function navigate(screen) {
  try {
    // Hide all screens
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove('active');
    }

    // Release all active notes
    AppState.activeKeys.forEach(function(n) { highlightKey(n, false); });
    AppState.activeKeys.clear();

    // Show target screen
    var targetId = 'screen-' + screen;
    var target = document.getElementById(targetId);
    if (target) {
      target.classList.add('active');
    }

    // Update hash (safely — may fail in sandboxed iframes)
    try { window.location.hash = '#' + screen; } catch(e) { /* ignore */ }

    // Screen-specific setup
    if (screen === 'free-play') {
      freePlayKeyMap = renderPiano('piano-free-play');
      var noteLetter = document.getElementById('note-letter');
      if (noteLetter) noteLetter.textContent = 'Press a key!';
      var noteEmoji = document.getElementById('note-emoji');
      if (noteEmoji) noteEmoji.textContent = '';
    }

    if (screen === 'lesson') {
      renderSongList();
    }

    if (screen === 'parent-settings') {
      renderSettingsSongCheckboxes();
      syncSettingsUI();
    }

    if (screen === 'profile-menu') {
      var title = document.getElementById('profile-menu-title');
      if (title) {
        if (AppState.currentProfile === 'little-star') {
          title.textContent = '\u2B50 Little Star';
        } else {
          title.textContent = '\uD83D\uDE80 Rock Star';
        }
      }
    }
  } catch(e) {
    // Log but don't crash
    console.error('Navigation error:', e);
  }
}

function selectProfile(profileId) {
  AppState.currentProfile = profileId;
  navigate('profile-menu');
}

function getCurrentScreen() {
  var active = document.querySelector('.screen.active');
  return active ? active.id : 'screen-home';
}

// Handle hash changes (browser back/forward)
window.addEventListener('hashchange', function() {
  var hash = window.location.hash.slice(1);
  if (hash && hash !== getCurrentScreen().replace('screen-', '')) {
    // Only navigate for simple hash changes (not during active lessons)
    if (!AppState.lessonActive || hash === 'lesson' || hash === 'home') {
      var screenEl = document.getElementById('screen-' + hash);
      if (screenEl) {
        navigate(hash);
      }
    }
  }
});

// ────────────────────────────────────────────────────────────
// 15. INITIALIZATION
// ────────────────────────────────────────────────────────────

function init() {
  try {
    // Initialize MIDI
    initMIDI();

    // Resume audio context on first user interaction
    document.addEventListener('click', function() {
      getAudioContext();
    }, { once: true });
    document.addEventListener('touchstart', function() {
      getAudioContext();
    }, { once: true });

    // Route from initial hash
    var hash = '';
    try { hash = window.location.hash.slice(1); } catch(e) {}
    // Screens that require a profile — redirect to home if no profile selected
    var profileRequired = ['free-play', 'lesson', 'lesson-play', 'profile-menu'];
    if (hash && document.getElementById('screen-' + hash)) {
      if (profileRequired.indexOf(hash) !== -1 && !AppState.currentProfile) {
        navigate('home');
      } else {
        navigate(hash);
      }
    } else {
      navigate('home');
    }
  } catch(e) {
    console.error('Init error:', e);
    // Fallback: at least show the home screen
    var homeScreen = document.getElementById('screen-home');
    if (homeScreen) homeScreen.classList.add('active');
  }
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
