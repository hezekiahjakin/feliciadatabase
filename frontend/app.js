/**
 * F.E.L.I.C.I.A. // Tactical Fireteam Construct Client Engine
 * Fireteam Evaluation & Logistics Intelligence Construct for Interactive Analysis
 * Powered by Firebase Authentication & Cloud Firestore (ping-vault-matrix)
 */

import {
  initFirebase,
  getFirebaseConfig,
  saveFirebaseConfig,
  fetchServerFirebaseConfig,
  subscribeAuth,
  loginWithGoogle,
  loginWithEmail,
  signUpWithEmail,
  sendPhoneVerificationCode,
  verifyPhoneSmsCode,
  logoutUser,
  updateUserCallsign,
  getFirestoreLoadouts,
  saveFirestoreLoadout,
  deleteFirestoreLoadout
} from './firebase-service.js';

// Application State
const state = {
  currentTab: 'tab-comms',
  guardianClass: 'Warlock',
  subclass: 'solar',          // 'stasis', 'void', 'arc', 'solar', 'strand', 'prismatic'
  activity: 'Grandmaster+',   // 'Grandmaster+', 'Dungeon / Raid', 'PVP'
  tacticalInquiry: 'Ability Focused',
  design: 'ghost',       // 'ghost' (V1 Default) | 'exo'
  shader: 'solar',       // 'stasis', 'void', 'arc', 'solar', 'strand', 'prismatic'
  soundEnabled: true,
  autoSpeak: false,
  voiceRate: 1.0,
  voicePitch: 1.05,
  selectedVoice: null,
  chatHistory: [],
  wikiList: [],
  buildsList: [],
  godRollsList: [],
  godRollsFilter: { search: '', slot: 'all', type: 'all' },
  armoryView: 'godrolls',
  isThinking: false,
  isSpeaking: false,
  cursor: { x: 0, y: 0, targetX: 0, targetY: 0 },
  currentUser: null,
  emailAuthMode: 'signin' // 'signin' | 'signup'
};

// Subclass Palettes & Tactical Profiles (Solar replaces Amber with true orange; Stasis added)
const SHADERS = {
  stasis:    { primary: '#2563EB', secondary: '#93C5FD', core: '#60A5FA', glow: 'rgba(37, 99, 235, 0.55)', dark: '#081736' },
  void:      { primary: '#A855F7', secondary: '#E9D5FF', core: '#C084FC', glow: 'rgba(168, 85, 247, 0.5)', dark: '#180A26' },
  arc:       { primary: '#38BDF8', secondary: '#E0F2FE', core: '#7DD3FC', glow: 'rgba(56, 189, 248, 0.5)', dark: '#081D29' },
  solar:     { primary: '#F5A623', secondary: '#FFFBEB', core: '#F97316', glow: 'rgba(245, 166, 35, 0.55)', dark: '#1F1608' },
  strand:    { primary: '#10B981', secondary: '#D1FAE5', core: '#34D399', glow: 'rgba(16, 185, 129, 0.5)', dark: '#062016' },
  prismatic: { primary: '#E879F9', secondary: '#38BDF8', core: '#F5A623', glow: 'rgba(232, 121, 249, 0.55)', dark: '#150A21' },
  vanguard:  { primary: '#F5A623', secondary: '#FFFFFF', core: '#FFD54F', glow: 'rgba(245, 166, 35, 0.45)', dark: '#1F1608' }
};

// Activity to Inquiry Options Mapping
const ACTIVITY_INQUIRIES = {
  'Grandmaster+': [
    'Ability Focused',
    'Survivability',
    'Healing Loop'
  ],
  'Dungeon / Raid': [
    'Soft Ad Clear',
    'Boss DPS',
    'Static Survivability'
  ],
  'PVP': [
    'Hand Cannon Bias',
    'Shotgun Bias',
    'Ability Spammer',
    'Auto Rifle Bias',
    'Pulse Rifle Bias',
    'Scout Rifle Bias'
  ]
};

/* ==========================================================================
   WEB AUDIO SYNTHESIZER (TACTICAL GHOST CHIRPS & SFX)
   ========================================================================== */
class GhostAudioEngine {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Iconic high-tech Ghost chirp
  playChirp() {
    if (!state.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(1200, now);
      osc1.frequency.exponentialRampToValueAtTime(2400, now + 0.06);
      osc1.frequency.exponentialRampToValueAtTime(1600, now + 0.12);

      osc2.frequency.setValueAtTime(800, now);
      osc2.frequency.linearRampToValueAtTime(1400, now + 0.08);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.15);
      osc2.stop(now + 0.15);
    } catch (e) {}
  }

  // Radio transmit burst
  playTransmit() {
    if (!state.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch (e) {}
  }

  // Receive response ping
  playReceive() {
    if (!state.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(980, now);
      osc.frequency.exponentialRampToValueAtTime(1470, now + 0.07);
      osc.frequency.exponentialRampToValueAtTime(1960, now + 0.16);

      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    } catch (e) {}
  }

  // Warning alert buzz
  playAlert() {
    if (!state.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(160, now + 0.1);

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    } catch (e) {}
  }
}

const sfx = new GhostAudioEngine();

/* ==========================================================================
   SCOTTISH SPEECH SYNTHESIS ENGINE
   ========================================================================== */
class ScottishVoiceEngine {
  constructor() {
    this.voices = [];
    this.initVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => this.initVoices();
    }
  }

  initVoices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    this.voices = window.speechSynthesis.getVoices();
    const select = document.getElementById('voiceSelect');
    if (!select) return;

    select.innerHTML = '<option value="auto">Auto-detect Scottish / UK Voice</option>';
    
    // Sort so UK/Scottish voices appear at top
    const ukVoices = [];
    const otherVoices = [];

    this.voices.forEach((v, idx) => {
      const nameLower = v.name.toLowerCase();
      const langLower = v.lang.toLowerCase();
      const isScot = nameLower.includes('scot') || nameLower.includes('fiona');
      const isUK = langLower.includes('en-gb') || langLower.includes('en_gb') || langLower.includes('en-ie') || nameLower.includes('uk');

      if (isScot || isUK) {
        ukVoices.push({ v, idx, isScot });
      } else if (langLower.startsWith('en')) {
        otherVoices.push({ v, idx, isScot: false });
      }
    });

    ukVoices.forEach(({ v, idx, isScot }) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${isScot ? '🏴󠁧󠁢󠁳󠁣󠁴󠁿 ' : '🇬🇧 '} ${v.name} (${v.lang})`;
      select.appendChild(opt);
    });

    otherVoices.forEach(({ v, idx }) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${v.name} (${v.lang})`;
      select.appendChild(opt);
    });
  }

  speak(text) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    // Clean markdown symbols for natural reading
    const cleanText = text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/#+\s/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/---/g, '')
      .replace(/•/g, '')
      .trim();

    if (!cleanText) return;

    const utter = new SpeechSynthesisUtterance(cleanText);
    utter.rate = state.voiceRate;
    utter.pitch = state.voicePitch;

    // Pick voice
    const select = document.getElementById('voiceSelect');
    const selectedIdx = select ? select.value : 'auto';

    if (selectedIdx !== 'auto' && this.voices[selectedIdx]) {
      utter.voice = this.voices[selectedIdx];
    } else {
      // Find Scottish or best UK voice
      const scotVoice = this.voices.find(v => 
        v.name.toLowerCase().includes('scot') || 
        v.name.toLowerCase().includes('fiona')
      );
      const ukVoice = this.voices.find(v => 
        v.lang.toLowerCase().includes('en-gb') || 
        v.lang.toLowerCase().includes('en_gb')
      );
      if (scotVoice) utter.voice = scotVoice;
      else if (ukVoice) utter.voice = ukVoice;
    }

    utter.onstart = () => {
      state.isSpeaking = true;
      updateConstructMood('TRANSMITTING AUDIO // SCOTTISH VOICE');
    };

    utter.onend = () => {
      state.isSpeaking = false;
      updateConstructMood('STATUS: STANDBY // SCANNING');
    };

    utter.onerror = () => {
      state.isSpeaking = false;
      updateConstructMood('STATUS: STANDBY // SCANNING');
    };

    window.speechSynthesis.speak(utter);
  }

  stop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      state.isSpeaking = false;
    }
  }
}

const voice = new ScottishVoiceEngine();

/* ==========================================================================
   INTERACTIVE CANVAS 3D GHOST CONSTRUCT (V1 DEFAULT DESIGN)
   ========================================================================== */
class GhostCanvasRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.time = 0;
    this.blinkTimer = 0;
    this.isBlinking = false;
    this.eyeX = 0;
    this.eyeY = 0;
    this.initEvents();
    this.render();
  }

  initEvents() {
    const handleMove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const x = ((clientX - rect.left) / rect.width) * 2 - 1;
      const y = ((clientY - rect.top) / rect.height) * 2 - 1;
      state.cursor.targetX = Math.max(-1, Math.min(1, x));
      state.cursor.targetY = Math.max(-1, Math.min(1, y));
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove, { passive: true });
  }

  render() {
    requestAnimationFrame(() => this.render());
    if (!this.ctx) return;

    this.time += 0.025;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    // Smooth cursor interpolation
    state.cursor.x += (state.cursor.targetX - state.cursor.x) * 0.08;
    state.cursor.y += (state.cursor.targetY - state.cursor.y) * 0.08;

    // Blink logic
    this.blinkTimer += 0.016;
    if (this.blinkTimer > 4 + Math.random() * 3) {
      this.isBlinking = true;
      if (this.blinkTimer > 4.2 + Math.random() * 3) {
        this.isBlinking = false;
        this.blinkTimer = 0;
      }
    }

    this.ctx.clearRect(0, 0, w, h);

    if (state.design === 'ghost') {
      this.renderGhost(cx, cy);
    } else {
      this.renderExo(cx, cy);
    }
  }

  renderGhost(cx, cy) {
    const palette = SHADERS[state.shader] || SHADERS.vanguard;
    const bob = Math.sin(this.time * 1.5) * 6;
    const centerY = cy + bob;

    // Expansion pulse when thinking or speaking
    let flare = 0;
    if (state.isThinking) {
      flare = Math.sin(this.time * 8) * 8 + 4;
    } else if (state.isSpeaking) {
      flare = Math.sin(this.time * 12) * 5 + 2;
    }

    // 1. Ambient Background Halo
    const grad = this.ctx.createRadialGradient(cx, centerY, 10, cx, centerY, 110 + flare * 2);
    grad.addColorStop(0, palette.glow);
    grad.addColorStop(1, 'transparent');
    this.ctx.fillStyle = grad;
    this.ctx.beginPath();
    this.ctx.arc(cx, centerY, 110 + flare * 2, 0, Math.PI * 2);
    this.ctx.fill();

    // 2. Tactical Ghost Shell Wings (8 tetrahedral diamond facets)
    const baseDist = 52 + flare;
    const wingSize = 36;
    const rotSpeed = state.isThinking ? this.time * 1.8 : this.time * 0.3;

    const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    const diagAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

    // Prismatic dynamic elemental colors across wings
    const isPrismatic = (state.shader === 'prismatic' || state.subclass === 'prismatic');
    const prismaticColors = ['#38BDF8', '#F5A623', '#10B981', '#2563EB']; // Arc, Solar, Strand, Stasis
    const prismaticDiags = ['#A855F7', '#E879F9', '#818CF8', '#F43F5E']; // Void, Magenta, Indigo, Rose

    // Background diagonal wings (darker shaded)
    diagAngles.forEach((ang, idx) => {
      const a = ang + rotSpeed * 0.5;
      const wx = cx + Math.cos(a) * (baseDist * 0.95);
      const wy = centerY + Math.sin(a) * (baseDist * 0.95);
      const secColor = isPrismatic ? prismaticDiags[idx % prismaticDiags.length] : palette.secondary;
      this.drawShellFacet(wx, wy, a, wingSize * 0.85, secColor, 0.45, palette.dark);
    });

    // Foreground orthogonal wings (sharp armor plates)
    angles.forEach((ang, idx) => {
      const a = ang + rotSpeed;
      const wx = cx + Math.cos(a) * baseDist;
      const wy = centerY + Math.sin(a) * baseDist;
      const primColor = isPrismatic ? prismaticColors[idx % prismaticColors.length] : palette.primary;
      this.drawShellFacet(wx, wy, a, wingSize, primColor, 0.95, '#FFFFFF');
    });

    // 3. Central Ocular Core (Sphere + Iris + Tracking Pupil)
    const coreRadius = 28 + (state.isSpeaking ? Math.sin(this.time * 10) * 2 : 0);
    
    // Core outer metallic housing
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(cx, centerY, coreRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = '#0B0F17';
    this.ctx.fill();
    this.ctx.lineWidth = 3;
    this.ctx.strokeStyle = palette.primary;
    this.ctx.stroke();

    // Inner glowing ocular aperture
    const innerRadius = coreRadius - 4;
    const coreGlow = this.ctx.createRadialGradient(cx, centerY, 2, cx, centerY, innerRadius);
    coreGlow.addColorStop(0, '#FFFFFF');
    coreGlow.addColorStop(0.4, palette.core);
    coreGlow.addColorStop(0.9, palette.primary);
    coreGlow.addColorStop(1, '#05070A');
    this.ctx.fillStyle = coreGlow;
    this.ctx.beginPath();
    this.ctx.arc(cx, centerY, innerRadius, 0, Math.PI * 2);
    this.ctx.fill();

    // Eye Tracking Pupil
    const maxLook = 7;
    const lookX = cx + state.cursor.x * maxLook;
    const lookY = centerY + state.cursor.y * maxLook;

    if (!this.isBlinking) {
      // Aperture Iris ring
      this.ctx.strokeStyle = '#FFFFFF';
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.arc(lookX, lookY, 8, 0, Math.PI * 2);
      this.ctx.stroke();

      // Pupil center dot
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.beginPath();
      this.ctx.arc(lookX, lookY, 4, 0, Math.PI * 2);
      this.ctx.fill();
    } else {
      // Blink horizontal slit
      this.ctx.strokeStyle = '#FFFFFF';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(cx - 12, centerY);
      this.ctx.lineTo(cx + 12, centerY);
      this.ctx.stroke();
    }

    // Vanguard Light Scan Ring
    this.ctx.strokeStyle = palette.primary;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 6]);
    this.ctx.beginPath();
    this.ctx.arc(cx, centerY, coreRadius + 14 + flare * 0.5, this.time, this.time + Math.PI * 1.5);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.ctx.restore();
  }

  drawShellFacet(x, y, angle, size, color, alpha, trimColor) {
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(angle + Math.PI / 2);

    this.ctx.globalAlpha = alpha;
    this.ctx.beginPath();
    this.ctx.moveTo(0, -size);
    this.ctx.lineTo(size * 0.5, 0);
    this.ctx.lineTo(0, size * 0.4);
    this.ctx.lineTo(-size * 0.5, 0);
    this.ctx.closePath();

    this.ctx.fillStyle = color;
    this.ctx.fill();

    this.ctx.lineWidth = 1.5;
    this.ctx.strokeStyle = trimColor;
    this.ctx.stroke();

    this.ctx.restore();
  }

  // Exo Hologram Visor Mode
  renderExo(cx, cy) {
    const palette = SHADERS[state.shader] || SHADERS.arc;
    const bob = Math.sin(this.time * 1.5) * 4;
    const centerY = cy + bob;

    // Holographic grid scan lines
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    this.ctx.lineWidth = 1;
    for (let i = -60; i <= 60; i += 15) {
      this.ctx.beginPath();
      this.ctx.moveTo(cx - 70, centerY + i);
      this.ctx.lineTo(cx + 70, centerY + i);
      this.ctx.stroke();
    }

    // Exo Head Silhouette Frame
    this.ctx.strokeStyle = palette.primary;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(cx - 50, centerY - 45);
    this.ctx.lineTo(cx + 50, centerY - 45);
    this.ctx.lineTo(cx + 40, centerY + 25);
    this.ctx.lineTo(cx, centerY + 55);
    this.ctx.lineTo(cx - 40, centerY + 25);
    this.ctx.closePath();
    this.ctx.fillStyle = 'rgba(11, 15, 23, 0.9)';
    this.ctx.fill();
    this.ctx.stroke();

    // Cybernetic Glowing Visor
    const visorGlow = this.ctx.createLinearGradient(cx - 35, centerY - 10, cx + 35, centerY - 10);
    visorGlow.addColorStop(0, palette.primary);
    visorGlow.addColorStop(0.5, '#FFFFFF');
    visorGlow.addColorStop(1, palette.primary);

    this.ctx.fillStyle = visorGlow;
    this.ctx.beginPath();
    this.ctx.roundRect(cx - 35, centerY - 15, 70, 14, 3);
    this.ctx.fill();

    // Equalizer audio spectrum when speaking/thinking
    const bars = 9;
    const barW = 4;
    this.ctx.fillStyle = '#FFFFFF';
    for (let b = 0; b < bars; b++) {
      const bx = cx - 24 + b * 6;
      let hVal = 4;
      if (state.isSpeaking) {
        hVal = Math.abs(Math.sin(this.time * 8 + b)) * 18 + 4;
      } else if (state.isThinking) {
        hVal = Math.abs(Math.sin(this.time * 5 + b)) * 10 + 3;
      }
      this.ctx.fillRect(bx, centerY + 18 - hVal / 2, barW, hVal);
    }

    this.ctx.restore();
  }
}

let ghostRenderer = null;

function updateConstructMood(text) {
  const el = document.getElementById('constructMood');
  if (el) el.textContent = text;
}

/* ==========================================================================
   MARKDOWN PARSER FOR TACTICAL COMMS
   ========================================================================== */
function renderMarkdown(md) {
  if (!md) return '';
  let html = md
    // Escape basic html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.*$)/gim, '<h4 style="color:#F5A623; margin:10px 0 4px; font-family:var(--font-tactical); font-size:15px;">$1</h4>')
    .replace(/^## (.*$)/gim, '<h3 style="color:#FFF; margin:12px 0 6px; font-family:var(--font-tactical); font-size:16px;">$1</h3>')
    // Bold & Italics
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bullet points
    .replace(/^\s*[-*]\s(.*$)/gim, '<li>$1</li>')
    // Numbered lists
    .replace(/^\s*(\d+)\.\s(.*$)/gim, '<li><strong style="color:#F5A623;">$1.</strong> $2</li>');

  // Wrap lists
  html = html.replace(/(<li>.*<\/li>)/gms, '<ul>$1</ul>');
  // Line breaks to paragraphs
  html = html.split('\n\n').map(p => {
    if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<blockquote')) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return html;
}

/* ==========================================================================
   CHAT COMMS ENGINE
   ========================================================================== */
async function sendChatMessage(userText) {
  if (!userText || !userText.trim()) return;
  const text = userText.trim();

  // Play transmit audio
  sfx.playTransmit();

  // Add User Message to UI
  appendMessage('user', 'GUARDIAN', text);

  // Set thinking state
  state.isThinking = true;
  updateConstructMood('CALCULATING TELEMETRY // GEMINI CORE');
  const thinkingEl = document.getElementById('thinkingIndicator');
  if (thinkingEl) thinkingEl.classList.remove('hidden');

  const messagesContainer = document.getElementById('messagesContainer');
  if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: state.chatHistory.slice(-8),
        guardian_class: state.guardianClass,
        activity: state.activity,
        subclass: state.subclass,
        tactical_inquiry: state.tacticalInquiry
      })
    });

    const data = await res.json();
    state.isThinking = false;
    if (thinkingEl) thinkingEl.classList.add('hidden');

    const reply = data.reply || "Could not get a clean signal right now, Guardian. Let's try again in a moment.";
    
    // Play receive audio
    sfx.playReceive();

    // Append F.E.L.I.C.I.A.'s Scottish reply
    appendMessage('felicia', 'F.E.L.I.C.I.A.', reply, data.snippets_used);

    // Save to local conversation history
    state.chatHistory.push({ role: 'user', content: text });
    state.chatHistory.push({ role: 'model', content: reply });

    // Auto-speak if enabled
    if (state.autoSpeak) {
      voice.speak(reply);
    } else {
      updateConstructMood('STATUS: STANDBY // SCANNING');
    }

  } catch (err) {
    state.isThinking = false;
    if (thinkingEl) thinkingEl.classList.add('hidden');
    appendMessage('felicia', 'F.E.L.I.C.I.A.', `Signal dropped out: ${err.message}. Give it another try in a moment!`);
    updateConstructMood('ERROR // COMMUNICATIONS DRIFT');
  }
}

function appendMessage(role, sender, text, snippets = []) {
  const container = document.getElementById('messagesContainer');
  if (!container) return;

  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const isFelicia = role === 'felicia';
  const avatarHtml = isFelicia 
    ? '<div class="msg-avatar"><div class="ghost-mini-core"></div></div>'
    : '<div class="msg-avatar"><span class="user-avatar-text">G</span></div>';

  let snippetsHtml = '';
  if (snippets && snippets.length > 0) {
    snippetsHtml = `<div style="margin-top:8px; font-size:11px; color:#94A3B8; border-top:1px dashed rgba(255,255,255,0.1); padding-top:6px;">
      <span style="color:#F5A623;">ARCHIVAL INTEL USED:</span> ${snippets.join(', ')}
    </div>`;
  }

  const voiceBtn = isFelicia 
    ? '<button class="btn-voice-play" title="Listen to Scottish Voice">🗣️ Listen</button>'
    : '';

  row.innerHTML = `
    ${avatarHtml}
    <div class="msg-bubble">
      <div class="msg-header">
        <span class="msg-sender">${sender}</span>
        <span class="msg-tag">${isFelicia ? 'SCOTTISH CONSTRUCT' : state.guardianClass.toUpperCase()}</span>
        ${voiceBtn}
      </div>
      <div class="msg-content">
        ${renderMarkdown(text)}
        ${snippetsHtml}
      </div>
    </div>
  `;

  // Attach speech button
  if (isFelicia) {
    const playBtn = row.querySelector('.btn-voice-play');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        sfx.playChirp();
        voice.speak(text);
      });
    }
  }

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

/* ==========================================================================
   WIKI & ARCHIVE INTEL ENGINE
   ========================================================================== */
async function loadWikiData() {
  try {
    const res = await fetch('/api/wiki');
    const data = await res.json();
    state.wikiList = [...(data.starter || []), ...(data.user || [])];
    renderWikiGrid();
  } catch (err) {
    console.error('Failed to load wiki:', err);
  }
}

function renderWikiGrid(filterCat = 'all', searchQuery = '') {
  const grid = document.getElementById('wikiGrid');
  if (!grid) return;

  grid.innerHTML = '';

  const q = searchQuery.toLowerCase().trim();
  const filtered = state.wikiList.filter(item => {
    const matchCat = filterCat === 'all' || 
      (filterCat === 'Custom' && item.is_custom) || 
      (item.category && item.category.toLowerCase() === filterCat.toLowerCase());

    const titleLower = (item.title || '').toLowerCase();
    const contentLower = (item.content || '').toLowerCase();
    const tagsLower = (item.tags || []).join(' ').toLowerCase();

    const matchSearch = !q || titleLower.includes(q) || contentLower.includes(q) || tagsLower.includes(q);
    return matchCat && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:#64748B; font-family:var(--font-tactical); font-size:16px;">
      NO INTEL ENTRIES FOUND. TAP 'ADD INTEL ENTRY' OR 'IMPORT WIKI FILE' TO EXPAND F.E.L.I.C.I.A.'S KNOWLEDGE!
    </div>`;
    return;
  }

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'wiki-card';

    const isCustom = item.is_custom;
    const catClass = isCustom ? 'badge-cat custom' : 'badge-cat';
    const tagsHtml = (item.tags || []).map(t => `<span class="tag-badge">${t}</span>`).join('');

    card.innerHTML = `
      <div class="wiki-card-header">
        <h3 class="wiki-card-title">${item.title}</h3>
        <span class="${catClass}">${item.category || 'INTEL'}</span>
      </div>
      <p class="wiki-card-summary">${item.summary || (item.content ? item.content.slice(0, 140) + '...' : '')}</p>
      <div class="wiki-card-tags">${tagsHtml}</div>
      <div class="wiki-card-footer">
        <button class="btn-card-action btn-view-article">Read Intel &rarr;</button>
        ${isCustom ? `<button class="btn-card-action btn-card-delete" data-id="${item.id}">Delete</button>` : '<span style="color:#64748B; font-size:11px;">Standard Issue</span>'}
      </div>
    `;

    // View Article click
    card.querySelector('.btn-view-article').addEventListener('click', (e) => {
      e.stopPropagation();
      openWikiArticleModal(item);
    });

    card.addEventListener('click', () => openWikiArticleModal(item));

    // Delete custom item
    if (isCustom) {
      const delBtn = card.querySelector('.btn-card-delete');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Delete '${item.title}' from knowledge base?`)) {
            await deleteWikiItem(item.id);
          }
        });
      }
    }

    grid.appendChild(card);
  });
}

function openWikiArticleModal(item) {
  sfx.playChirp();
  const modal = document.getElementById('modalViewWiki');
  if (!modal) return;

  document.getElementById('viewWikiTitle').textContent = item.title;
  document.getElementById('viewWikiCategory').textContent = item.category || 'INTEL';
  
  const tagsContainer = document.getElementById('viewWikiTags');
  tagsContainer.innerHTML = (item.tags || []).map(t => `<span class="tag-badge">${t}</span>`).join('');

  document.getElementById('viewWikiContent').innerHTML = renderMarkdown(item.content);

  const askBtn = document.getElementById('btnAskFeliciaAboutWiki');
  askBtn.onclick = () => {
    modal.close();
    switchTab('tab-comms');
    const prompt = `Tell me about ${item.title} and how to best use it in our fireteam!`;
    document.getElementById('chatInput').value = prompt;
    sendChatMessage(prompt);
  };

  modal.showModal();
}

async function deleteWikiItem(id) {
  try {
    await fetch(`/api/wiki/${id}`, { method: 'DELETE' });
    state.wikiList = state.wikiList.filter(i => i.id !== id);
    renderWikiGrid();
  } catch (err) {
    alert('Failed to delete item: ' + err.message);
  }
}

/* ==========================================================================
   FIRETEAM VAULT (SAVED BUILDS & CLOUD FIRESTORE)
   ========================================================================== */
async function loadBuilds() {
  if (state.currentUser) {
    try {
      const fbBuilds = await getFirestoreLoadouts(state.currentUser.uid);
      if (fbBuilds && fbBuilds.length > 0) {
        state.buildsList = fbBuilds;
        renderBuildsGrid();
        return;
      }
    } catch (e) {
      console.warn('[Firestore] Falling back to local builds API:', e);
    }
  }

  try {
    const res = await fetch('/api/builds');
    const data = await res.json();
    state.buildsList = data.builds || [];
    renderBuildsGrid();
  } catch (err) {
    console.error('Failed to load builds:', err);
  }
}

function renderBuildsGrid() {
  const grid = document.getElementById('vaultGrid');
  if (!grid) return;

  grid.innerHTML = '';
  if (state.buildsList.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:#64748B; font-family:var(--font-tactical); font-size:16px;">
      NO SAVED BUILDS IN VAULT. TAP 'SAVE NEW LOADOUT' OR ASK F.E.L.I.C.I.A. TO CRAFT ONE!
    </div>`;
    return;
  }

  state.buildsList.forEach(build => {
    const card = document.createElement('div');
    card.className = 'vault-card';

    const stats = build.stats || {
      health: build.health ?? 100,
      melee: build.melee ?? 60,
      grenade: build.grenade ?? 100,
      super: build.super ?? 40,
      classStat: build.classStat ?? 80
    };

    const kineticName = build.weapons?.kinetic?.name || build.kinetic_weapon || '—';
    const kineticPerks = build.weapons?.kinetic?.perks || '';
    const energyName = build.weapons?.energy?.name || build.energy_weapon || '—';
    const energyPerks = build.weapons?.energy?.perks || '';
    const heavyName = build.weapons?.heavy?.name || build.heavy_weapon || '—';
    const heavyPerks = build.weapons?.heavy?.perks || '';

    const buildTitle = build.name || build.title || 'Custom Loadout';
    const gClass = (build.guardianClass || build.guardian_class || 'Warlock').toUpperCase();
    const subclass = build.subclass || 'Solar 3.0';
    const exotic = build.exoticArmor || build.exotic_armor || 'None';

    card.innerHTML = `
      <div class="wiki-card-header">
        <div>
          <h3 class="wiki-card-title">${buildTitle}</h3>
          <div style="font-size:12px; color:#F5A623; font-family:var(--font-tactical); font-weight:700; margin-top:2px;">
            ${gClass} // ${subclass} // ${exotic}
          </div>
        </div>
        <span class="badge-cat">${gClass}</span>
      </div>

      <!-- 6 Stat Categories HUD Chips (0-200) -->
      <div class="vault-stats-chips">
        <div class="vault-stat-cell">
          <span class="stat-cell-lbl">HEALTH</span>
          <span class="stat-cell-val health">${stats.health ?? 100}</span>
        </div>
        <div class="vault-stat-cell">
          <span class="stat-cell-lbl">MELEE</span>
          <span class="stat-cell-val melee">${stats.melee ?? 60}</span>
        </div>
        <div class="vault-stat-cell">
          <span class="stat-cell-lbl">GRENADE</span>
          <span class="stat-cell-val grenade">${stats.grenade ?? 100}</span>
        </div>
        <div class="vault-stat-cell">
          <span class="stat-cell-lbl">SUPER</span>
          <span class="stat-cell-val super">${stats.super ?? 40}</span>
        </div>
        <div class="vault-stat-cell">
          <span class="stat-cell-lbl">CLASS</span>
          <span class="stat-cell-val class">${stats.classStat ?? 80}</span>
        </div>
        <div class="vault-stat-cell">
          <span class="stat-cell-lbl">WEAPONS</span>
          <span class="stat-cell-val weapons">${stats.weapons ?? 100}</span>
        </div>
      </div>

      <!-- Weapons Arsenal Breakdown -->
      <div class="vault-weapons-summary">
        <div class="v-weapon-row">
          <span class="v-w-slot">⚪ KINETIC</span>
          <span class="v-w-name">${kineticName}</span>
          ${kineticPerks ? `<span class="v-w-perks" title="${kineticPerks}">${kineticPerks}</span>` : ''}
        </div>
        <div class="v-weapon-row">
          <span class="v-w-slot">🟠 ENERGY</span>
          <span class="v-w-name">${energyName}</span>
          ${energyPerks ? `<span class="v-w-perks" title="${energyPerks}">${energyPerks}</span>` : ''}
        </div>
        <div class="v-weapon-row">
          <span class="v-w-slot">🟣 HEAVY</span>
          <span class="v-w-name">${heavyName}</span>
          ${heavyPerks ? `<span class="v-w-perks" title="${heavyPerks}">${heavyPerks}</span>` : ''}
        </div>
      </div>

      ${(build.keyAspects || build.key_aspects_fragments) ? `<p style="font-size:12px; color:#94A3B8; line-height:1.4;"><strong>Aspects/Mods:</strong> ${build.keyAspects || build.key_aspects_fragments}</p>` : ''}
      ${build.notes ? `<p style="font-size:12px; color:#64748B; line-height:1.3; font-style:italic;">"${build.notes}"</p>` : ''}

      <div class="wiki-card-footer">
        <button class="btn-card-action btn-equip-chat">Review with F.E.L.I.C.I.A. &rarr;</button>
        <button class="btn-card-action btn-card-delete" data-id="${build.id}">Delete</button>
      </div>
    `;

    card.querySelector('.btn-equip-chat').addEventListener('click', () => {
      switchTab('tab-comms');
      const prompt = `Review my loadout: '${buildTitle}' (${gClass} ${subclass} with ${exotic}). Stats: Health ${stats.health}, Melee ${stats.melee}, Grenade ${stats.grenade}, Super ${stats.super}, Class ${stats.classStat}, Weapons ${stats.weapons || 100}. Weapons: Kinetic ${kineticName}, Energy ${energyName}, Heavy ${heavyName}. Evaluate my stat distribution (scaling 0-200) and weapon synergy!`;
      const input = document.getElementById('chatInput');
      if (input) input.value = prompt;
      sendChatMessage(prompt);
    });

    card.querySelector('.btn-card-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Delete build '${buildTitle}'?`)) {
        if (state.currentUser && build.id && !build.id.startsWith('build-')) {
          try {
            await deleteFirestoreLoadout(state.currentUser.uid, build.id);
          } catch (err) {
            console.warn('[Firestore] Delete failed:', err);
          }
        }
        try {
          await fetch(`/api/builds/${build.id}`, { method: 'DELETE' });
        } catch (err) {}
        state.buildsList = state.buildsList.filter(b => b.id !== build.id);
        renderBuildsGrid();
      }
    });

    grid.appendChild(card);
  });
}

/* ==========================================================================
   GOD ROLL FINDER // VANGUARD WEAPON ARMORY
   ========================================================================== */
let pendingGodRollData = null;

async function loadGodRolls() {
  try {
    const res = await fetch('/api/godrolls');
    const data = await res.json();
    state.godRollsList = data.godrolls || [];
    renderGodRollsGrid();
  } catch (err) {
    console.error('Failed to load god rolls:', err);
  }
}

function renderGodRollsGrid() {
  const grid = document.getElementById('godrollsGrid');
  const counter = document.getElementById('armoryCounterBadge');
  if (!grid) return;

  const searchQ = (state.godRollsFilter.search || '').toLowerCase().trim();
  const slotQ = state.godRollsFilter.slot || 'all';
  const typeQ = state.godRollsFilter.type || 'all';

  const filtered = state.godRollsList.filter(w => {
    if (slotQ !== 'all' && w.slot?.toLowerCase() !== slotQ.toLowerCase()) return false;
    if (typeQ !== 'all' && !w.type?.toLowerCase().includes(typeQ.toLowerCase())) return false;
    if (searchQ) {
      const matchName = w.name?.toLowerCase().includes(searchQ);
      const matchType = w.type?.toLowerCase().includes(searchQ);
      const matchElem = w.element?.toLowerCase().includes(searchQ);
      const matchFrame = w.frame?.toLowerCase().includes(searchQ);
      const matchSource = w.source?.toLowerCase().includes(searchQ);
      const matchPvePerks = (w.pve?.perk1 + ' ' + w.pve?.perk2 + ' ' + w.pve?.barrel + ' ' + w.pve?.mag).toLowerCase().includes(searchQ);
      const matchPvpPerks = (w.pvp?.perk1 + ' ' + w.pvp?.perk2 + ' ' + w.pvp?.barrel + ' ' + w.pvp?.mag).toLowerCase().includes(searchQ);
      if (!matchName && !matchType && !matchElem && !matchFrame && !matchSource && !matchPvePerks && !matchPvpPerks) {
        return false;
      }
    }
    return true;
  });

  if (counter) {
    counter.textContent = `SHOWING ${filtered.length} WEAPONS`;
  }

  grid.innerHTML = '';
  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:#64748B; font-family:var(--font-tactical); font-size:16px;">
      NO WEAPONS FOUND MATCHING "${searchQ.toUpperCase()}". TRY ANOTHER SEARCH OR TAP 'ADD / EDIT WEAPON ROLL'!
    </div>`;
    return;
  }

  filtered.forEach(weapon => {
    const card = document.createElement('div');
    card.className = 'godroll-card';
    card.dataset.id = weapon.id;

    const pve = weapon.pve || {};
    const pvp = weapon.pvp || {};

    const slotClass = (weapon.slot || 'kinetic').toLowerCase();
    const elemClass = (weapon.element || 'kinetic').toLowerCase();

    card.innerHTML = `
      <div class="gr-card-header">
        <div class="gr-badge-row">
          <span class="gr-badge gr-slot ${slotClass}">${weapon.slot || 'Kinetic'}</span>
          <span class="gr-badge gr-elem ${elemClass}">${weapon.element || 'Kinetic'}</span>
          <span class="gr-badge gr-frame">${weapon.frame || weapon.type}</span>
        </div>
        <h3 class="gr-weapon-name">${weapon.name}</h3>
        <div class="gr-source-tag">📍 ${weapon.source || 'Destiny 2 Activities'}</div>
      </div>

      <div class="gr-rolls-columns">
        <div class="gr-roll-box pve-box">
          <div class="gr-box-header">
            <span class="gr-mode-icon">⚔️</span>
            <span class="gr-mode-title">PVE GOD ROLL</span>
          </div>
          <div class="gr-perks-list">
            <div class="gr-perk-row"><span class="perk-label">Barrel</span><span class="perk-val">${pve.barrel || 'User choice'}</span></div>
            <div class="gr-perk-row"><span class="perk-label">Mag</span><span class="perk-val">${pve.mag || 'User choice'}</span></div>
            <div class="gr-perk-row highlight"><span class="perk-label">Trait 1</span><span class="perk-val primary">${pve.perk1 || 'User choice'}</span></div>
            <div class="gr-perk-row highlight"><span class="perk-label">Trait 2</span><span class="perk-val primary">${pve.perk2 || 'User choice'}</span></div>
            <div class="gr-perk-row"><span class="perk-label">Masterwork</span><span class="perk-val mw">${pve.masterwork || 'Reload Speed'}</span></div>
          </div>
          ${pve.notes ? `<div class="gr-insight-note">"${pve.notes}"</div>` : ''}
        </div>

        <div class="gr-roll-box pvp-box">
          <div class="gr-box-header">
            <span class="gr-mode-icon">🎯</span>
            <span class="gr-mode-title">PVP GOD ROLL</span>
          </div>
          <div class="gr-perks-list">
            <div class="gr-perk-row"><span class="perk-label">Barrel</span><span class="perk-val">${pvp.barrel || 'Hammer-Forged'}</span></div>
            <div class="gr-perk-row"><span class="perk-label">Mag</span><span class="perk-val">${pvp.mag || 'Accurized Rounds'}</span></div>
            <div class="gr-perk-row highlight"><span class="perk-label">Trait 1</span><span class="perk-val primary-pvp">${pvp.perk1 || 'User choice'}</span></div>
            <div class="gr-perk-row highlight"><span class="perk-label">Trait 2</span><span class="perk-val primary-pvp">${pvp.perk2 || 'User choice'}</span></div>
            <div class="gr-perk-row"><span class="perk-label">Masterwork</span><span class="perk-val mw">${pvp.masterwork || 'Range'}</span></div>
          </div>
          ${pvp.notes ? `<div class="gr-insight-note">"${pvp.notes}"</div>` : ''}
        </div>
      </div>

      <div class="gr-card-footer">
        <button class="btn-gr-action btn-gr-ask" title="Consult F.E.L.I.C.I.A. on this weapon">
          <span>🗣️ Consult F.E.L.I.C.I.A.</span>
        </button>
        <button class="btn-gr-action btn-gr-edit" title="Edit God Roll info">
          <span>✏️ Edit</span>
        </button>
      </div>
    `;

    card.querySelector('.btn-gr-ask').addEventListener('click', () => {
      switchTab('tab-comms');
      const prompt = `What are the God Rolls and best perk combinations for '${weapon.name}' (${weapon.slot} ${weapon.element} ${weapon.type})? How should I build around it for PVE and PVP?`;
      const input = document.getElementById('chatInput');
      if (input) input.value = prompt;
      sendChatMessage(prompt);
    });

    card.querySelector('.btn-gr-edit').addEventListener('click', () => {
      pendingGodRollData = weapon;
      promptSecurityClearance(
        'edit_godroll',
        'RESTRICTED ARMORY ROLL EDIT',
        `Enter Clan Authorization Code (3354242) to edit the verified god roll data for '${weapon.name}'.`
      );
    });

    grid.appendChild(card);
  });
}

function openEditGodRollModal(weapon = null) {
  const modal = document.getElementById('modalEditGodRoll');
  const titleEl = document.getElementById('editGodRollModalTitle');
  if (!modal) return;

  document.getElementById('editRollId').value = weapon?.id || '';
  document.getElementById('rollWeaponName').value = weapon?.name || '';
  document.getElementById('rollSource').value = weapon?.source || '';
  document.getElementById('rollSlot').value = weapon?.slot || 'Kinetic';
  document.getElementById('rollType').value = weapon?.type || 'Hand Cannon';
  document.getElementById('rollElement').value = weapon?.element || 'Kinetic';
  document.getElementById('rollFrame').value = weapon?.frame || '';

  document.getElementById('pveBarrel').value = weapon?.pve?.barrel || '';
  document.getElementById('pveMag').value = weapon?.pve?.mag || '';
  document.getElementById('pvePerk1').value = weapon?.pve?.perk1 || '';
  document.getElementById('pvePerk2').value = weapon?.pve?.perk2 || '';
  document.getElementById('pveMasterwork').value = weapon?.pve?.masterwork || '';
  document.getElementById('pveNotes').value = weapon?.pve?.notes || '';

  document.getElementById('pvpBarrel').value = weapon?.pvp?.barrel || '';
  document.getElementById('pvpMag').value = weapon?.pvp?.mag || '';
  document.getElementById('pvpPerk1').value = weapon?.pvp?.perk1 || '';
  document.getElementById('pvpPerk2').value = weapon?.pvp?.perk2 || '';
  document.getElementById('pvpMasterwork').value = weapon?.pvp?.masterwork || '';
  document.getElementById('pvpNotes').value = weapon?.pvp?.notes || '';

  if (titleEl) {
    titleEl.textContent = weapon ? `✦ WEAPON ARMORY // EDIT '${weapon.name.toUpperCase()}'` : '✦ WEAPON ARMORY // ADD NEW WEAPON ROLL';
  }

  sfx.playChirp();
  modal.showModal();
}

/* ==========================================================================
   NAVIGATION & TAB SWITCHING WITH CLAN PASSCODE SECURITY
   ========================================================================== */
const CLAN_SECURITY_PASSCODE = '3354242';
let pendingSecurityAction = null;

function isClanAuthorized() {
  return sessionStorage.getItem('felicia_clan_auth') === 'true';
}

function promptSecurityClearance(action, subtitle, desc) {
  if (isClanAuthorized()) {
    if (action === 'settings') switchTabDirect('tab-settings');
    if (action === 'add_wiki') document.getElementById('modalAddWiki')?.showModal();
    if (action === 'edit_godroll') openEditGodRollModal(pendingGodRollData);
    return;
  }
  pendingSecurityAction = action;
  const modal = document.getElementById('modalSecurityPasscode');
  const input = document.getElementById('inputSecurityPasscode');
  const err = document.getElementById('passcodeErrorMsg');
  const sub = document.getElementById('passcodeContextSubtitle');
  const descEl = document.getElementById('passcodeDescriptionText');
  if (sub) sub.textContent = subtitle || 'RESTRICTED VANGUARD SECURITY PROTOCOL';
  if (descEl) descEl.textContent = desc || 'Please enter the Clan Authorization Code to proceed.';
  if (input) {
    input.value = '';
    input.classList.remove('passcode-shake');
  }
  if (err) err.style.display = 'none';
  if (modal) {
    try { try { sfx.playAlert(); } catch(e) {} } catch(e) {}
    try {
      if (typeof modal.showModal === 'function') {
        modal.showModal();
      } else {
        modal.setAttribute('open', '');
      }
    } catch(e) {
      modal.setAttribute('open', '');
    }
    setTimeout(() => input?.focus(), 100);
  }
}

function switchTabDirect(tabId) {
  state.currentTab = tabId;
  sfx.playChirp();

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === tabId);
  });
}

function switchTab(tabId) {
  if (tabId === 'tab-settings' && !isClanAuthorized()) {
    promptSecurityClearance(
      'settings',
      'RESTRICTED ADMIN SETTINGS & API CREDENTIALS',
      'Firebase API Keys, App IDs, and the Gemini AI engine are restricted. Enter the Clan Authorization Code to access Admin Settings.'
    );
    return;
  }
  switchTabDirect(tabId);
}

/* ==========================================================================
   MOBILE CONNECT (QR CODE & NETWORK IP)
   ========================================================================== */
async function loadMobileConnectInfo() {
  try {
    const res = await fetch('/api/network');
    const data = await res.json();
    const qrImg = document.getElementById('qrImage');
    const urlInput = document.getElementById('mobileUrlInput');

    if (qrImg && data.qr_code) {
      qrImg.src = data.qr_code;
    }
    if (urlInput && data.mobile_url) {
      urlInput.value = data.mobile_url;
    }
    const clanBox = document.getElementById('clanTunnelBox');
    const clanInput = document.getElementById('clanUrlInput');
    if (data.public_url) {
      if (clanBox) clanBox.style.display = 'block';
      if (clanInput) clanInput.value = data.public_url;
    }
  } catch (err) {
    console.error('Failed to load network info:', err);
  }
}

/* ==========================================================================
   SPEECH RECOGNITION (VOICE INPUT)
   ========================================================================== */
function initSpeechRecognition() {
  const micBtn = document.getElementById('btnVoiceInput');
  const chatInput = document.getElementById('chatInput');
  if (!micBtn || !chatInput) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.title = "Speech recognition is not supported in this browser.";
    return;
  }

  const recognizer = new SpeechRecognition();
  recognizer.continuous = false;
  recognizer.interimResults = false;
  recognizer.lang = 'en-GB'; // Scottish / UK English dialect preference

  let isListening = false;

  micBtn.addEventListener('click', () => {
    sfx.playChirp();
    if (!isListening) {
      try {
        recognizer.start();
        isListening = true;
        micBtn.classList.add('recording');
        updateConstructMood('LISTENING // VOICE INPUT CAPTURE');
      } catch (e) {}
    } else {
      recognizer.stop();
      isListening = false;
      micBtn.classList.remove('recording');
      updateConstructMood('STATUS: STANDBY // SCANNING');
    }
  });

  recognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    chatInput.value = transcript;
    micBtn.classList.remove('recording');
    isListening = false;
    updateConstructMood('VOICE CAPTURED // READY TO TRANSMIT');
  };

  recognizer.onerror = () => {
    micBtn.classList.remove('recording');
    isListening = false;
    updateConstructMood('STATUS: STANDBY // SCANNING');
  };

  recognizer.onend = () => {
    micBtn.classList.remove('recording');
    isListening = false;
  };
}

/* ==========================================================================
   INITIALIZATION & EVENT LISTENERS
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Canvas
  ghostRenderer = new GhostCanvasRenderer('ghostCanvas');

  // Navigation Tabs
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Sound Toggle
  const btnSound = document.getElementById('btnSoundToggle');
  const sfxIcon = document.getElementById('sfxIcon');
  if (btnSound) {
    btnSound.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      sfxIcon.textContent = state.soundEnabled ? '🔊' : '🔇';
      if (state.soundEnabled) sfx.playChirp();
    });
  }

  // Mobile Connect Button
  const btnConnect = document.getElementById('btnConnectDevice');
  const modalConnect = document.getElementById('modalMobileConnect');
  const btnCloseConnect = document.getElementById('btnCloseConnect');
  if (btnConnect && modalConnect) {
    btnConnect.addEventListener('click', () => {
      sfx.playChirp();
      loadMobileConnectInfo();
      modalConnect.showModal();
    });
    if (btnCloseConnect) {
      btnCloseConnect.addEventListener('click', () => modalConnect.close());
    }
  }

  // Copy mobile URL
  const btnCopyUrl = document.getElementById('btnCopyUrl');
  if (btnCopyUrl) {
    btnCopyUrl.addEventListener('click', () => {
      const input = document.getElementById('mobileUrlInput');
      if (input) {
        input.select();
        navigator.clipboard.writeText(input.value);
        btnCopyUrl.textContent = 'Copied!';
        setTimeout(() => { btnCopyUrl.textContent = 'Copy'; }, 2000);
      }
    });
  }

  // Copy Clan URL
  const btnCopyClanUrl = document.getElementById('btnCopyClanUrl');
  if (btnCopyClanUrl) {
    btnCopyClanUrl.addEventListener('click', () => {
      const input = document.getElementById('clanUrlInput');
      if (input) {
        input.select();
        navigator.clipboard.writeText(input.value);
        sfx.playReceive();
        btnCopyClanUrl.textContent = 'Copied!';
        setTimeout(() => { btnCopyClanUrl.textContent = 'Copy Link'; }, 2000);
      }
    });
  }

  // Guardian Class selector buttons
  document.querySelectorAll('.btn-class').forEach(btn => {
    btn.addEventListener('click', () => {
      sfx.playChirp();
      document.querySelectorAll('.btn-class').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.guardianClass = btn.dataset.class;
    });
  });

  // Operational Activity & Tactical Inquiries
  const selectActivity = document.getElementById('selectActivity');
  const selectTacticalInquiry = document.getElementById('selectTacticalInquiry');
  const btnAskInquiry = document.getElementById('btnAskInquiry');

  function populateInquiries(activity) {
    if (!selectTacticalInquiry) return;
    selectTacticalInquiry.innerHTML = '';
    const items = ACTIVITY_INQUIRIES[activity] || ACTIVITY_INQUIRIES['Grandmaster+'];
    items.forEach((item, index) => {
      const opt = document.createElement('option');
      opt.value = item;
      opt.textContent = item;
      if (index === 0) opt.selected = true;
      selectTacticalInquiry.appendChild(opt);
    });
    state.tacticalInquiry = items[0] || '';
  }

  if (selectActivity) {
    selectActivity.addEventListener('change', (e) => {
      sfx.playChirp();
      state.activity = e.target.value;
      populateInquiries(state.activity);
    });
    // Initial population on page load
    populateInquiries(selectActivity.value || state.activity);
  }

  if (selectTacticalInquiry) {
    selectTacticalInquiry.addEventListener('change', (e) => {
      sfx.playChirp();
      state.tacticalInquiry = e.target.value;
    });
  }

  if (btnAskInquiry) {
    btnAskInquiry.addEventListener('click', () => {
      sfx.playTransmit();
      const prompt = `F.E.L.I.C.I.A., evaluate and craft the best ${state.subclass.toUpperCase()} ${state.guardianClass} build for ${state.activity} with a focus on ${state.tacticalInquiry}.`;
      const chatInput = document.getElementById('chatInput');
      if (chatInput) {
        chatInput.value = prompt;
      }
      sendChatMessage(prompt);
    });
  }

  // Subclass Filter Chips (Stasis, Void, Arc, Solar, Strand, Prismatic)
  document.querySelectorAll('.subclass-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      sfx.playChirp();
      document.querySelectorAll('.subclass-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.subclass = chip.dataset.subclass || 'solar';
      state.shader = chip.dataset.shader || state.subclass;
    });
  });

  // Design Switcher in Settings
  document.querySelectorAll('.design-card').forEach(card => {
    card.addEventListener('click', () => {
      sfx.playChirp();
      document.querySelectorAll('.design-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      state.design = card.dataset.design;
      const badge = document.getElementById('designNameBadge');
      if (badge) {
        badge.textContent = state.design === 'ghost' ? 'VANGUARD GHOST' : 'EXO TACTICAL MATRIX';
      }
    });
  });

  // Chat Form Submission
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = chatInput.value;
      chatInput.value = '';
      sendChatMessage(val);
    });
  }

  // Quick Prompt chips
  document.querySelectorAll('.chip-prompt').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      if (chatInput) chatInput.value = prompt;
      sendChatMessage(prompt);
    });
  });

  // Clear Chat History
  const btnClear = document.getElementById('btnClearHistory');
  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      if (confirm('Clear encrypted comms screen?')) {
        state.chatHistory = [];
        await fetch('/api/history', { method: 'DELETE' });
        const container = document.getElementById('messagesContainer');
        if (container) {
          container.innerHTML = `
            <div class="message-row felicia">
              <div class="msg-avatar"><div class="ghost-mini-core"></div></div>
              <div class="msg-bubble">
                <div class="msg-header">
                  <span class="msg-sender">F.E.L.I.C.I.A.</span>
                  <span class="msg-tag">SCOTTISH CONSTRUCT</span>
                </div>
                <div class="msg-content">Comms screen cleared, Guardian! What's next on our agenda?</div>
              </div>
            </div>
          `;
        }
      }
    });
  }

  // Wiki Filter categories
  document.querySelectorAll('.cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      sfx.playChirp();
      document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const search = document.getElementById('wikiSearchInput').value;
      renderWikiGrid(pill.dataset.cat, search);
    });
  });

  // Wiki Search input
  const wikiSearch = document.getElementById('wikiSearchInput');
  if (wikiSearch) {
    wikiSearch.addEventListener('input', (e) => {
      const activePill = document.querySelector('.cat-pill.active');
      const cat = activePill ? activePill.dataset.cat : 'all';
      renderWikiGrid(cat, e.target.value);
    });
  }

  // Security Passcode Modal Handlers
  const modalSecurityPasscode = document.getElementById('modalSecurityPasscode');
  const formSecurityPasscode = document.getElementById('formSecurityPasscode');
  const inputSecurityPasscode = document.getElementById('inputSecurityPasscode');
  const btnCloseSecurityPasscode = document.getElementById('btnCloseSecurityPasscode');
  const btnCancelSecurityPasscode = document.getElementById('btnCancelSecurityPasscode');
  const passcodeErrorMsg = document.getElementById('passcodeErrorMsg');

  [btnCloseSecurityPasscode, btnCancelSecurityPasscode].forEach(b => {
    if (b && modalSecurityPasscode) {
      b.addEventListener('click', () => {
        modalSecurityPasscode.close();
        pendingSecurityAction = null;
      });
    }
  });

  if (formSecurityPasscode) {
    formSecurityPasscode.addEventListener('submit', (e) => {
      e.preventDefault();
      const enteredCode = (inputSecurityPasscode.value || '').trim();
      if (enteredCode === CLAN_SECURITY_PASSCODE) {
        sessionStorage.setItem('felicia_clan_auth', 'true');
        sfx.playReceive();
        modalSecurityPasscode.close();
        const action = pendingSecurityAction;
        pendingSecurityAction = null;
        if (action === 'settings') {
          switchTabDirect('tab-settings');
        } else if (action === 'add_wiki') {
          document.getElementById('modalAddWiki')?.showModal();
        } else if (action === 'edit_godroll') {
          openEditGodRollModal(pendingGodRollData);
        }
      } else {
        try { sfx.playAlert(); } catch(e) {}
        if (passcodeErrorMsg) passcodeErrorMsg.style.display = 'block';
        inputSecurityPasscode.classList.remove('passcode-shake');
        void inputSecurityPasscode.offsetWidth;
        inputSecurityPasscode.classList.add('passcode-shake');
        inputSecurityPasscode.value = '';
        inputSecurityPasscode.focus();
      }
    });
  }

  // Add Wiki / Guide Modal (Passcode Protected)
  const modalAddWiki = document.getElementById('modalAddWiki');
  const btnOpenAddWiki = document.getElementById('btnOpenAddWiki');
  const btnCloseAddWiki = document.getElementById('btnCloseAddWiki');
  const btnCancelAddWiki = document.getElementById('btnCancelAddWiki');
  const formAddWiki = document.getElementById('formAddWiki');

  if (btnOpenAddWiki && modalAddWiki) {
    btnOpenAddWiki.addEventListener('click', () => {
      sfx.playChirp();
      if (!isClanAuthorized()) {
        promptSecurityClearance(
          'add_wiki',
          'VERIFIED GUIDE CREATION AUTHORIZATION',
          'Only authorized clan members may contribute verified weapon and encounter guides. Enter the Clan Authorization Code to add an entry.'
        );
        return;
      }
      modalAddWiki.showModal();
    });
    [btnCloseAddWiki, btnCancelAddWiki].forEach(b => {
      if (b) b.addEventListener('click', () => modalAddWiki.close());
    });
    if (formAddWiki) {
      formAddWiki.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('newWikiTitle').value;
        const category = document.getElementById('newWikiCategory').value;
        const tags = document.getElementById('newWikiTags').value.split(',').map(t => t.trim()).filter(Boolean);
        const summary = document.getElementById('newWikiSummary').value;
        const content = document.getElementById('newWikiContent').value;

        try {
          const res = await fetch('/api/wiki', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, category, tags, summary, content })
          });
          const data = await res.json();
          if (data.status === 'success') {
            state.wikiList.push(data.entry);
            renderWikiGrid();
            modalAddWiki.close();
            formAddWiki.reset();
            sfx.playReceive();
            alert(`Guide '${title}' archived successfully!`);
          }
        } catch (err) {
          alert('Failed to save guide: ' + err.message);
        }
      });
    }
  }

  // =========================================================================
  // UPGRADED BUILD CRAFTER (STAT SLIDERS & WEAPONS)
  // =========================================================================
  const modalAddBuild = document.getElementById('modalAddBuild');
  const btnOpenAddBuild = document.getElementById('btnOpenAddBuild');
  const btnCloseAddBuild = document.getElementById('btnCloseAddBuild');
  const btnCancelAddBuild = document.getElementById('btnCancelAddBuild');
  const formAddBuild = document.getElementById('formAddBuild');

  // Live Stat Slider Badges (0-200 modern system)
  const statSliders = [
    { inputId: 'statHealth', badgeId: 'tierHealthBadge' },
    { inputId: 'statMelee', badgeId: 'tierMeleeBadge' },
    { inputId: 'statGrenade', badgeId: 'tierGrenadeBadge' },
    { inputId: 'statSuper', badgeId: 'tierSuperBadge' },
    { inputId: 'statClass', badgeId: 'tierClassBadge' },
    { inputId: 'statWeapons', badgeId: 'tierWeaponsBadge' }
  ];

  statSliders.forEach(s => {
    const el = document.getElementById(s.inputId);
    const badge = document.getElementById(s.badgeId);
    if (el && badge) {
      el.addEventListener('input', () => {
        const val = parseInt(el.value);
        badge.textContent = `${val} / 200`;
      });
    }
  });

  if (btnOpenAddBuild && modalAddBuild) {
    btnOpenAddBuild.addEventListener('click', () => {
      sfx.playChirp();
      modalAddBuild.showModal();
    });
    [btnCloseAddBuild, btnCancelAddBuild].forEach(b => {
      if (b) b.addEventListener('click', () => modalAddBuild.close());
    });
    if (formAddBuild) {
      formAddBuild.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const healthVal = parseInt(document.getElementById('statHealth')?.value || 100);
        const meleeVal = parseInt(document.getElementById('statMelee')?.value || 60);
        const grenadeVal = parseInt(document.getElementById('statGrenade')?.value || 100);
        const superVal = parseInt(document.getElementById('statSuper')?.value || 40);
        const classVal = parseInt(document.getElementById('statClass')?.value || 80);
        const weaponsVal = parseInt(document.getElementById('statWeapons')?.value || 100);

        const kineticWeapon = {
          name: document.getElementById('buildKinetic')?.value || 'Primary Weapon',
          archetype: document.getElementById('buildKineticFrame')?.value || '',
          perks: document.getElementById('buildKineticPerks')?.value || ''
        };
        const energyWeapon = {
          name: document.getElementById('buildEnergy')?.value || 'Energy Weapon',
          archetype: document.getElementById('buildEnergyFrame')?.value || '',
          perks: document.getElementById('buildEnergyPerks')?.value || ''
        };
        const heavyWeapon = {
          name: document.getElementById('buildHeavy')?.value || 'Power Weapon',
          archetype: document.getElementById('buildHeavyFrame')?.value || '',
          perks: document.getElementById('buildHeavyPerks')?.value || ''
        };

        const newBuild = {
          name: document.getElementById('buildTitle').value,
          title: document.getElementById('buildTitle').value,
          guardianClass: document.getElementById('buildClass').value,
          guardian_class: document.getElementById('buildClass').value,
          subclass: document.getElementById('buildSubclass').value,
          exoticArmor: document.getElementById('buildExoticArmor').value,
          exotic_armor: document.getElementById('buildExoticArmor').value,
          kinetic_weapon: kineticWeapon.name,
          energy_weapon: energyWeapon.name,
          heavy_weapon: heavyWeapon.name,
          keyAspects: document.getElementById('buildAspects').value,
          key_aspects_fragments: document.getElementById('buildAspects').value,
          notes: document.getElementById('buildNotes').value,
          stats: {
            health: healthVal,
            melee: meleeVal,
            grenade: grenadeVal,
            super: superVal,
            classStat: classVal,
            weapons: weaponsVal
          },
          weapons: {
            kinetic: kineticWeapon,
            energy: energyWeapon,
            heavy: heavyWeapon
          }
        };

        try {
          // If user is signed in to Firebase, save to Cloud Firestore!
          if (state.currentUser) {
            const savedDoc = await saveFirestoreLoadout(state.currentUser.uid, newBuild);
            newBuild.id = savedDoc.id;
          }

          // Always sync to local server API
          const res = await fetch('/api/builds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newBuild)
          });
          const data = await res.json();
          if (!newBuild.id && data.build?.id) {
            newBuild.id = data.build.id;
          }

          state.buildsList.unshift(newBuild);
          renderBuildsGrid();
          modalAddBuild.close();
          formAddBuild.reset();
          sfx.playReceive();

          const syncStatus = state.currentUser ? 'Synced to Cloud Firestore (ping-vault-matrix)!' : 'Saved locally (Sign in to sync across devices)!';
          alert(`Build '${newBuild.title}' stored in Vault! ${syncStatus}`);
        } catch (err) {
          alert('Failed to save build: ' + err.message);
        }
      });
    }
  }

  // Dismiss Wiki View Modal
  const btnCloseView = document.getElementById('btnCloseViewWiki');
  const btnDismissView = document.getElementById('btnDismissViewWiki');
  const modalView = document.getElementById('modalViewWiki');
  [btnCloseView, btnDismissView].forEach(b => {
    if (b && modalView) b.addEventListener('click', () => modalView.close());
  });

  // Speech Settings Sliders & Auto-speak Toggle
  const checkAutoSpeak = document.getElementById('checkAutoSpeak');
  if (checkAutoSpeak) {
    checkAutoSpeak.addEventListener('change', (e) => {
      state.autoSpeak = e.target.checked;
    });
  }

  const voiceRate = document.getElementById('voiceRate');
  const rateVal = document.getElementById('rateVal');
  if (voiceRate && rateVal) {
    voiceRate.addEventListener('input', (e) => {
      state.voiceRate = parseFloat(e.target.value);
      rateVal.textContent = state.voiceRate.toFixed(2);
    });
  }

  const voicePitch = document.getElementById('voicePitch');
  const pitchVal = document.getElementById('pitchVal');
  if (voicePitch && pitchVal) {
    voicePitch.addEventListener('input', (e) => {
      state.voicePitch = parseFloat(e.target.value);
      pitchVal.textContent = state.voicePitch.toFixed(2);
    });
  }

  // =========================================================================
  // FIREBASE AUTHENTICATION MODAL & LOGISTICS WIRING
  // =========================================================================
  const modalAuth = document.getElementById('modalAuth');
  const authBadge = document.getElementById('authBadge');
  const btnOpenAuthModal = document.getElementById('btnOpenAuthModal');
  const btnCloseAuth = document.getElementById('btnCloseAuth');
  const btnDismissAuth = document.getElementById('btnDismissAuth');

  const openAuth = () => {
    sfx.playChirp();
    if (modalAuth) modalAuth.showModal();
  };

  if (authBadge) authBadge.addEventListener('click', openAuth);
  if (btnOpenAuthModal) btnOpenAuthModal.addEventListener('click', openAuth);
  [btnCloseAuth, btnDismissAuth].forEach(b => {
    if (b && modalAuth) b.addEventListener('click', () => modalAuth.close());
  });

  // Auth Tabs (Google, Email, Phone)
  const authTabBtns = document.querySelectorAll('.auth-tab-btn');
  authTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sfx.playChirp();
      const targetId = btn.dataset.authtab;
      authTabBtns.forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.auth-tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === targetId);
      });
    });
  });

  // Friendly helper for Firebase Authentication error codes
  function formatAuthErrorMessage(err, providerName) {
    providerName = providerName || 'Sign-In';
    const msg = (err && err.message) ? err.message : String(err);
    if (msg.indexOf('auth/operation-not-allowed') !== -1) {
      return providerName + ' Sign-In is not enabled yet in your Firebase Project (ping-vault-matrix)!\n\n' +
        'To enable it in 10 seconds:\n' +
        '1. Open Firebase Console: https://console.firebase.google.com/project/ping-vault-matrix/authentication/providers\n' +
        '2. Under Sign-in method, click ' + providerName + '\n' +
        '3. Toggle Enable and click Save.';
    }
    if (msg.indexOf('auth/unauthorized-domain') !== -1) {
      const host = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : 'localhost';
      return 'The current host/domain (' + host + ') is not in Firebase Authorized Domains!\n\n' +
        'To authorize it:\n' +
        '1. Open Firebase Console: https://console.firebase.google.com/project/ping-vault-matrix/authentication/settings\n' +
        '2. Under Authorized domains, click Add domain\n' +
        '3. Add ' + host + ' and click Save.';
    }
    if (msg.indexOf('auth/popup-blocked') !== -1) {
      return 'The sign-in popup was blocked by your browser. Please allow popups for this site and try again.';
    }
    if (msg.indexOf('auth/popup-closed-by-user') !== -1) {
      return 'Sign-in popup was closed before completing.';
    }
    return providerName + ' Error: ' + msg;
  }

  // 1. Google Sign-In
  const btnGoogleSignIn = document.getElementById('btnGoogleSignIn');
  if (btnGoogleSignIn) {
    btnGoogleSignIn.addEventListener('click', async () => {
      sfx.playTransmit();
      try {
        const user = await loginWithGoogle();
        sfx.playReceive();
        alert(`Welcome, ${user.displayName || 'Guardian'}! Signed in with Google. Cloud Firestore connected to ping-vault-matrix.`);
        if (modalAuth) modalAuth.close();
      } catch (err) {
        console.error('[Google Sign-In Error]', err);
        alert(formatAuthErrorMessage(err, 'Google'));
      }
    });
  }

  // 2. Email & Password Sign-In / Register
  const formEmailAuth = document.getElementById('formEmailAuth');
  const btnToggleEmailMode = document.getElementById('btnToggleEmailMode');
  const emailModeTitle = document.getElementById('emailModeTitle');
  const groupPasswordConfirm = document.getElementById('groupPasswordConfirm');
  const btnSubmitEmailAuth = document.getElementById('btnSubmitEmailAuth');
  const emailAuthError = document.getElementById('emailAuthError');

  if (btnToggleEmailMode) {
    btnToggleEmailMode.addEventListener('click', () => {
      sfx.playChirp();
      if (state.emailAuthMode === 'signin') {
        state.emailAuthMode = 'signup';
        emailModeTitle.textContent = 'Create Fireteam Vault Account';
        btnSubmitEmailAuth.textContent = 'Register New Account';
        btnToggleEmailMode.textContent = 'Already registered? Sign In';
        groupPasswordConfirm.classList.remove('hidden');
      } else {
        state.emailAuthMode = 'signin';
        emailModeTitle.textContent = 'Sign In to Fireteam Vault';
        btnSubmitEmailAuth.textContent = 'Sign In with Email';
        btnToggleEmailMode.textContent = 'Need an account? Register';
        groupPasswordConfirm.classList.add('hidden');
      }
      if (emailAuthError) emailAuthError.classList.add('hidden');
    });
  }

  if (formEmailAuth) {
    formEmailAuth.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('emailInput').value.trim();
      const password = document.getElementById('passwordInput').value;
      if (emailAuthError) emailAuthError.classList.add('hidden');

      try {
        if (state.emailAuthMode === 'signup') {
          const confirmPassword = document.getElementById('passwordConfirmInput').value;
          if (password !== confirmPassword) {
            throw new Error('Passwords do not match. Please verify your entries.');
          }
          if (password.length < 6) {
            throw new Error('Password must be at least 6 characters long.');
          }
          await signUpWithEmail(email, password);
          sfx.playReceive();
          alert(`Account created successfully for ${email}!`);
        } else {
          await loginWithEmail(email, password);
          sfx.playReceive();
          alert(`Welcome back, Guardian! Signed in as ${email}.`);
        }
        if (modalAuth) modalAuth.close();
      } catch (err) {
        if (emailAuthError) {
          emailAuthError.textContent = formatAuthErrorMessage(err, 'Email');
          emailAuthError.classList.remove('hidden');
        } else {
          alert('Authentication Error: ' + err.message);
        }
      }
    });
  }

  // 3. Phone Number Authentication (SMS)
  const btnSendPhoneCode = document.getElementById('btnSendPhoneCode');
  const btnVerifyPhoneCode = document.getElementById('btnVerifyPhoneCode');
  const btnBackToPhoneStep1 = document.getElementById('btnBackToPhoneStep1');
  const phoneStep1 = document.getElementById('phoneStep1');
  const phoneStep2 = document.getElementById('phoneStep2');
  const phoneAuthError = document.getElementById('phoneAuthError');
  const phoneCodeError = document.getElementById('phoneCodeError');

  if (btnSendPhoneCode) {
    btnSendPhoneCode.addEventListener('click', async () => {
      const phoneNumber = document.getElementById('phoneNumberInput').value.trim();
      if (!phoneNumber) {
        alert('Please enter a phone number in E.164 format (e.g. +1 555-019-2834).');
        return;
      }
      if (phoneAuthError) phoneAuthError.classList.add('hidden');

      btnSendPhoneCode.disabled = true;
      btnSendPhoneCode.textContent = 'Verifying Recaptcha & Sending SMS...';

      try {
        await sendPhoneVerificationCode(phoneNumber, 'recaptcha-container');
        phoneStep1.classList.add('hidden');
        phoneStep2.classList.remove('hidden');
        sfx.playReceive();
        alert(`Verification code sent to ${phoneNumber}! Check your mobile device.`);
      } catch (err) {
        console.error('[Phone Auth Error]', err);
        if (phoneAuthError) {
          phoneAuthError.textContent = formatAuthErrorMessage(err, 'Phone');
          phoneAuthError.classList.remove('hidden');
        } else {
          alert('Phone Auth Error: ' + err.message);
        }
      } finally {
        btnSendPhoneCode.disabled = false;
        btnSendPhoneCode.textContent = 'Send SMS Verification Code';
      }
    });
  }

  if (btnVerifyPhoneCode) {
    btnVerifyPhoneCode.addEventListener('click', async () => {
      const code = document.getElementById('phoneVerificationCode').value.trim();
      if (!code || code.length < 6) {
        alert('Please enter the 6-digit SMS verification code.');
        return;
      }
      if (phoneCodeError) phoneCodeError.classList.add('hidden');

      btnVerifyPhoneCode.disabled = true;
      btnVerifyPhoneCode.textContent = 'Verifying Code...';

      try {
        const user = await verifyPhoneSmsCode(code);
        sfx.playReceive();
        alert(`Phone verified! Signed in as ${user.phoneNumber}.`);
        if (modalAuth) modalAuth.close();
      } catch (err) {
        console.error('[SMS Code Error]', err);
        if (phoneCodeError) {
          phoneCodeError.textContent = err.message;
          phoneCodeError.classList.remove('hidden');
        } else {
          alert('Verification Error: ' + err.message);
        }
      } finally {
        btnVerifyPhoneCode.disabled = false;
        btnVerifyPhoneCode.textContent = 'Verify & Sign In';
      }
    });
  }

  if (btnBackToPhoneStep1) {
    btnBackToPhoneStep1.addEventListener('click', () => {
      phoneStep2.classList.add('hidden');
      phoneStep1.classList.remove('hidden');
    });
  }

  // 4. Sign Out
  const btnSignOut = document.getElementById('btnSignOut');
  if (btnSignOut) {
    btnSignOut.addEventListener('click', async () => {
      if (confirm('Sign out of Firebase?')) {
        await logoutUser();
        sfx.playChirp();
        alert('Signed out of Firebase.');
      }
    });
  }

  // 5. Change Guardian Call-Sign / Username
  const btnEditCallsign = document.getElementById('btnEditCallsign');
  const profileEditBox = document.getElementById('profileEditBox');
  const inputNewCallsign = document.getElementById('inputNewCallsign');
  const btnSaveCallsign = document.getElementById('btnSaveCallsign');
  const btnCancelCallsign = document.getElementById('btnCancelCallsign');

  if (btnEditCallsign && profileEditBox) {
    btnEditCallsign.addEventListener('click', () => {
      sfx.playChirp();
      profileEditBox.classList.toggle('hidden');
      if (!profileEditBox.classList.contains('hidden') && inputNewCallsign) {
        inputNewCallsign.value = state.currentUser?.displayName || 'Guardian';
        inputNewCallsign.focus();
      }
    });
  }

  if (btnCancelCallsign && profileEditBox) {
    btnCancelCallsign.addEventListener('click', () => {
      profileEditBox.classList.add('hidden');
    });
  }

  if (btnSaveCallsign && profileEditBox) {
    btnSaveCallsign.addEventListener('click', async () => {
      const newName = inputNewCallsign?.value.trim();
      if (!newName) {
        alert('Please enter a valid Guardian call-sign.');
        return;
      }
      btnSaveCallsign.disabled = true;
      btnSaveCallsign.textContent = 'Saving...';
      try {
        await updateUserCallsign(newName);
        const profileNameEl = document.getElementById('profileName');
        const authStatusTextEl = document.getElementById('authStatusText');
        if (profileNameEl) profileNameEl.textContent = newName;
        if (authStatusTextEl) authStatusTextEl.textContent = newName;
        profileEditBox.classList.add('hidden');
        sfx.playReceive();
        alert(`Guardian call-sign updated to '${newName}'!`);
      } catch (err) {
        console.error('[Call-sign error]', err);
        alert('Failed to update call-sign: ' + err.message);
      } finally {
        btnSaveCallsign.disabled = false;
        btnSaveCallsign.textContent = 'Save Call-sign';
      }
    });
  }

  // 6. Host Firebase Web Config in Logistics Tab (Auto-distributed to all members!)
  const inputFirebaseApiKey = document.getElementById('inputFirebaseApiKey');
  const inputFirebaseAppId = document.getElementById('inputFirebaseAppId');
  const btnSaveFirebaseWebConfig = document.getElementById('btnSaveFirebaseWebConfig');

  // Fetch host server config on load
  fetchServerFirebaseConfig().then(cfg => {
    if (cfg && cfg.apiKey) {
      if (inputFirebaseApiKey) inputFirebaseApiKey.value = cfg.apiKey;
      if (inputFirebaseAppId && cfg.appId) inputFirebaseAppId.value = cfg.appId;
      console.log('[Firebase] Project initialized for ping-vault-matrix with host credentials.');
    }
  });

  if (btnSaveFirebaseWebConfig) {
    btnSaveFirebaseWebConfig.addEventListener('click', async () => {
      const apiKey = inputFirebaseApiKey?.value.trim() || '';
      const appId = inputFirebaseAppId?.value.trim() || '';
      
      btnSaveFirebaseWebConfig.disabled = true;
      btnSaveFirebaseWebConfig.textContent = 'Saving to Server...';

      try {
        // Save to backend server so ANY connecting phone, iPad, or PC inherits it automatically!
        await fetch('/api/firebase/web-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey, appId, projectId: 'ping-vault-matrix' })
        });

        // Also save to client memory
        saveFirebaseConfig({ apiKey, appId, projectId: 'ping-vault-matrix' });
        sfx.playReceive();
        alert('Firebase configuration saved to server! All members on your network (phones, iPads, and PCs) will now automatically connect to ping-vault-matrix without entering any API keys!');
      } catch (err) {
        alert('Failed to save Firebase config: ' + err.message);
      } finally {
        btnSaveFirebaseWebConfig.disabled = false;
        btnSaveFirebaseWebConfig.textContent = 'Save Web App Config';
      }
    });
  }

  // Hide Mobile Connect QR button on mobile/iPad screens
  function updateMobileConnectVisibility() {
    const isMobileOrTablet = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 900;
    const btnConnect = document.getElementById('btnConnectDevice');
    if (btnConnect) {
      if (isMobileOrTablet) {
        btnConnect.style.display = 'none';
      } else {
        btnConnect.style.display = 'inline-flex';
      }
    }
  }
  updateMobileConnectVisibility();
  window.addEventListener('resize', updateMobileConnectVisibility);

  // Update Gemini Key
  const btnSaveGemini = document.getElementById('btnSaveGeminiKey');
  if (btnSaveGemini) {
    btnSaveGemini.addEventListener('click', async () => {
      const key = document.getElementById('inputGeminiKey').value;
      if (!key) return;
      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gemini_api_key: key })
        });
        alert('Gemini API key updated!');
      } catch (err) {
        alert('Failed to update key: ' + err.message);
      }
    });
  }

  // =========================================================================
  // GOD ROLL FINDER EVENT LISTENERS
  // =========================================================================
  const btnOpenAddGodRoll = document.getElementById('btnOpenAddGodRoll');
  const godRollSearchInput = document.getElementById('godRollSearchInput');
  const btnClearGodRollSearch = document.getElementById('btnClearGodRollSearch');
  const typeFilterSelect = document.getElementById('typeFilterSelect');
  const modalEditGodRoll = document.getElementById('modalEditGodRoll');
  const formEditGodRoll = document.getElementById('formEditGodRoll');
  const btnCloseEditGodRoll = document.getElementById('btnCloseEditGodRoll');
  const btnCancelEditGodRoll = document.getElementById('btnCancelEditGodRoll');

  // Open Add Weapon Roll
  if (btnOpenAddGodRoll) {
    btnOpenAddGodRoll.addEventListener('click', () => {
      pendingGodRollData = null;
      promptSecurityClearance(
        'edit_godroll',
        'RESTRICTED ARMORY DATA ENTRY',
        'Enter Clan Authorization Code (3354242) to add a new verified god roll to the armory.'
      );
    });
  }

  // Close / Cancel Add Roll Modal
  [btnCloseEditGodRoll, btnCancelEditGodRoll].forEach(b => {
    if (b && modalEditGodRoll) {
      b.addEventListener('click', () => {
        modalEditGodRoll.close();
      });
    }
  });

  // Save God Roll Form Submit
  if (formEditGodRoll) {
    formEditGodRoll.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rollId = document.getElementById('editRollId').value;
      const name = document.getElementById('rollWeaponName').value.trim();
      const source = document.getElementById('rollSource').value.trim();
      const slot = document.getElementById('rollSlot').value;
      const type = document.getElementById('rollType').value.trim();
      const element = document.getElementById('rollElement').value;
      const frame = document.getElementById('rollFrame').value.trim();

      const pve = {
        barrel: document.getElementById('pveBarrel').value.trim(),
        mag: document.getElementById('pveMag').value.trim(),
        perk1: document.getElementById('pvePerk1').value.trim(),
        perk2: document.getElementById('pvePerk2').value.trim(),
        masterwork: document.getElementById('pveMasterwork').value.trim() || 'Reload Speed',
        notes: document.getElementById('pveNotes').value.trim()
      };

      const pvp = {
        barrel: document.getElementById('pvpBarrel').value.trim(),
        mag: document.getElementById('pvpMag').value.trim(),
        perk1: document.getElementById('pvpPerk1').value.trim(),
        perk2: document.getElementById('pvpPerk2').value.trim(),
        masterwork: document.getElementById('pvpMasterwork').value.trim() || 'Range',
        notes: document.getElementById('pvpNotes').value.trim()
      };

      const payload = {
        id: rollId || undefined,
        name,
        source,
        slot,
        type,
        element,
        frame,
        pve,
        pvp
      };

      try {
        const res = await fetch('/api/godrolls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'success') {
          sfx.playReceive();
          modalEditGodRoll.close();
          await loadGodRolls();
        } else {
          alert('Failed to save god roll');
        }
      } catch (err) {
        console.error('Error saving god roll:', err);
        alert('Network error saving roll: ' + err.message);
      }
    });
  }

  // Live search input
  if (godRollSearchInput) {
    godRollSearchInput.addEventListener('input', (e) => {
      state.godRollsFilter.search = e.target.value;
      if (btnClearGodRollSearch) {
        btnClearGodRollSearch.style.display = e.target.value ? 'block' : 'none';
      }
      renderGodRollsGrid();
    });
  }

  if (btnClearGodRollSearch) {
    btnClearGodRollSearch.addEventListener('click', () => {
      if (godRollSearchInput) {
        godRollSearchInput.value = '';
        state.godRollsFilter.search = '';
        btnClearGodRollSearch.style.display = 'none';
        godRollSearchInput.focus();
        renderGodRollsGrid();
      }
    });
  }

  // Slot Filter Pills
  document.querySelectorAll('#slotFilters .pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#slotFilters .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.godRollsFilter.slot = btn.dataset.slot || 'all';
      sfx.playChirp();
      renderGodRollsGrid();
    });
  });

  // Weapon Type Select Filter
  if (typeFilterSelect) {
    typeFilterSelect.addEventListener('change', (e) => {
      state.godRollsFilter.type = e.target.value;
      sfx.playChirp();
      renderGodRollsGrid();
    });
  }

  // =========================================================================
  // FIREBASE AUTHENTICATION STATE OBSERVER
  // =========================================================================
  subscribeAuth(async (user) => {
    state.currentUser = user;
    const authBadgeEl = document.getElementById('authBadge');
    const authStatusTextEl = document.getElementById('authStatusText');
    const profileCardEl = document.getElementById('authProfileCard');
    const formsContainerEl = document.getElementById('authFormsContainer');
    const profileNameEl = document.getElementById('profileName');
    const profileContactEl = document.getElementById('profileContact');
    const profileUidEl = document.getElementById('profileUid');
    const profileAvatarEl = document.getElementById('profileAvatar');

    if (user) {
      if (authBadgeEl) authBadgeEl.classList.add('signed-in');
      const displayName = user.displayName || user.email || user.phoneNumber || 'Guardian';
      if (authStatusTextEl) authStatusTextEl.textContent = displayName.split('@')[0];
      if (profileNameEl) profileNameEl.textContent = user.displayName || 'Vanguard Guardian';
      if (profileContactEl) profileContactEl.textContent = user.email || user.phoneNumber || 'Verified Account';
      if (profileUidEl) profileUidEl.textContent = user.uid;
      if (profileAvatarEl) {
        if (user.photoURL) {
          profileAvatarEl.innerHTML = `<img src="${user.photoURL}" alt="Avatar">`;
        } else {
          profileAvatarEl.innerHTML = '🛡️';
        }
      }
      if (profileCardEl) profileCardEl.classList.remove('hidden');
      if (formsContainerEl) formsContainerEl.classList.add('hidden');

      // Reload builds from Cloud Firestore
      await loadBuilds();
    } else {
      if (authBadgeEl) authBadgeEl.classList.remove('signed-in');
      if (authStatusTextEl) authStatusTextEl.textContent = 'Sign In';
      if (profileCardEl) profileCardEl.classList.add('hidden');
      if (formsContainerEl) formsContainerEl.classList.remove('hidden');

      await loadBuilds();
    }
  });

  const btnLockAdmin = document.getElementById('btnLockAdmin');
  if (btnLockAdmin) {
    btnLockAdmin.addEventListener('click', () => {
      sessionStorage.removeItem('felicia_clan_auth');
      try { sfx.playAlert(); } catch(e) {}
      switchTabDirect('tab-comms');
      alert('Clan Administrator Mode locked. Security passcode required to re-enter Admin Settings.');
    });
  }

  initSpeechRecognition();
  loadWikiData();
  loadGodRolls();
  loadBuilds();
  loadMobileConnectInfo();
});
