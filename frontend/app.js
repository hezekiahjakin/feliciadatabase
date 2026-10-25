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
  currentTab: 'tab-inventory',
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
  emailAuthMode: 'signin', // 'signin' | 'signup'
  bungieSession: null,
  bungieData: null,
  activeInventoryView: null, // characterId or 'vault'
  invFilter: { search: '', slot: 'all' },
  scannerFilter: 'all',
  dismantleSelectedIds: new Set(),
  dismantleSelectionInitialized: false,
  dismantleTargetCharId: '',
  dupDrawerOpen: {},
  inspectedLoadout: null,
  loadoutsDrawerOpen: {},
  inspectedItem: null,
  lastAppraisalReply: ''
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
    const catLower = (item.category || '').toLowerCase();
    const catClass = isCustom ? `badge-cat custom ${catLower}` : `badge-cat ${catLower}`;
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
      if (searchQ === 'exotic' && (w.tier?.toLowerCase() === 'exotic' || w.template === 'exotic')) return true;
      const matchName = w.name?.toLowerCase().includes(searchQ);
      const matchType = w.type?.toLowerCase().includes(searchQ);
      const matchElem = w.element?.toLowerCase().includes(searchQ);
      const matchFrame = w.frame?.toLowerCase().includes(searchQ);
      const matchSource = w.source?.toLowerCase().includes(searchQ);
      const matchPvePerks = (w.pve?.perk1 + ' ' + w.pve?.perk2 + ' ' + w.pve?.barrel + ' ' + w.pve?.mag + ' ' + w.pve?.stock + ' ' + w.pve?.originTrait + ' ' + w.pve?.catalyst).toLowerCase().includes(searchQ);
      const matchPvpPerks = (w.pvp?.perk1 + ' ' + w.pvp?.perk2 + ' ' + w.pvp?.barrel + ' ' + w.pvp?.mag + ' ' + w.pvp?.stock + ' ' + w.pvp?.originTrait + ' ' + w.pvp?.catalyst).toLowerCase().includes(searchQ);
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
    const isExotic = weapon.tier === 'Exotic' || weapon.template === 'exotic' || Boolean(pve.stock || pve.catalyst);

    const exoticBadge = isExotic ? `<span class="gr-badge gr-tier-exotic">👑 EXOTIC</span>` : '';

    card.innerHTML = `
      <div class="gr-card-header">
        <div class="gr-badge-row">
          ${exoticBadge}
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
            ${renderGodRollPerkRows(pve, false)}
          </div>
          ${pve.notes ? `<div class="gr-insight-note">"${pve.notes}"</div>` : ''}
        </div>

        <div class="gr-roll-box pvp-box">
          <div class="gr-box-header">
            <span class="gr-mode-icon">🎯</span>
            <span class="gr-mode-title">PVP GOD ROLL</span>
          </div>
          <div class="gr-perks-list">
            ${renderGodRollPerkRows(pvp, true)}
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
        `Only authorized clan members may modify armory intel. Enter the Clan Authorization Code to edit '${weapon.name}'.`
      );
    });

    grid.appendChild(card);
  });
}

function renderGodRollPerkRows(modeObj, isPvp = false) {
  const m = modeObj || {};
  let html = '';
  if (m.barrel) {
    html += `<div class="gr-perk-row"><span class="perk-label">Barrel / Sights</span><span class="perk-val">${escapeHtml(m.barrel)}</span></div>`;
  }
  if (m.mag) {
    html += `<div class="gr-perk-row"><span class="perk-label">Mag / Ammo</span><span class="perk-val">${escapeHtml(m.mag)}</span></div>`;
  }
  if (m.stock) {
    html += `<div class="gr-perk-row"><span class="perk-label">Stock / Grip</span><span class="perk-val">${escapeHtml(m.stock)}</span></div>`;
  }
  if (m.perk1) {
    html += `<div class="gr-perk-row highlight"><span class="perk-label">Trait 1</span><span class="perk-val ${isPvp ? 'primary-pvp' : 'primary'}">${escapeHtml(m.perk1)}</span></div>`;
  }
  if (m.perk2) {
    html += `<div class="gr-perk-row highlight"><span class="perk-label">Trait 2 / Sec</span><span class="perk-val ${isPvp ? 'primary-pvp' : 'primary'}">${escapeHtml(m.perk2)}</span></div>`;
  }
  if (m.originTrait) {
    html += `<div class="gr-perk-row"><span class="perk-label">Origin / Intrinsic</span><span class="perk-val origin">${escapeHtml(m.originTrait)}</span></div>`;
  }
  if (m.catalyst) {
    html += `<div class="gr-perk-row"><span class="perk-label">Catalyst / Refit</span><span class="perk-val mw">${escapeHtml(m.catalyst)}</span></div>`;
  } else if (m.masterwork) {
    html += `<div class="gr-perk-row"><span class="perk-label">Masterwork</span><span class="perk-val mw">${escapeHtml(m.masterwork)}</span></div>`;
  }
  return html || `<div class="gr-perk-row"><span class="perk-label">Perks</span><span class="perk-val">Standard Setup</span></div>`;
}

function setGodRollTemplate(tmpl, silent = false) {
  const isExotic = tmpl === 'exotic';
  const tmplInput = document.getElementById('rollTemplate');
  if (tmplInput) tmplInput.value = isExotic ? 'exotic' : 'legendary';

  const btnLeg = document.getElementById('btnTemplateLegendary');
  const btnExo = document.getElementById('btnTemplateExotic');
  if (btnLeg) btnLeg.classList.toggle('active', !isExotic);
  if (btnExo) btnExo.classList.toggle('active', isExotic);

  const legFields = document.getElementById('templateLegendaryFields');
  const exoFields = document.getElementById('templateExoticFields');
  if (legFields) legFields.classList.toggle('hidden', isExotic);
  if (exoFields) exoFields.classList.toggle('hidden', !isExotic);

  // Manage required attributes
  const pveP1 = document.getElementById('pvePerk1');
  const pveP2 = document.getElementById('pvePerk2');
  const pvpP1 = document.getElementById('pvpPerk1');
  const pvpP2 = document.getElementById('pvpPerk2');
  const pveP1Ex = document.getElementById('pvePerk1Exotic');
  const pvpP1Ex = document.getElementById('pvpPerk1Exotic');

  if (pveP1) pveP1.required = !isExotic;
  if (pveP2) pveP2.required = !isExotic;
  if (pvpP1) pvpP1.required = !isExotic;
  if (pvpP2) pvpP2.required = !isExotic;

  if (pveP1Ex) pveP1Ex.required = isExotic;
  if (pvpP1Ex) pvpP1Ex.required = isExotic;

  if (!silent) {
    try { sfx.playChirp(); } catch (e) {}
  }
}

function openEditGodRollModal(weapon = null) {
  const modal = document.getElementById('modalEditGodRoll');
  const titleEl = document.getElementById('editGodRollModalTitle');
  if (!modal) return;

  const isExotic = Boolean(
    weapon?.template === 'exotic' ||
    weapon?.tier === 'Exotic' ||
    weapon?.pve?.stock ||
    weapon?.pve?.catalyst ||
    weapon?.pvp?.stock ||
    weapon?.pvp?.catalyst
  );

  document.getElementById('editRollId').value = weapon?.id || '';
  document.getElementById('rollWeaponName').value = weapon?.name || '';
  document.getElementById('rollSource').value = weapon?.source || '';
  document.getElementById('rollSlot').value = weapon?.slot || 'Kinetic';
  document.getElementById('rollType').value = weapon?.type || (isExotic ? 'Pulse Rifle' : 'Hand Cannon');
  document.getElementById('rollElement').value = weapon?.element || 'Kinetic';
  document.getElementById('rollFrame').value = weapon?.frame || '';

  // Legendary fields
  document.getElementById('pveBarrel').value = weapon?.pve?.barrel || '';
  document.getElementById('pveMag').value = weapon?.pve?.mag || '';
  document.getElementById('pvePerk1').value = weapon?.pve?.perk1 || '';
  document.getElementById('pvePerk2').value = weapon?.pve?.perk2 || '';
  document.getElementById('pveOriginTrait').value = weapon?.pve?.originTrait || '';
  document.getElementById('pveMasterwork').value = weapon?.pve?.masterwork || '';
  document.getElementById('pveNotes').value = weapon?.pve?.notes || '';

  document.getElementById('pvpBarrel').value = weapon?.pvp?.barrel || '';
  document.getElementById('pvpMag').value = weapon?.pvp?.mag || '';
  document.getElementById('pvpPerk1').value = weapon?.pvp?.perk1 || '';
  document.getElementById('pvpPerk2').value = weapon?.pvp?.perk2 || '';
  document.getElementById('pvpOriginTrait').value = weapon?.pvp?.originTrait || '';
  document.getElementById('pvpMasterwork').value = weapon?.pvp?.masterwork || '';
  document.getElementById('pvpNotes').value = weapon?.pvp?.notes || '';

  // Exotic fields
  document.getElementById('pveBarrelExotic').value = weapon?.pve?.barrel || '';
  document.getElementById('pveMagExotic').value = weapon?.pve?.mag || '';
  document.getElementById('pveStockExotic').value = weapon?.pve?.stock || '';
  document.getElementById('pveCatalystExotic').value = weapon?.pve?.catalyst || '';
  document.getElementById('pvePerk1Exotic').value = weapon?.pve?.perk1 || '';
  document.getElementById('pvePerk2Exotic').value = weapon?.pve?.perk2 || '';
  document.getElementById('pveOriginTraitExotic').value = weapon?.pve?.originTrait || '';
  document.getElementById('pveNotesExotic').value = weapon?.pve?.notes || '';

  document.getElementById('pvpBarrelExotic').value = weapon?.pvp?.barrel || '';
  document.getElementById('pvpMagExotic').value = weapon?.pvp?.mag || '';
  document.getElementById('pvpStockExotic').value = weapon?.pvp?.stock || '';
  document.getElementById('pvpCatalystExotic').value = weapon?.pvp?.catalyst || '';
  document.getElementById('pvpPerk1Exotic').value = weapon?.pvp?.perk1 || '';
  document.getElementById('pvpPerk2Exotic').value = weapon?.pvp?.perk2 || '';
  document.getElementById('pvpOriginTraitExotic').value = weapon?.pvp?.originTrait || '';
  document.getElementById('pvpNotesExotic').value = weapon?.pvp?.notes || '';

  setGodRollTemplate(isExotic ? 'exotic' : 'legendary', true);

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
   BUNGIE.NET INVENTORY, VAULT & "ASK F.E.L.I.C.I.A." ENGINE
   ========================================================================== */
const BUNGIE_STORAGE_KEY = 'felicia_bungie_session';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function classGlyph(className) {
  const c = (className || '').toLowerCase();
  if (c === 'hunter') return '◆';
  if (c === 'warlock') return '▲';
  if (c === 'titan') return '■';
  return '❖';
}

function loadSavedBungieSession() {
  // Check URL hash bounce (#bungie_session=...) from cross-origin OAuth callback
  if (window.location.hash && window.location.hash.startsWith('#bungie_session=')) {
    try {
      const b64 = window.location.hash.slice('#bungie_session='.length);
      const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const jsonStr = atob(pad.replace(/-/g, '+').replace(/_/g, '/'));
      const parsed = JSON.parse(jsonStr);
      if (parsed && parsed.access_token) {
        localStorage.setItem(BUNGIE_STORAGE_KEY, JSON.stringify(parsed));
      }
    } catch (e) {
      console.error('[Bungie Session Hash Parse]', e);
    }
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  try {
    const raw = localStorage.getItem(BUNGIE_STORAGE_KEY);
    if (!raw) return null;
    const sess = JSON.parse(raw);
    if (sess && sess.access_token) return sess;
  } catch (e) {}
  return null;
}

function saveBungieSession(sess) {
  state.bungieSession = sess;
  try {
    if (sess) {
      localStorage.setItem(BUNGIE_STORAGE_KEY, JSON.stringify(sess));
    } else {
      localStorage.removeItem(BUNGIE_STORAGE_KEY);
    }
  } catch (e) {}
}

function startBungieLogin() {
  sfx.playTransmit();
  const origin = encodeURIComponent(window.location.origin);
  window.location.href = `/api/auth/bungie/login?origin=${origin}`;
}

function getGodRollScanFlagKey() {
  const mid = state.bungieSession?.membership_id || state.bungieData?.player?.destinyMembershipId || 'default';
  return `felicia_has_scanned_godrolls_${mid}`;
}

function hasScannedGodRollsBefore() {
  try {
    return localStorage.getItem(getGodRollScanFlagKey()) === 'true';
  } catch (e) {
    return false;
  }
}

function markGodRollsScanned() {
  try {
    localStorage.setItem(getGodRollScanFlagKey(), 'true');
  } catch (e) {}
  syncMyGodRollsButtonVisibility();
}

function syncMyGodRollsButtonVisibility() {
  const myGrBtn = document.getElementById('btnMyGodRollsFilter');
  if (!myGrBtn) return;
  const unlocked = Boolean(state.bungieSession && state.bungieSession.access_token && hasScannedGodRollsBefore());
  myGrBtn.classList.toggle('hidden', !unlocked);
  if (!unlocked && state.invFilter.slot === 'godroll') {
    state.invFilter.slot = 'all';
    document.querySelectorAll('#invFilterPills .inv-pill[data-invfilter]').forEach(p => {
      p.classList.toggle('active', p.dataset.invfilter === 'all');
    });
  }
}

function disconnectBungieAccount() {
  sfx.playChirp();
  saveBungieSession(null);
  state.bungieData = null;
  state.activeInventoryView = null;
  state.loadoutsDrawerOpen = {};
  state.dismantleSelectedIds = new Set();
  state.dismantleSelectionInitialized = false;
  state.dupDrawerOpen = {};
  updateBungieAuthUI();
}

function updateBungieAuthUI() {
  const hero = document.getElementById('bungieSignInHero');
  const workspace = document.getElementById('inventoryWorkspace');
  const headerPill = document.getElementById('bungieHeaderBadge');
  const headerText = document.getElementById('bungieHeaderText');

  if (state.bungieSession && state.bungieSession.access_token) {
    if (hero) hero.classList.add('hidden');
    if (workspace) workspace.classList.remove('hidden');
    if (headerPill) headerPill.classList.add('linked');
    const gName = state.bungieData?.player?.fullBungieName || 'Bungie Linked';
    if (headerText) headerText.textContent = gName;
  } else {
    if (hero) hero.classList.remove('hidden');
    if (workspace) workspace.classList.add('hidden');
    if (headerPill) headerPill.classList.remove('linked');
    if (headerText) headerText.textContent = 'Sign In with Bungie';
  }
  syncMyGodRollsButtonVisibility();
}

async function fetchBungieServerConfigStatus() {
  try {
    const res = await fetch('/api/auth/bungie/status');
    const data = await res.json();
    const badge = document.getElementById('badgeBungieConfigStatus');
    const cidInput = document.getElementById('inputBungieClientId');
    if (cidInput && data.client_id) cidInput.value = data.client_id;
    if (badge) {
      if (data.configured && data.has_secret) {
        badge.textContent = `ACTIVE // ID ${data.client_id}`;
      } else if (data.configured) {
        badge.textContent = 'MISSING SECRET';
      } else {
        badge.textContent = 'NEEDS KEYS';
      }
    }
  } catch (e) {}
}

async function loadBungieInventory(silent = false) {
  if (!state.bungieSession || !state.bungieSession.access_token) {
    updateBungieAuthUI();
    return;
  }

  updateBungieAuthUI();
  const loadingEl = document.getElementById('invLoadingState');
  const stageEl = document.getElementById('invStage');

  if (!silent) {
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (stageEl) stageEl.innerHTML = '';
  }

  try {
    const res = await fetch('/api/bungie/inventory', {
      headers: {
        'Authorization': `Bearer ${state.bungieSession.access_token}`,
        'X-Bungie-Refresh': state.bungieSession.refresh_token || ''
      }
    });

    if (res.status === 401) {
      disconnectBungieAccount();
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Could not load Bungie inventory.');
    }

    if (data.refreshed_session) {
      saveBungieSession(data.refreshed_session);
    }

    state.bungieData = data;
    state.dismantleSelectionInitialized = false;
    if (!state.dismantleTargetCharId && data.characters?.[0]?.characterId) {
      state.dismantleTargetCharId = data.characters[0].characterId;
    }
    if (!state.activeInventoryView) {
      state.activeInventoryView = data.characters?.[0]?.characterId || 'vault';
    } else if (
      state.activeInventoryView !== 'vault' &&
      !(data.characters || []).some(c => c.characterId === state.activeInventoryView)
    ) {
      state.activeInventoryView = data.characters?.[0]?.characterId || 'vault';
    }

    updateBungieAuthUI();
    renderInventoryHeaderAndSwitcher();
    renderInventoryStage();
  } catch (err) {
    console.error('[Bungie Inventory Error]', err);
    if (stageEl) {
      stageEl.innerHTML = `
        <div class="vault-section-block" style="text-align:center; padding:34px;">
          <h3 style="font-family:var(--font-display); color:#F87171; margin-bottom:8px;">TELEMETRY SYNC INTERRUPTED</h3>
          <p style="color:#CBD5E1; margin-bottom:14px;">${escapeHtml(err.message)}</p>
          <button type="button" class="btn-tactical btn-primary" id="btnRetryInvSync">Retry Sync</button>
        </div>
      `;
      document.getElementById('btnRetryInvSync')?.addEventListener('click', () => loadBungieInventory(false));
    }
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
  }
}

function renderInventoryHeaderAndSwitcher() {
  const data = state.bungieData;
  if (!data) return;

  const bNameEl = document.getElementById('invBungieName');
  const platEl = document.getElementById('invPlatformTag');
  if (bNameEl) bNameEl.textContent = data.player?.fullBungieName || 'Guardian';
  if (platEl) platEl.textContent = data.player?.platformName || 'Destiny 2';

  const switcher = document.getElementById('charVaultSwitcher');
  if (!switcher) return;
  switcher.innerHTML = '';

  // 1. Character Columns: Character Emblem Banner + Saved Loadouts Directly Underneath
  (data.characters || []).forEach(ch => {
    const colWrap = document.createElement('div');
    colWrap.className = 'switcher-char-col';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `switcher-card ${state.activeInventoryView === ch.characterId ? 'active' : ''}`;
    if (ch.emblemBackgroundPath) {
      btn.style.backgroundImage = `url("https://www.bungie.net${ch.emblemBackgroundPath}")`;
    }
    const subName = ch.subclass?.name || 'Active Loadout';
    btn.innerHTML = `
      <div class="switcher-info">
        <span class="switcher-class">${classGlyph(ch.className)} ${escapeHtml(ch.className)}</span>
        <span class="switcher-sub">${escapeHtml(subName)}</span>
      </div>
      <div class="switcher-light">✦ ${ch.light || ''}</div>
    `;
    btn.addEventListener('click', () => {
      sfx.playChirp();
      state.activeInventoryView = ch.characterId;
      renderInventoryHeaderAndSwitcher();
      renderInventoryStage();
    });
    colWrap.appendChild(btn);

    // Saved In-Game Loadouts Strip directly under this Character (minimized by default until clicked)
    const loadouts = ch.loadouts || [];
    const details = document.createElement('details');
    details.className = 'char-loadouts-details';
    if (state.loadoutsDrawerOpen[ch.characterId] === true) {
      details.setAttribute('open', '');
    }
    details.addEventListener('toggle', () => {
      state.loadoutsDrawerOpen[ch.characterId] = details.open;
    });

    const summary = document.createElement('summary');
    summary.className = 'char-loadouts-summary';
    summary.innerHTML = `<span>SAVED LOADOUTS (${loadouts.length})</span>`;
    details.appendChild(summary);

    if (loadouts.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'char-loadouts-empty';
      emptyEl.textContent = 'No in-game loadouts saved.';
      details.appendChild(emptyEl);
    } else {
      const ldGrid = document.createElement('div');
      ldGrid.className = 'char-loadouts-grid';
      loadouts.forEach(ld => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'saved-loadout-chip';
        const colorStyle = ld.colorPath
          ? `style="background-image:url('https://www.bungie.net${ld.colorPath}');"`
          : '';
        const iconHtml = ld.iconPath
          ? `<img src="https://www.bungie.net${ld.iconPath}" alt="" width="18" height="18" loading="lazy">`
          : '<span>⚡</span>';
        const subParts = [];
        if (ld.subclass?.name) subParts.push(ld.subclass.name);
        if (ld.exoticItem?.name) subParts.push(ld.exoticItem.name);
        const subLabel = subParts.join(' • ') || `Slot #${ld.slotNumber}`;

        chip.innerHTML = `
          <div class="saved-loadout-swatch" ${colorStyle}>${iconHtml}</div>
          <div class="saved-loadout-meta">
            <span class="saved-loadout-name">${escapeHtml(ld.name)}</span>
            <span class="saved-loadout-sub">${escapeHtml(subLabel)}</span>
          </div>
        `;
        chip.addEventListener('click', () => openSavedLoadoutModal(ch, ld));
        ldGrid.appendChild(chip);
      });
      details.appendChild(ldGrid);
    }

    colWrap.appendChild(details);
    switcher.appendChild(colWrap);
  });

  // 2. Vault Card
  const vaultBtn = document.createElement('button');
  vaultBtn.type = 'button';
  vaultBtn.className = `switcher-card vault-card ${state.activeInventoryView === 'vault' ? 'active' : ''}`;
  const vCount = data.vault?.gearCount ?? 0;
  const vTotal = data.vault?.count ?? vCount;
  const vCap = data.vault?.capacity ?? 1300;
  vaultBtn.innerHTML = `
    <div class="switcher-info">
      <span class="switcher-class">🏛️ THE VAULT</span>
      <span class="switcher-sub">${vCount} Weapons &amp; Armor Stored</span>
    </div>
    <div class="vault-cap-badge">${vTotal} / ${vCap}</div>
  `;
  vaultBtn.addEventListener('click', () => {
    sfx.playChirp();
    state.activeInventoryView = 'vault';
    renderInventoryHeaderAndSwitcher();
    renderInventoryStage();
  });
  switcher.appendChild(vaultBtn);
}

function resolveItemGearTier(item) {
  if (!item || item.category === 'Artifact' || item.slot === 'Artifact' || item.isExotic || item.tierName === 'Exotic' || item.tierType === 6) {
    if (item) item.gearTier = null;
    return null;
  }
  const rawTier = parseInt(item.gearTier, 10);
  if (!isNaN(rawTier) && rawTier >= 1 && rawTier <= 5) {
    return rawTier;
  }

  // Client-side fallback evaluator matching Destiny 2 / Light.gg / DIM
  // NOTE: In Destiny 2, Exotics and Seasonal Artifacts NEVER have the Tier system.
  if (item.category === 'Armor') {
    const totalStats = item.totalStats || (item.stats || []).reduce((acc, s) => acc + (s.value || 0), 0);
    const isArtifice = (item.activePerks || []).some(p => (p.name || '').toLowerCase().includes('artifice')) ||
                       (item.mods || []).some(m => (m.name || '').toLowerCase().includes('artifice'));
    if (totalStats >= 64 || isArtifice) return 5;
    if (totalStats >= 60) return 4;
    if (totalStats >= 56) return 3;
    if (totalStats >= 50) return 2;
    if (totalStats > 0) return 1;
    return item.tierName === 'Legendary' ? 4 : 2;
  }

  if (item.category === 'Weapon') {
    const nameLow = (item.name || '').toLowerCase();
    const isAdept = nameLow.includes('(adept)') || nameLow.includes('(timelost)') || nameLow.includes('(harrowed)');
    const enhancedCount = (item.activePerks || []).filter(p =>
      (p.name || '').toLowerCase().includes('(enhanced)') || (p.description || '').toLowerCase().includes('enhanced')
    ).length;
    if (isAdept || enhancedCount >= 2) return 5;
    if (item.isCrafted || enhancedCount >= 1) return 4;
    if (item.isMasterworked) return 3;
    if (item.tierName === 'Legendary') return 2;
    return 1;
  }

  return null;
}

function renderTierStarsHtml(tierNumber) {
  const t = parseInt(tierNumber, 10);
  if (!t || isNaN(t) || t < 1 || t > 5) return '';
  let starsHtml = '';
  for (let i = 0; i < t; i++) {
    starsHtml += `<svg class="gear-tier-star" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0 L6.2 3.8 L10 5 L6.2 6.2 L5 10 L3.8 6.2 L0 5 L3.8 3.8 Z" fill="#FDE047" stroke="#000" stroke-width="0.7"/></svg>`;
  }
  return `<div class="gear-tier-stars" title="Tier ${t} (${t} ${t === 1 ? 'Star' : 'Stars'})" aria-label="Tier ${t}">${starsHtml}</div>`;
}

function itemMatchesFilter(item) {
  const f = state.invFilter;
  if (f.slot === 'weapons' && item.category !== 'Weapon') return false;
  if (f.slot === 'armor' && item.category !== 'Armor') return false;
  if (f.slot === 'Artifact' && item.category !== 'Artifact' && item.slot !== 'Artifact') return false;
  if (f.slot === 'armor-pve') {
    if (item.category !== 'Armor') return false;
    const aev = item.armorEvaluation || {};
    return aev.rollType === 'PVE_GOD_ROLL';
  }
  if (f.slot === 'armor-pvp') {
    if (item.category !== 'Armor') return false;
    const aev = item.armorEvaluation || {};
    return aev.rollType === 'PVP_GOD_ROLL';
  }
  if (f.slot === 'armor-trash') {
    if (item.category !== 'Armor') return false;
    const aev = item.armorEvaluation || {};
    return aev.rollType === 'TRASH_DISMANTLE' || Boolean(item.godRollCheck?.dismantleCandidate);
  }
  if (['Kinetic', 'Energy', 'Heavy'].includes(f.slot) && item.slot !== f.slot) return false;
  if (f.slot === 'godroll') {
    const grc = item.godRollCheck;
    if (!grc) return false;
    if (typeof grc.isBestGodRoll === 'boolean') return grc.isBestGodRoll;
    return ['DUAL_GOD_ROLL', 'PVE_GOD_ROLL', 'PVP_GOD_ROLL'].includes(grc.verdictCode || '');
  }

  const q = (f.search || '').trim().toLowerCase();
  if (!q) return true;

  if (item.gearTier) {
    const tNum = String(item.gearTier);
    if (q === `t${tNum}` || q === `tier ${tNum}` || q === `tier:${tNum}` || q === `t:${tNum}` ||
        q.includes(`t${tNum}`) || q.includes(`tier ${tNum}`)) {
      return true;
    }
  }

  if ((item.name || '').toLowerCase().includes(q)) return true;
  if ((item.typeName || '').toLowerCase().includes(q)) return true;
  if ((item.element || '').toLowerCase().includes(q)) return true;
  if ((item.slot || '').toLowerCase().includes(q)) return true;
  if ((item.compendiumSet?.name || '').toLowerCase().includes(q)) return true;

  for (const col of (item.perkColumns || [])) {
    for (const p of col) {
      if ((p.name || '').toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

function createGearCardElement(item, { isEquippedCard = false, deferOffscreen = false } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  const tierCls = item.isExotic ? 'tier-exotic' : (item.category === 'Artifact' ? 'tier-artifact' : 'tier-legendary');
  const mwCls = item.isMasterworked ? 'is-masterworked' : '';
  const eqCls = isEquippedCard ? 'equipped-card' : '';
  const defCls = deferOffscreen ? 'vault-item-deferred' : '';
  btn.className = `gear-card ${tierCls} ${mwCls} ${eqCls} ${defCls}`.trim();

  const iconSrc = item.icon ? `https://www.bungie.net${item.icon}` : 'icon-192.png';
  const elemDot = item.category === 'Weapon'
    ? `<span class="elem-dot ${escapeHtml(item.element)}"></span>`
    : (item.category === 'Artifact' ? `<span class="elem-dot Artifact"></span>` : '');

  const grc = item.godRollCheck || {};
  const vc = grc.verdictCode || '';
  const aev = item.armorEvaluation || {};
  const hasMultipleGods = (grc.familyGodRollCount || 0) > 1;
  let godBadge = '';
  if (grc.isOutclassedDuplicate) {
    godBadge = `<span class="godroll-mini-tag outclassed-dup">⚠ DUP #${grc.duplicateRank || 2} (OUTCLASSED)</span>`;
  } else if (vc === 'DUAL_GOD_ROLL') {
    godBadge = `<span class="godroll-mini-tag">${hasMultipleGods ? '👑 #1 PVE+PVP ROLL' : '★ PVE + PVP GOD ROLL'}</span>`;
  } else if (vc === 'PVE_GOD_ROLL') {
    if (item.category === 'Armor') {
      const hp = aev.healthStat || 0;
      if (hp <= 2) {
        godBadge = `<span class="godroll-mini-tag pve-god-armor">★ PVE TIER 5 (0 HEALTH)</span>`;
      } else {
        godBadge = `<span class="godroll-mini-tag pve-god-armor">🛡️ PVE TIER 5 (${hp} HP)</span>`;
      }
    } else {
      godBadge = `<span class="godroll-mini-tag">${hasMultipleGods ? '👑 #1 PVE GOD ROLL' : '★ PVE GOD ROLL'}</span>`;
    }
  } else if (vc === 'PVP_GOD_ROLL') {
    if (item.category === 'Armor') {
      godBadge = `<span class="godroll-mini-tag pvp-god-armor">★ PVP TIER 5 (${aev.healthStat || 0} HP)</span>`;
    } else {
      godBadge = `<span class="godroll-mini-tag">${hasMultipleGods ? '👑 #1 PVP GOD ROLL' : '★ PVP GOD ROLL'}</span>`;
    }
  } else if (vc === 'TRASH_ARMOR' || (item.category === 'Armor' && aev.isTier5 === false)) {
    godBadge = `<span class="godroll-mini-tag armor-trash-tag">🗑️ &lt;TIER 5 (${item.totalStats || 0})</span>`;
  }

  const setBadge = item.compendiumSet
    ? `<span class="compendium-set-pill">⛊ ${escapeHtml(item.compendiumSet.name)}</span>`
    : '';

  const isExotic = item.isExotic || item.tierName === 'Exotic';
  const resolvedTier = isExotic ? null : resolveItemGearTier(item);
  item.gearTier = resolvedTier;
  const tierStars = (!isExotic && resolvedTier) ? renderTierStarsHtml(resolvedTier) : '';
  const tierPill = (!isExotic && resolvedTier && resolvedTier >= 1 && resolvedTier <= 5)
    ? `<span class="gear-tier-pill t${resolvedTier}">T${resolvedTier}</span>`
    : '';

  const craftedCorner = item.isCrafted ? `<span class="gear-crafted-corner">◈</span>` : '';
  const lockCorner = item.isLocked ? `<span class="gear-lock-pip" aria-label="Locked">🔒</span>` : '';
  let subDetail = escapeHtml(item.typeName || item.slot);
  if (item.category === 'Armor' && item.totalStats) {
    subDetail = `${escapeHtml(item.slot)} • ${item.totalStats} Stat`;
  } else if (item.category === 'Artifact') {
    subDetail = item.powerBonus ? `+${item.powerBonus} Power • Artifact` : 'Seasonal Artifact';
  }

  btn.innerHTML = `
    <div class="gear-icon-frame">
      <img src="${iconSrc}" alt="${escapeHtml(item.name)}" width="48" height="48" loading="lazy">
      ${tierStars}
      ${craftedCorner}
      ${lockCorner}
    </div>
    <div class="gear-meta">
      <div class="gear-name">${escapeHtml(item.name)}</div>
      <div class="gear-sub">
        ${elemDot}
        <span class="gear-power">${item.power ? `✦ ${item.power}` : (item.powerBonus ? `+${item.powerBonus}` : '')}</span>
        ${tierPill}
        <span>• ${subDetail}</span>
      </div>
      ${setBadge}
      ${godBadge}
    </div>
  `;

  btn.addEventListener('click', () => openItemInspectModal(item));
  return btn;
}

function renderInventoryStage() {
  const stage = document.getElementById('invStage');
  const data = state.bungieData;
  if (!stage || !data) return;
  stage.innerHTML = '';

  if (state.activeInventoryView === 'vault') {
    renderVaultView(stage, data.vault?.items || []);
    return;
  }

  const ch = (data.characters || []).find(c => c.characterId === state.activeInventoryView);
  if (!ch) {
    renderVaultView(stage, data.vault?.items || []);
    return;
  }

  // 1. Modern 0-200 6-Stat Ribbon for Active Character
  const statEntries = Object.entries(ch.stats || {});
  if (statEntries.length > 0) {
    const ribbon = document.createElement('div');
    ribbon.className = 'char-stats-ribbon';
    ribbon.innerHTML = `<span style="font-family:var(--font-display); font-size:12px; color:var(--vanguard-amber); font-weight:700; margin-right:4px;">${classGlyph(ch.className)} ${escapeHtml(ch.className.toUpperCase())} STATS (0–200):</span>`;
    statEntries.forEach(([sName, sVal]) => {
      const chip = document.createElement('div');
      chip.className = `char-stat-chip ${sVal >= 100 ? 'high-stat' : ''}`;
      chip.innerHTML = `<span class="s-lbl">${escapeHtml(sName)}:</span><span class="s-val">${sVal}</span>`;
      ribbon.appendChild(chip);
    });
    stage.appendChild(ribbon);
  }

  // 2. Multi-Panel Character Gear Grid (Weapons, Armor & Seasonal Artifact)
  const cols = document.createElement('div');
  cols.className = 'char-loadout-columns';

  const weaponSlots = ['Kinetic', 'Energy', 'Heavy'];
  const armorSlots = ['Helmet', 'Gauntlets', 'Chest Armor', 'Leg Armor', 'Class Armor'];

  const buildColumnPanel = (title, slotNames) => {
    const panel = document.createElement('div');
    panel.className = 'loadout-col-panel';
    panel.innerHTML = `<div class="loadout-col-header">${title}</div>`;

    let anyRendered = false;
    slotNames.forEach(slotName => {
      let eqItem = (ch.equipment || []).find(i => (i.slot === slotName || (slotName === 'Artifact' && i.category === 'Artifact')) && itemMatchesFilter(i));
      if (!eqItem && slotName === 'Artifact' && ch.artifact && itemMatchesFilter(ch.artifact)) {
        eqItem = ch.artifact;
      }
      const bagItems = (ch.inventory || []).filter(i => (i.slot === slotName || (slotName === 'Artifact' && i.category === 'Artifact')) && itemMatchesFilter(i));
      if (!eqItem && bagItems.length === 0) return;
      anyRendered = true;

      const block = document.createElement('div');
      block.className = 'slot-group-block';
      const labelText = slotName === 'Artifact' ? 'Seasonal Artifact' : slotName;
      block.innerHTML = `<div class="slot-group-label">${escapeHtml(labelText)}</div>`;

      const row = document.createElement('div');
      row.className = 'slot-items-row';

      if (eqItem) {
        const eqWrap = document.createElement('div');
        eqWrap.className = 'slot-equipped-holder';
        eqWrap.appendChild(createGearCardElement(eqItem, { isEquippedCard: true }));
        row.appendChild(eqWrap);
      }

      const bagGrid = document.createElement('div');
      bagGrid.className = 'slot-bag-grid';
      bagItems.forEach(bi => {
        bagGrid.appendChild(createGearCardElement(bi));
      });
      row.appendChild(bagGrid);

      block.appendChild(row);
      panel.appendChild(block);
    });

    if (!anyRendered) {
      const empty = document.createElement('p');
      empty.style.cssText = 'color:#64748B; font-size:13px; padding:12px 0;';
      empty.textContent = 'No matching items in this section for current filter.';
      panel.appendChild(empty);
    }
    return panel;
  };

  const isArmorFilter = ['armor', 'armor-pve', 'armor-pvp', 'armor-trash'].includes(state.invFilter.slot);
  const isWeaponFilter = ['weapons', 'Kinetic', 'Energy', 'Heavy'].includes(state.invFilter.slot);
  const isArtifactFilter = state.invFilter.slot === 'Artifact';

  if (!isArmorFilter && !isArtifactFilter) {
    cols.appendChild(buildColumnPanel('⚔️ WEAPONS ARSENAL (EQUIPPED & INVENTORY)', weaponSlots));
  }
  if (!isWeaponFilter && !isArtifactFilter) {
    cols.appendChild(buildColumnPanel('🛡️ ARMOR RIG (EQUIPPED & INVENTORY)', armorSlots));
  }
  if (isArtifactFilter || (!isArmorFilter && !isWeaponFilter && state.invFilter.slot !== 'godroll')) {
    cols.appendChild(buildColumnPanel('❖ SEASONAL ARTIFACT (EQUIPPED & CARRIED)', ['Artifact']));
  }
  stage.appendChild(cols);

  // 3. Postmaster Strip (if character has Postmaster items)
  const pmFiltered = (ch.postmaster || []).filter(itemMatchesFilter);
  if (pmFiltered.length > 0) {
    const pmBlock = document.createElement('div');
    pmBlock.className = 'vault-section-block';
    pmBlock.style.marginTop = '16px';
    pmBlock.innerHTML = `
      <div class="vault-section-header">
        <span class="vault-section-title">📬 POSTMASTER (${pmFiltered.length})</span>
      </div>
    `;
    const pmGrid = document.createElement('div');
    pmGrid.className = 'vault-grid';
    pmFiltered.forEach(it => pmGrid.appendChild(createGearCardElement(it)));
    pmBlock.appendChild(pmGrid);
    stage.appendChild(pmBlock);
  }
}

function renderVaultView(stage, vaultItems) {
  const filtered = vaultItems.filter(itemMatchesFilter);
  const weapons = filtered.filter(i => i.category === 'Weapon');
  const armor = filtered.filter(i => i.category === 'Armor');
  const artifacts = filtered.filter(i => i.category === 'Artifact' || i.slot === 'Artifact');

  if (filtered.length === 0) {
    stage.innerHTML = `
      <div class="vault-section-block" style="text-align:center; padding:42px; color:#94A3B8;">
        No Vault items match your current search or filter.
      </div>
    `;
    return;
  }

  let globalRenderIdx = 0;

  if (weapons.length > 0) {
    const wSec = document.createElement('div');
    wSec.className = 'vault-section-block';
    wSec.innerHTML = `
      <div class="vault-section-header">
        <span class="vault-section-title">⚔️ VAULT WEAPONS (${weapons.length})</span>
      </div>
    `;
    const wGrid = document.createElement('div');
    wGrid.className = 'vault-grid';
    weapons.forEach(w => {
      const defer = globalRenderIdx >= 36;
      globalRenderIdx++;
      wGrid.appendChild(createGearCardElement(w, { deferOffscreen: defer }));
    });
    wSec.appendChild(wGrid);
    stage.appendChild(wSec);
  }

  if (armor.length > 0) {
    const aSec = document.createElement('div');
    aSec.className = 'vault-section-block';
    aSec.innerHTML = `
      <div class="vault-section-header">
        <span class="vault-section-title">🛡️ VAULT ARMOR (${armor.length})</span>
      </div>
    `;
    const aGrid = document.createElement('div');
    aGrid.className = 'vault-grid';
    armor.forEach(a => {
      const defer = globalRenderIdx >= 36;
      globalRenderIdx++;
      aGrid.appendChild(createGearCardElement(a, { deferOffscreen: defer }));
    });
    aSec.appendChild(aGrid);
    stage.appendChild(aSec);
  }

  if (artifacts.length > 0) {
    const artSec = document.createElement('div');
    artSec.className = 'vault-section-block';
    artSec.innerHTML = `
      <div class="vault-section-header">
        <span class="vault-section-title">❖ VAULT SEASONAL ARTIFACTS (${artifacts.length})</span>
      </div>
    `;
    const artGrid = document.createElement('div');
    artGrid.className = 'vault-grid';
    artifacts.forEach(a => {
      const defer = globalRenderIdx >= 36;
      globalRenderIdx++;
      artGrid.appendChild(createGearCardElement(a, { deferOffscreen: defer }));
    });
    artSec.appendChild(artGrid);
    stage.appendChild(artSec);
  }
}

function findFallbackEquipId(characterId, slotName, excludeInstanceId) {
  const ch = (state.bungieData?.characters || []).find(c => c.characterId === characterId);
  if (!ch) return '';
  const candidates = (ch.inventory || []).filter(
    i => i.slot === slotName && i.itemInstanceId !== excludeInstanceId && !i.isExotic
  );
  candidates.sort((a, b) => (b.power || 0) - (a.power || 0));
  return candidates[0]?.itemInstanceId || '';
}

function getActiveCharacter() {
  const chars = state.bungieData?.characters || [];
  if (!chars.length) return null;
  if (state.activeInventoryView && state.activeInventoryView !== 'vault') {
    const found = chars.find(c => c.characterId === state.activeInventoryView);
    if (found) return found;
  }
  return chars[0] || null;
}

function openItemInspectModal(item) {
  try {
    sfx.playChirp();
    state.inspectedItem = item;
    state.lastAppraisalReply = '';

    const modal = document.getElementById('modalInspectItem');
    if (!modal) return;

    const isExotic = item.isExotic || item.tierName === 'Exotic';
    const resolvedTier = isExotic ? null : resolveItemGearTier(item);
    item.gearTier = resolvedTier;

    const banner = document.getElementById('inspectBanner');
    if (banner) {
      banner.className = `inspect-banner ${isExotic ? 'tier-exotic' : 'tier-legendary'}`;
    }

    const iconEl = document.getElementById('inspectItemIcon');
    if (iconEl) iconEl.src = item.icon ? `https://www.bungie.net${item.icon}` : 'icon-192.png';

    const pipEl = document.getElementById('inspectCraftedPip');
    if (pipEl) pipEl.classList.toggle('hidden', !item.isCrafted);

    const tierBadge = document.getElementById('inspectTierBadge');
    if (tierBadge) {
      if (item.category === 'Artifact') {
        tierBadge.textContent = 'SEASONAL';
      } else if (isExotic) {
        tierBadge.textContent = 'EXOTIC';
      } else if (resolvedTier && resolvedTier >= 1 && resolvedTier <= 5) {
        tierBadge.textContent = `TIER ${resolvedTier} • ${(item.tierName || 'Legendary').toUpperCase()}`;
      } else {
        tierBadge.textContent = item.tierName || 'Legendary';
      }
    }

    const tierStarsWrap = document.getElementById('inspectTierStars');
    if (tierStarsWrap) {
      tierStarsWrap.innerHTML = (!isExotic && resolvedTier) ? renderTierStarsHtml(resolvedTier).replace(/^<div[^>]*>|<\/div>$/g, '') : '';
    }

    const elemBadge = document.getElementById('inspectElemBadge');
    if (elemBadge) {
      if (item.category === 'Artifact') {
        elemBadge.textContent = 'ARTIFACT';
      } else if (item.category === 'Weapon') {
        elemBadge.textContent = item.element;
      } else {
        elemBadge.textContent = `${item.classRestriction !== 'Any' ? item.classRestriction + ' ' : ''}Armor`;
      }
    }

    const locBadge = document.getElementById('inspectLocBadge');
    if (locBadge) {
      if (item.location === 'vault') {
        locBadge.textContent = 'IN VAULT';
      } else {
        const ownerChar = (state.bungieData?.characters || []).find(c => c.characterId === item.characterId);
        const cName = ownerChar ? ownerChar.className.toUpperCase() : 'CHARACTER';
        locBadge.textContent = item.isEquipped ? `EQUIPPED • ${cName}` : `${item.location === 'postmaster' ? 'POSTMASTER' : 'INVENTORY'} • ${cName}`;
      }
    }

    const nameEl = document.getElementById('inspectItemName');
    if (nameEl) nameEl.textContent = item.name;

    const sublineEl = document.getElementById('inspectSubline');
    if (sublineEl) {
      const tNum = parseInt(resolvedTier, 10);
      const tierPrefix = (!isExotic && Number.isInteger(tNum) && tNum >= 1 && tNum <= 5) ? `Tier ${tNum} (${'✦'.repeat(tNum)}) • ` : '';
      if (item.category === 'Artifact') {
        sublineEl.textContent = `${item.powerBonus ? `+${item.powerBonus} Bonus Power • ` : ''}Seasonal Artifact`;
      } else if (item.category === 'Armor' && item.armorEvaluation) {
        sublineEl.textContent = `${tierPrefix}${item.armorEvaluation.verdictLabel} • ${item.slot} (${item.totalStats || 0} Total Stats)`;
      } else {
        const fName = item.frame?.name ? `${item.frame.name} • ` : '';
        sublineEl.textContent = `${tierPrefix}${fName}${item.typeName || item.slot} (${item.slot} Slot)`;
      }
    }

    const powerEl = document.getElementById('inspectPowerVal');
    if (powerEl) powerEl.textContent = item.power || (item.powerBonus ? `+${item.powerBonus}` : '—');

    // Hide previous feedback & appraisal panel until requested
    const feedbackEl = document.getElementById('inspectTransferFeedback');
    if (feedbackEl) {
      feedbackEl.classList.add('hidden');
      feedbackEl.classList.remove('error');
    }
    const feliciaPanel = document.getElementById('inspectFeliciaPanel');
    if (feliciaPanel) feliciaPanel.classList.add('hidden');

    // Populate Action Buttons: Send to Hunter / Warlock / Titan / Vault + Signature "Ask F.E.L.I.C.I.A."
    const actionsGrid = document.getElementById('inspectActionsGrid');
    if (actionsGrid) {
      actionsGrid.innerHTML = '';
      const chars = state.bungieData?.characters || [];
      const activeChar = getActiveCharacter();

      if (item.category === 'Artifact') {
        // Artifacts are account-wide in modern Destiny 2:
        // If equipped on the active character: ONLY "Ask F.E.L.I.C.I.A."
        // If not equipped on the active character: "Equip Artifact" + "Ask F.E.L.I.C.I.A."
        const isEquippedOnActive = item.isEquipped && (!activeChar || item.characterId === activeChar.characterId);
        if (!isEquippedOnActive && activeChar) {
          const equipBtn = document.createElement('button');
          equipBtn.type = 'button';
          equipBtn.className = 'btn-item-action';
          equipBtn.innerHTML = `<span>⚡</span> Equip Artifact`;
          equipBtn.addEventListener('click', () => executeItemTransfer(item, 'equip', activeChar.characterId, activeChar.className));
          actionsGrid.appendChild(equipBtn);
        }

        // Signature Action: Ask F.E.L.I.C.I.A.
        const askBtn = document.createElement('button');
        askBtn.type = 'button';
        askBtn.className = 'btn-item-action btn-ask-felicia';
        askBtn.id = 'btnTriggerAskFelicia';
        askBtn.innerHTML = `<span>❖</span> Ask F.E.L.I.C.I.A.`;
        askBtn.addEventListener('click', () => triggerAskFeliciaOnItem(item));
        actionsGrid.appendChild(askBtn);
      } else {
        chars.forEach(ch => {
          const isAlreadyOnThisChar = item.location === 'character' && item.characterId === ch.characterId;
          if (!isAlreadyOnThisChar) {
            const sendBtn = document.createElement('button');
            sendBtn.type = 'button';
            sendBtn.className = 'btn-item-action';
            sendBtn.innerHTML = `<span>${classGlyph(ch.className)}</span> Send to ${escapeHtml(ch.className)}`;
            sendBtn.addEventListener('click', () => executeItemTransfer(item, 'character', ch.characterId, ch.className));
            actionsGrid.appendChild(sendBtn);
          } else if (!item.isEquipped && (item.classRestriction === 'Any' || item.classRestriction === ch.className)) {
            const equipBtn = document.createElement('button');
            equipBtn.type = 'button';
            equipBtn.className = 'btn-item-action';
            equipBtn.innerHTML = `<span>⚡</span> Equip on ${escapeHtml(ch.className)}`;
            equipBtn.addEventListener('click', () => executeItemTransfer(item, 'equip', ch.characterId, ch.className));
            actionsGrid.appendChild(equipBtn);
          }
        });

        if (item.location !== 'vault') {
          const vaultBtn = document.createElement('button');
          vaultBtn.type = 'button';
          vaultBtn.className = 'btn-item-action';
          vaultBtn.innerHTML = `<span>🏛️</span> Send to Vault`;
          vaultBtn.addEventListener('click', () => executeItemTransfer(item, 'vault', '', 'Vault'));
          actionsGrid.appendChild(vaultBtn);
        }

        if (item.itemInstanceId && item.location !== 'postmaster') {
          const lockBtn = document.createElement('button');
          lockBtn.type = 'button';
          lockBtn.className = 'btn-item-action';
          const syncLockBtnLabel = () => {
            lockBtn.innerHTML = item.isLocked ? `<span>🔒</span> Locked (Unlock)` : `<span>🔓</span> Lock Item`;
          };
          syncLockBtnLabel();
          lockBtn.addEventListener('click', async () => {
            lockBtn.disabled = true;
            await toggleSingleItemLock(item, !item.isLocked);
            syncLockBtnLabel();
            lockBtn.disabled = false;
          });
          actionsGrid.appendChild(lockBtn);
        }

        // Signature Action: Ask F.E.L.I.C.I.A.
        const askBtn = document.createElement('button');
        askBtn.type = 'button';
        askBtn.className = 'btn-item-action btn-ask-felicia';
        askBtn.id = 'btnTriggerAskFelicia';
        askBtn.innerHTML = `<span>❖</span> Ask F.E.L.I.C.I.A.`;
        askBtn.addEventListener('click', () => triggerAskFeliciaOnItem(item));
        actionsGrid.appendChild(askBtn);
      }
    }

    // Render Frame & Perk Columns (or Compendium Set Box for Armor)
    const frameBox = document.getElementById('inspectFrameBox');
    if (frameBox) {
      if (item.compendiumSet) {
        frameBox.classList.remove('hidden');
        frameBox.innerHTML = `
          <div style="width:100%;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;">
              <span style="font-family:var(--font-tactical); font-weight:700; color:#FDE047; font-size:13px;">⛊ ${escapeHtml(item.compendiumSet.name)} SET</span>
              <span style="font-size:11px; color:#94A3B8;">${escapeHtml(item.compendiumSet.source || '')}</span>
            </div>
            <div style="font-size:12px; color:#CBD5E1; margin-bottom:5px; line-height:1.4;">
              <strong style="color:#67E8F9;">2-Piece: ${escapeHtml(item.compendiumSet.perk2pc?.name || '')}</strong> — ${escapeHtml(item.compendiumSet.perk2pc?.desc || '')}
            </div>
            <div style="font-size:12px; color:#CBD5E1; line-height:1.4;">
              <strong style="color:#A78BFA;">4-Piece: ${escapeHtml(item.compendiumSet.perk4pc?.name || '')}</strong> — ${escapeHtml(item.compendiumSet.perk4pc?.desc || '')}
            </div>
          </div>
        `;
      } else if (item.frame && item.frame.name) {
        frameBox.classList.remove('hidden');
        const fIcon = item.frame.icon ? `<img src="https://www.bungie.net${item.frame.icon}" alt="">` : '';
        frameBox.innerHTML = `
          ${fIcon}
          <div>
            <div style="font-family:var(--font-tactical); font-weight:700; color:#F8FAFC; font-size:13.5px;">${escapeHtml(item.frame.name)}</div>
            <div style="font-size:12px; color:#94A3B8;">${escapeHtml(item.frame.description || '')}</div>
          </div>
        `;
      } else {
        frameBox.classList.add('hidden');
      }
    }

    const perkColsEl = document.getElementById('inspectPerkColumns');
    if (perkColsEl) {
      perkColsEl.innerHTML = '';
      if (item.category === 'Artifact') {
        const perksArr = item.activePerks || [];
        if (perksArr.length > 0) {
          const artWrap = document.createElement('div');
          artWrap.innerHTML = `
            <div class="artifact-perks-wrap" style="padding-top:4px; border-top:none;">
              ${perksArr.map(p => `
                <span class="artifact-perk-chip" title="${escapeHtml(p.description || '')}">
                  ${p.icon ? `<img src="https://www.bungie.net${p.icon}" alt="">` : ''}
                  <span>${escapeHtml(p.name)}</span>
                </span>
              `).join('')}
            </div>
          `;
          perkColsEl.appendChild(artWrap);
        } else {
          perkColsEl.innerHTML = `<div style="color:#C084FC; font-size:13px;">Equippable Seasonal Artifact</div>`;
        }
      } else if ((item.perkColumns || []).length === 0) {
        perkColsEl.innerHTML = `<div style="color:#64748B; font-size:13px;">Standard / Intrinsic Configuration</div>`;
      } else {
        item.perkColumns.forEach(col => {
          const stack = document.createElement('div');
          stack.className = 'perk-col-stack';
          col.forEach(opt => {
            const chip = document.createElement('div');
            chip.className = `perk-chip ${opt.selected ? 'active' : ''}`;
            chip.title = opt.description || opt.name;
            const pImg = opt.icon ? `<img src="https://www.bungie.net${opt.icon}" alt="">` : '';
            chip.innerHTML = `${pImg}<span>${escapeHtml(opt.name)}</span>`;
            stack.appendChild(chip);
          });
          perkColsEl.appendChild(stack);
        });
      }
    }

    const mwRow = document.getElementById('inspectMwRow');
    if (mwRow) {
      if (item.masterwork && item.masterwork.name) {
        mwRow.classList.remove('hidden');
        const mIcon = item.masterwork.icon ? `<img src="https://www.bungie.net${item.masterwork.icon}" alt="">` : '';
        mwRow.innerHTML = `${mIcon}<span><strong>Masterwork:</strong> ${escapeHtml(item.masterwork.name)}</span>`;
      } else {
        mwRow.classList.add('hidden');
      }
    }

    // Render Stat Bars
    const statsListEl = document.getElementById('inspectStatsList');
    if (statsListEl) {
      statsListEl.innerHTML = '';
      const maxScale = item.category === 'Armor' ? 45 : 100;
      (item.stats || []).forEach(st => {
        const noBarStats = ['RPM', 'Magazine', 'Charge Time', 'Draw Time', 'Recoil Direction'];
        const row = document.createElement('div');
        row.className = 'inspect-stat-row';
        if (noBarStats.includes(st.name)) {
          row.innerHTML = `
            <span class="inspect-stat-name">${escapeHtml(st.name)}</span>
            <span style="color:#64748B; font-size:11px;">————</span>
            <span class="inspect-stat-val">${st.value}</span>
          `;
        } else {
          const pct = Math.max(0, Math.min(100, Math.round((st.value / maxScale) * 100)));
          row.innerHTML = `
            <span class="inspect-stat-name">${escapeHtml(st.name)}</span>
            <div class="inspect-stat-bar-bg"><div class="inspect-stat-bar-fill" style="width:${pct}%"></div></div>
            <span class="inspect-stat-val">${st.value}</span>
          `;
        }
        statsListEl.appendChild(row);
      });

      if (item.category === 'Armor' && item.totalStats) {
        const totalRow = document.createElement('div');
        totalRow.className = 'inspect-stat-row';
        totalRow.style.marginTop = '6px';
        totalRow.style.paddingTop = '6px';
        totalRow.style.borderTop = '1px solid rgba(255,255,255,0.1)';
        totalRow.innerHTML = `
          <span class="inspect-stat-name" style="color:var(--vanguard-amber); font-weight:700;">Total Stats</span>
          <span></span>
          <span class="inspect-stat-val" style="color:var(--vanguard-amber); font-size:15px;">${item.totalStats}</span>
        `;
        statsListEl.appendChild(totalRow);
      }
    }

    if (!modal.open) {
      modal.showModal();
    }
  } catch (err) {
    console.error('[Open Inspect Item Modal Error]', err);
  }
}

async function executeItemTransfer(item, targetType, targetCharacterId, targetLabel) {
  const feedbackEl = document.getElementById('inspectTransferFeedback');
  const actionBtns = document.querySelectorAll('#inspectActionsGrid .btn-item-action');
  actionBtns.forEach(b => { b.disabled = true; });

  if (feedbackEl) {
    feedbackEl.classList.remove('hidden', 'error');
    feedbackEl.textContent = `Transmitting ${item.name} to ${targetLabel}...`;
  }
  sfx.playTransmit();

  const fallbackId = item.isEquipped
    ? findFallbackEquipId(item.characterId, item.slot, item.itemInstanceId)
    : '';

  try {
    const res = await fetch('/api/bungie/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.bungieSession.access_token}`,
        'X-Bungie-Refresh': state.bungieSession.refresh_token || ''
      },
      body: JSON.stringify({
        membershipType: state.bungieData.player.membershipType,
        itemInstanceId: item.itemInstanceId,
        itemHash: item.itemHash,
        sourceLocation: item.location,
        sourceCharacterId: item.characterId || '',
        targetType,
        targetCharacterId,
        isEquipped: Boolean(item.isEquipped),
        fallbackEquipInstanceId: fallbackId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Bungie rejected the transfer.');
    }

    if (data.refreshed_session) {
      saveBungieSession(data.refreshed_session);
    }

    sfx.playReceive();
    if (feedbackEl) {
      feedbackEl.textContent = `✓ ${item.name} ${targetType === 'equip' ? 'equipped on' : 'transferred to'} ${targetLabel}!`;
    }

    // Refresh inventory in background and close modal smoothly
    await loadBungieInventory(true);
    setTimeout(() => {
      document.getElementById('modalInspectItem')?.close();
    }, 650);
  } catch (err) {
    sfx.playAlert();
    if (feedbackEl) {
      feedbackEl.classList.remove('hidden');
      feedbackEl.classList.add('error');
      feedbackEl.textContent = `⚠ ${err.message}`;
    }
    actionBtns.forEach(b => { b.disabled = false; });
  }
}

async function triggerAskFeliciaOnItem(item) {
  sfx.playTransmit();
  const panel = document.getElementById('inspectFeliciaPanel');
  const bodyEl = document.getElementById('inspectFeliciaBody');
  const pillEl = document.getElementById('inspectVerdictPill');
  const askBtn = document.getElementById('btnTriggerAskFelicia');

  if (!panel || !bodyEl) return;
  panel.classList.remove('hidden');
  if (pillEl) pillEl.classList.add('hidden');
  if (askBtn) askBtn.disabled = true;

  bodyEl.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; color:var(--vanguard-amber); font-family:var(--font-tactical);">
      <div class="inv-spinner" style="width:20px; height:20px; border-width:2px;"></div>
      <span>F.E.L.I.C.I.A. is scanning rolled sockets &amp; Clan God Roll archives for <strong>${escapeHtml(item.name)}</strong>...</span>
    </div>
  `;

  try {
    const res = await fetch('/api/bungie/appraise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Appraisal request failed.');

    state.lastAppraisalReply = data.reply || '';
    sfx.playReceive();
    bodyEl.innerHTML = renderMarkdown(state.lastAppraisalReply);

    if (pillEl && data.godRollMatch) {
      const vc = data.godRollMatch.verdictCode;
      pillEl.classList.remove('hidden', 'godroll', 'keep', 'shard');
      if (['DUAL_GOD_ROLL', 'PVE_GOD_ROLL', 'PVP_GOD_ROLL'].includes(vc)) {
        pillEl.classList.add('godroll');
        pillEl.textContent = vc.replace(/_/g, ' ');
      } else if (vc === 'SHARD_CANDIDATE') {
        pillEl.classList.add('shard');
        pillEl.textContent = 'SAFE TO TRASH';
      } else {
        pillEl.classList.add('keep');
        pillEl.textContent = vc === 'SOLID_KEEP' ? 'SOLID KEEP' : 'EVALUATED';
      }
    }

    if (state.autoSpeak && state.lastAppraisalReply) {
      voice.speak(state.lastAppraisalReply);
    }
  } catch (err) {
    sfx.playAlert();
    bodyEl.innerHTML = `<p style="color:#FCA5A5;">Could not reach F.E.L.I.C.I.A.: ${escapeHtml(err.message)}</p>`;
  } finally {
    if (askBtn) askBtn.disabled = false;
  }
}

function attachLightDismissFallback(dialogEl) {
  if (!dialogEl) return;
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialogEl.addEventListener('click', (event) => {
      if (event.target !== dialogEl) return;
      const rect = dialogEl.getBoundingClientRect();
      const isDialogContent = (
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width
      );
      if (isDialogContent) return;
      dialogEl.close();
    });
  }
}

function findLiveItemByInstanceId(instanceId) {
  if (!instanceId || !state.bungieData) return null;
  for (const ch of (state.bungieData.characters || [])) {
    for (const list of [ch.equipment || [], ch.inventory || [], ch.postmaster || []]) {
      const hit = list.find(i => i.itemInstanceId === instanceId);
      if (hit) return hit;
    }
  }
  return (state.bungieData.vault?.items || []).find(i => i.itemInstanceId === instanceId) || null;
}

function openSavedLoadoutModal(character, loadout) {
  sfx.playChirp();
  state.inspectedLoadout = { character, loadout };

  const modal = document.getElementById('modalSavedLoadout');
  if (!modal) return;

  const badgeLg = document.getElementById('savedLoadoutBadgeLg');
  const iconLg = document.getElementById('savedLoadoutIconLg');
  const subEl = document.getElementById('savedLoadoutSubtitle');
  const titleEl = document.getElementById('savedLoadoutTitle');
  const equipBtn = document.getElementById('btnEquipSavedLoadout');
  const feedbackEl = document.getElementById('savedLoadoutFeedback');
  const container = document.getElementById('savedLoadoutItemsContainer');

  if (badgeLg) {
    badgeLg.style.backgroundImage = loadout.colorPath
      ? `url("https://www.bungie.net${loadout.colorPath}")`
      : 'none';
  }
  if (iconLg) {
    if (loadout.iconPath) {
      iconLg.src = `https://www.bungie.net${loadout.iconPath}`;
      iconLg.classList.remove('hidden');
    } else {
      iconLg.classList.add('hidden');
    }
  }
  if (subEl) {
    subEl.textContent = `${classGlyph(character.className)} ${character.className.toUpperCase()} // SAVED LOADOUT SLOT #${loadout.slotNumber}`;
  }
  if (titleEl) {
    titleEl.textContent = loadout.name || `Loadout ${loadout.slotNumber}`;
  }
  if (equipBtn) {
    equipBtn.disabled = false;
    equipBtn.textContent = `⚡ Equip Loadout on ${character.className}`;
  }
  if (feedbackEl) {
    feedbackEl.classList.add('hidden');
    feedbackEl.classList.remove('error');
  }

  if (container) {
    container.innerHTML = '';

    // 1. Subclass Configuration (Super, Aspects, Fragments, Abilities)
    if (loadout.subclass && loadout.subclass.name) {
      const sub = loadout.subclass;
      const subCard = document.createElement('div');
      subCard.className = 'saved-loadout-subclass-card';
      const sIcon = sub.icon ? `<img src="https://www.bungie.net${sub.icon}" alt="">` : '';

      const superHtml = sub.super ? `
        <div class="subclass-perk-group">
          <div class="subclass-group-title">⚡ SUPER ABILITY</div>
          <div class="subclass-chips-wrap">
            <span class="subclass-chip super-chip" title="${escapeHtml(sub.super.description || '')}">
              ${sub.super.icon ? `<img src="https://www.bungie.net${sub.super.icon}" alt="">` : ''}
              <span>${escapeHtml(sub.super.name)}</span>
            </span>
          </div>
        </div>
      ` : '';

      const aspectsHtml = (sub.aspects || []).length > 0 ? `
        <div class="subclass-perk-group">
          <div class="subclass-group-title">❖ ASPECTS (${sub.aspects.length})</div>
          <div class="subclass-chips-wrap">
            ${sub.aspects.map(a => `
              <span class="subclass-chip aspect-chip" title="${escapeHtml(a.description || '')}">
                ${a.icon ? `<img src="https://www.bungie.net${a.icon}" alt="">` : ''}
                <span>${escapeHtml(a.name)}</span>
              </span>
            `).join('')}
          </div>
        </div>
      ` : '';

      const fragmentsHtml = (sub.fragments || []).length > 0 ? `
        <div class="subclass-perk-group" style="flex:2; min-width:260px;">
          <div class="subclass-group-title">✦ FRAGMENTS (${sub.fragments.length})</div>
          <div class="subclass-chips-wrap">
            ${sub.fragments.map(f => `
              <span class="subclass-chip fragment-chip" title="${escapeHtml(f.description || '')}">
                ${f.icon ? `<img src="https://www.bungie.net${f.icon}" alt="">` : ''}
                <span>${escapeHtml(f.name)}</span>
              </span>
            `).join('')}
          </div>
        </div>
      ` : '';

      const abilitiesHtml = [sub.melee, sub.grenade, sub.classAbility].some(Boolean) ? `
        <div class="subclass-perk-group">
          <div class="subclass-group-title">🛡️ ABILITIES</div>
          <div class="subclass-chips-wrap">
            ${sub.melee ? `<span class="subclass-chip" title="Melee: ${escapeHtml(sub.melee.description || '')}">${sub.melee.icon ? `<img src="https://www.bungie.net${sub.melee.icon}" alt="">` : ''}<span>${escapeHtml(sub.melee.name)}</span></span>` : ''}
            ${sub.grenade ? `<span class="subclass-chip" title="Grenade: ${escapeHtml(sub.grenade.description || '')}">${sub.grenade.icon ? `<img src="https://www.bungie.net${sub.grenade.icon}" alt="">` : ''}<span>${escapeHtml(sub.grenade.name)}</span></span>` : ''}
            ${sub.classAbility ? `<span class="subclass-chip" title="Class Ability: ${escapeHtml(sub.classAbility.description || '')}">${sub.classAbility.icon ? `<img src="https://www.bungie.net${sub.classAbility.icon}" alt="">` : ''}<span>${escapeHtml(sub.classAbility.name)}</span></span>` : ''}
          </div>
        </div>
      ` : '';

      subCard.innerHTML = `
        <div class="saved-loadout-subclass-header">
          ${sIcon}
          <div>
            <div style="font-family:var(--font-tactical); font-size:11px; color:var(--arc-blue); font-weight:700; letter-spacing:0.8px;">SUBCLASS // ${escapeHtml((sub.element || '').toUpperCase())}</div>
            <div style="font-family:var(--font-display); font-size:16px; font-weight:700; color:#FFFFFF;">${escapeHtml(sub.name)}</div>
          </div>
        </div>
        <div class="saved-loadout-subclass-details">
          ${superHtml}
          ${aspectsHtml}
          ${abilitiesHtml}
          ${fragmentsHtml}
        </div>
      `;
      container.appendChild(subCard);
    }

    // 2. Equipped Seasonal Artifact & Active Perks
    const artifactObj = loadout.artifact || character.artifact;
    if (artifactObj && artifactObj.name) {
      const artCard = document.createElement('div');
      artCard.className = 'saved-loadout-artifact-card';
      const aIcon = artifactObj.icon ? `<img src="https://www.bungie.net${artifactObj.icon}" alt="">` : '';
      const bonusText = artifactObj.powerBonus ? `✦ +${artifactObj.powerBonus} Bonus Power` : 'Seasonal Artifact';
      const perksArr = artifactObj.activePerks || [];

      artCard.innerHTML = `
        <div class="saved-loadout-artifact-header">
          <div class="dim-artifact-icon-wrap" style="margin-right:10px;">
            ${aIcon}
          </div>
          <div>
            <div style="font-family:var(--font-tactical); font-size:11px; color:#C084FC; font-weight:700; letter-spacing:0.8px;">SEASONAL ARTIFACT</div>
            <div style="font-family:var(--font-display); font-size:15px; font-weight:700; color:#FFFFFF;">
              ${escapeHtml(artifactObj.name)} <span style="font-size:12px; color:#E9D5FF; margin-left:6px; font-weight:500;">(${bonusText})</span>
            </div>
          </div>
        </div>
        ${perksArr.length > 0 ? `
          <div class="artifact-perks-wrap" style="padding-top:8px; border-top:none;">
            ${perksArr.map(p => `
              <span class="artifact-perk-chip" title="${escapeHtml(p.description || '')}">
                ${p.icon ? `<img src="https://www.bungie.net${p.icon}" alt="">` : ''}
                <span>${escapeHtml(p.name)}</span>
              </span>
            `).join('')}
          </div>
        ` : ''}
      `;
      container.appendChild(artCard);
    }

    // 3. Saved Weapons & Saved Armor Rig (with Socketed Mods)
    const cols = document.createElement('div');
    cols.className = 'saved-loadout-columns';

    const buildLoadoutCol = (heading, itemsArr, isArmorGroup = false) => {
      const panel = document.createElement('div');
      panel.className = 'loadout-col-panel';
      panel.innerHTML = `<div class="loadout-col-header">${heading}</div>`;

      if (!itemsArr || itemsArr.length === 0) {
        const empty = document.createElement('p');
        empty.style.cssText = 'color:#64748B; font-size:13px;';
        empty.textContent = 'No items saved in this group.';
        panel.appendChild(empty);
      } else {
        itemsArr.forEach(slimItem => {
          const fullItem = findLiveItemByInstanceId(slimItem.itemInstanceId) || slimItem;
          if (isArmorGroup) {
            const wrap = document.createElement('div');
            wrap.className = 'loadout-armor-card-wrap';
            wrap.appendChild(createGearCardElement(fullItem));
            const modsArr = slimItem.mods || fullItem.mods || [];
            if (modsArr.length > 0) {
              const modsStrip = document.createElement('div');
              modsStrip.className = 'loadout-armor-mods-strip';
              modsArr.forEach(m => {
                const mChip = document.createElement('span');
                mChip.className = 'loadout-mod-chip';
                mChip.title = m.description || m.name;
                mChip.innerHTML = `${m.icon ? `<img src="https://www.bungie.net${m.icon}" alt="">` : ''}<span>${escapeHtml(m.name)}</span>`;
                modsStrip.appendChild(mChip);
              });
              wrap.appendChild(modsStrip);
            }
            panel.appendChild(wrap);
          } else {
            panel.appendChild(createGearCardElement(fullItem));
          }
        });
      }
      return panel;
    };

    cols.appendChild(buildLoadoutCol('⚔️ SAVED WEAPONS', loadout.weapons || [], false));
    cols.appendChild(buildLoadoutCol('🛡️ SAVED ARMOR RIG (WITH SOCKETED MODS)', loadout.armor || [], true));
    container.appendChild(cols);

    if (loadout.missingCount > 0) {
      const missNote = document.createElement('p');
      missNote.style.cssText = 'margin-top:10px; font-size:12px; color:#FBBF24; font-family:var(--font-tactical);';
      missNote.textContent = `⚠ Note: ${loadout.missingCount} item(s) originally saved in this loadout were dismantled or are no longer on your account.`;
      container.appendChild(missNote);
    }
  }

  modal.showModal();
}

async function executeEquipSavedLoadout() {
  if (!state.inspectedLoadout || !state.bungieData) return;
  const { character, loadout } = state.inspectedLoadout;
  const equipBtn = document.getElementById('btnEquipSavedLoadout');
  const feedbackEl = document.getElementById('savedLoadoutFeedback');

  if (equipBtn) equipBtn.disabled = true;
  if (feedbackEl) {
    feedbackEl.classList.remove('hidden', 'error');
    feedbackEl.textContent = `Applying '${loadout.name}' on ${character.className}...`;
  }
  sfx.playTransmit();

  try {
    const res = await fetch('/api/bungie/loadout/equip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.bungieSession.access_token}`,
        'X-Bungie-Refresh': state.bungieSession.refresh_token || ''
      },
      body: JSON.stringify({
        membershipType: state.bungieData.player.membershipType,
        characterId: character.characterId,
        loadoutIndex: loadout.loadoutIndex
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Could not equip loadout (make sure your character is in Orbit, the Tower, or Offline).');
    }
    if (data.refreshed_session) {
      saveBungieSession(data.refreshed_session);
    }

    sfx.playReceive();
    if (feedbackEl) {
      feedbackEl.textContent = `✓ '${loadout.name}' equipped on ${character.className}!`;
    }
    await loadBungieInventory(true);
  } catch (err) {
    sfx.playAlert();
    if (feedbackEl) {
      feedbackEl.classList.remove('hidden');
      feedbackEl.classList.add('error');
      feedbackEl.textContent = `⚠ ${err.message}`;
    }
  } finally {
    if (equipBtn) equipBtn.disabled = false;
  }
}

function collectInventoryAndVaultGodRolls() {
  const data = state.bungieData;
  if (!data) {
    return {
      totalWeapons: 0,
      bestRolls: [],
      outclassedRolls: [],
      duplicateFamilies: [],
      dismantleCandidates: [],
      byInstanceId: new Map(),
      pveBestCount: 0,
      pvpBestCount: 0,
      unlockedBestCount: 0,
      outclassedCount: 0,
      dismantleCount: 0
    };
  }

  const seenIds = new Set();
  const byInstanceId = new Map();
  const allEntries = [];
  let totalWeapons = 0;

  const inspectList = (itemsArr, locLabel, ownerCharId) => {
    (itemsArr || []).forEach(item => {
      if (item.category !== 'Weapon' && item.category !== 'Armor') return;
      const key = item.itemInstanceId || `${item.itemHash}_${locLabel}`;
      if (seenIds.has(key)) return;
      seenIds.add(key);
      totalWeapons++;

      const grc = item.godRollCheck || {};
      const vc = grc.verdictCode || '';
      const isGod = ['DUAL_GOD_ROLL', 'PVE_GOD_ROLL', 'PVP_GOD_ROLL'].includes(vc);
      const isBest = typeof grc.isBestGodRoll === 'boolean' ? grc.isBestGodRoll : isGod;
      const isOutclassed = Boolean(grc.isOutclassedDuplicate);

      const entry = {
        item,
        grc,
        verdictCode: vc,
        isGod,
        isBest,
        isOutclassed,
        locLabel,
        ownerCharId
      };
      allEntries.push(entry);
      if (item.itemInstanceId) {
        byInstanceId.set(String(item.itemInstanceId), entry);
      }
    });
  };

  (data.characters || []).forEach(ch => {
    const cUpper = (ch.className || 'Character').toUpperCase();
    inspectList(ch.equipment, `EQUIPPED • ${cUpper}`, ch.characterId);
    inspectList(ch.inventory, `INVENTORY • ${cUpper}`, ch.characterId);
    inspectList(ch.postmaster, `POSTMASTER • ${cUpper}`, ch.characterId);
  });

  inspectList(data.vault?.items || [], 'IN VAULT', '');

  const vcOrder = { DUAL_GOD_ROLL: 0, PVE_GOD_ROLL: 1, PVP_GOD_ROLL: 2 };
  const bestRolls = allEntries.filter(e => e.isGod && e.isBest);
  bestRolls.sort((a, b) => {
    if (Boolean(a.item.isLocked) !== Boolean(b.item.isLocked)) {
      return a.item.isLocked ? 1 : -1;
    }
    const aHasDups = (a.grc.beatenDuplicateIds || []).length > 0 ? 0 : 1;
    const bHasDups = (b.grc.beatenDuplicateIds || []).length > 0 ? 0 : 1;
    if (aHasDups !== bHasDups) return aHasDups - bHasDups;
    const vo = (vcOrder[a.verdictCode] ?? 9) - (vcOrder[b.verdictCode] ?? 9);
    if (vo !== 0) return vo;
    const sc = (b.grc.bestScore || 0) - (a.grc.bestScore || 0);
    if (sc !== 0) return sc;
    return (b.item.power || 0) - (a.item.power || 0);
  });

  const outclassedRolls = allEntries.filter(e => e.isOutclassed);
  outclassedRolls.sort((a, b) => (b.grc.bestScore || 0) - (a.grc.bestScore || 0));

  // Build weapon family duplicate groups (any gun where 2+ God Rolls exist, OR 1+ God Roll + inferior extra copies)
  const familyMap = new Map();
  allEntries.forEach(e => {
    const fkey = e.grc.weaponFamilyKey || String(e.item.itemHash || e.item.name);
    if (!familyMap.has(fkey)) {
      familyMap.set(fkey, {
        familyKey: fkey,
        weaponName: e.item.name,
        winners: [],
        outclassedGods: [],
        inferiorExtras: []
      });
    }
    const grp = familyMap.get(fkey);
    if (e.isGod && e.isBest) {
      grp.winners.push(e);
    } else if (e.isOutclassed) {
      grp.outclassedGods.push(e);
    } else if (e.grc.dismantleTier === 'EXTRA_COPY_OWNED_GOD_ROLL') {
      grp.inferiorExtras.push(e);
    }
  });

  const duplicateFamilies = Array.from(familyMap.values()).filter(
    g => g.winners.length > 0 && (g.outclassedGods.length > 0 || g.winners.length > 1 || g.inferiorExtras.length > 0)
  );
  duplicateFamilies.sort((a, b) => {
    const aOut = a.outclassedGods.length;
    const bOut = b.outclassedGods.length;
    if (bOut !== aOut) return bOut - aOut;
    return (b.winners.length + b.inferiorExtras.length) - (a.winners.length + a.inferiorExtras.length);
  });

  const tierOrder = { OUTCLASSED_GOD_ROLL: 0, EXTRA_COPY_OWNED_GOD_ROLL: 1, BAD_ROLL: 2 };
  const dismantleCandidates = allEntries.filter(e => Boolean(e.grc.dismantleCandidate));
  dismantleCandidates.sort((a, b) => {
    const to = (tierOrder[a.grc.dismantleTier] ?? 9) - (tierOrder[b.grc.dismantleTier] ?? 9);
    if (to !== 0) return to;
    return a.item.name.localeCompare(b.item.name);
  });

  // Pre-select safe duplicate candidates on initial scan (never auto-selects highest-power slot items or random bad rolls unless clicked)
  if (!state.dismantleSelectionInitialized) {
    state.dismantleSelectedIds = new Set();
    dismantleCandidates.forEach(e => {
      if (e.grc.dismantleAutoSelect && e.item.itemInstanceId) {
        state.dismantleSelectedIds.add(String(e.item.itemInstanceId));
      }
    });
    state.dismantleSelectionInitialized = true;
  } else {
    const validIds = new Set(dismantleCandidates.map(e => String(e.item.itemInstanceId)));
    for (const id of Array.from(state.dismantleSelectedIds)) {
      if (!validIds.has(id)) state.dismantleSelectedIds.delete(id);
    }
  }

  const pveBestCount = bestRolls.filter(g => g.verdictCode === 'PVE_GOD_ROLL' || g.verdictCode === 'DUAL_GOD_ROLL').length;
  const pvpBestCount = bestRolls.filter(g => g.verdictCode === 'PVP_GOD_ROLL' || g.verdictCode === 'DUAL_GOD_ROLL').length;
  const unlockedBestCount = bestRolls.filter(g => !g.item.isLocked && g.item.location !== 'postmaster').length;

  return {
    totalWeapons,
    bestRolls,
    outclassedRolls,
    duplicateFamilies,
    dismantleCandidates,
    byInstanceId,
    pveBestCount,
    pvpBestCount,
    unlockedBestCount,
    outclassedCount: outclassedRolls.length,
    dupFamiliesCount: duplicateFamilies.length,
    dismantleCount: dismantleCandidates.length
  };
}

function openGodRollScannerModal() {
  if (!state.bungieData) return;
  sfx.playTransmit();
  markGodRollsScanned();
  state.scannerFilter = 'all';

  document.querySelectorAll('#scannerFilterPills .inv-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.scanfilter === 'all');
  });

  const fb = document.getElementById('scannerLockFeedback');
  if (fb) {
    fb.classList.add('hidden');
    fb.classList.remove('error');
  }

  renderScannerModalContent();
  const modal = document.getElementById('modalGodRollScanner');
  if (modal) modal.showModal();
}

function buildScannerEntryCard(entry, { viewMode = 'best', byInstanceId = new Map() } = {}) {
  const it = entry.item;
  const grc = entry.grc || it.godRollCheck || {};
  const iid = String(it.itemInstanceId || '');
  const isDismantleView = viewMode === 'dismantle';
  const isOutclassed = Boolean(entry.isOutclassed);

  const shell = document.createElement('div');
  shell.className = `scanner-card-shell ${isOutclassed ? 'is-outclassed' : ''} ${isDismantleView ? 'is-dismantle-row' : ''}`.trim();

  const row = document.createElement('div');
  row.className = 'scanner-item-row';

  const iconSrc = it.icon ? `https://www.bungie.net${it.icon}` : 'icon-192.png';

  // Mode / Verdict badge
  let modeBadge = '';
  if (entry.verdictCode === 'DUAL_GOD_ROLL') {
    modeBadge = `<span class="scanner-mode-tag dual">★ PVE + PVP GOD ROLL</span>`;
  } else if (entry.verdictCode === 'PVE_GOD_ROLL') {
    if (it.category === 'Armor' && (it.armorEvaluation?.healthStat || 0) > 2) {
      modeBadge = `<span class="scanner-mode-tag pve">🛡️ PVE ARMOR (${it.armorEvaluation.healthStat} HP)</span>`;
    } else {
      modeBadge = `<span class="scanner-mode-tag pve">⚔️ PVE GOD ROLL</span>`;
    }
  } else if (entry.verdictCode === 'PVP_GOD_ROLL') {
    modeBadge = `<span class="scanner-mode-tag pvp">🎯 PVP GOD ROLL</span>`;
  }

  // Score & Winner / Outclassed / Trash Rank badge
  let rankBadge = '';
  if (isOutclassed) {
    rankBadge = `<span class="scanner-score-badge outclassed">⚠ DUP #${grc.duplicateRank || 2} • ${grc.bestScore || 0}/100</span>`;
  } else if (entry.isGod && entry.isBest) {
    const crownTxt = (grc.familyGodRollCount || 0) > 1
      ? `👑 #1 BEST • ${grc.bestScore || 0}/100`
      : `★ SCORE ${grc.bestScore || 0}/100`;
    rankBadge = `<span class="scanner-score-badge best">${crownTxt}</span>`;
  } else if (grc.dismantleCandidate) {
    rankBadge = `<span class="scanner-score-badge trash">🗑️ ${escapeHtml(grc.dismantleLabel || 'Shard Candidate')}</span>`;
  }

  const extraFlags = [];
  if (it.isCrafted) {
    extraFlags.push(`<span class="scanner-loc-pill" style="color:#F87171; border:1px solid rgba(248,113,113,0.4);">◈ CRAFTED</span>`);
  }
  if (grc.isAdeptVariant) {
    extraFlags.push(`<span class="scanner-loc-pill" style="color:#FDE047; border:1px solid rgba(250,204,21,0.4);">ADEPT</span>`);
  }
  if (grc.isHighestPowerInSlot && isDismantleView) {
    extraFlags.push(`<span class="scanner-loc-pill" style="color:#38BDF8; border:1px solid rgba(56,189,248,0.45);">⚡ HIGHEST SLOT POWER</span>`);
  }
  if (grc.inDatabase && entry.isGod) {
    extraFlags.push(`<span class="scanner-loc-pill" style="color:#FDE047; border:1px solid rgba(250,204,21,0.35);">MY GOD ROLLS</span>`);
  }

  // Perk chips (Weapons: matched PVE/PVP traits; Armor: Total stats, Health rating, & Compendium 2pc/4pc set)
  const perkTags = [];
  if (it.category === 'Armor') {
    const aev = it.armorEvaluation || {};
    perkTags.push(`<span class="scanner-perk-chip">✦ Total: <strong>${it.totalStats || 0} Stats</strong></span>`);
    const hpVal = aev.healthStat || 0;
    let hpStyle = 'color:#6EE7B7; border-color:rgba(52,211,153,0.4);';
    let hpText = '0 Health (PVE God Roll)';
    if (hpVal >= 10) {
      hpStyle = 'color:#FDA4AF; border-color:rgba(244,63,94,0.4);';
      hpText = `${hpVal} Health (PVP Spike 10+)`;
    } else if (hpVal > 2) {
      hpStyle = 'color:#A7F3D0; border-color:rgba(167,243,208,0.35);';
      hpText = `${hpVal} Health (PvE Low Health)`;
    }
    perkTags.push(`<span class="scanner-perk-chip" style="${hpStyle}"><strong>${hpText}</strong></span>`);
    if (it.compendiumSet) {
      perkTags.push(`<span class="scanner-perk-chip" style="color:#FDE047; border-color:rgba(245,166,35,0.45);">⛊ <strong>${escapeHtml(it.compendiumSet.name)}</strong> (2pc: ${escapeHtml(it.compendiumSet.perk2pc?.name || '')})</span>`);
    }
  } else {
    if ((grc.pveMatchedPerks || []).length >= 2) {
      perkTags.push(`<span class="scanner-perk-chip">⚔️ PVE: <strong>${escapeHtml(grc.pveMatchedPerks.join(' + '))}</strong></span>`);
    }
    if ((grc.pvpMatchedPerks || []).length >= 2) {
      perkTags.push(`<span class="scanner-perk-chip">🎯 PVP: <strong>${escapeHtml(grc.pvpMatchedPerks.join(' + '))}</strong></span>`);
    }
    if (perkTags.length === 0) {
      const tCols = (it.traitColIndexes || []).map(idx => it.perkColumns?.[idx]).filter(Boolean);
      const fallbackCols = tCols.length >= 2 ? tCols : (it.perkColumns || []).slice(2, 4);
      const rolledNames = fallbackCols
        .map(col => (col.find(o => o.selected) || col[0])?.name)
        .filter(Boolean);
      if (rolledNames.length > 0) {
        perkTags.push(`<span class="scanner-perk-chip">Perks: <strong>${escapeHtml(rolledNames.join(' + '))}</strong></span>`);
      }
    }
  }

  // Breakdown strip (Weapons: Barrel / Mag / MW; Armor: Key 0-200 Stats)
  const subParts = [];
  if (it.category === 'Armor') {
    (it.stats || []).forEach(st => {
      if (st.value > 0) {
        subParts.push(`<span class="scanner-subpart-pill">${escapeHtml(st.name)}: ${st.value}</span>`);
      }
    });
  } else {
    if (grc.bestBarrel) subParts.push(`<span class="scanner-subpart-pill">Barrel: ${escapeHtml(grc.bestBarrel)}</span>`);
    if (grc.bestMag) subParts.push(`<span class="scanner-subpart-pill">Mag: ${escapeHtml(grc.bestMag)}</span>`);
    if (grc.masterworkName) subParts.push(`<span class="scanner-subpart-pill">MW: ${escapeHtml(grc.masterworkName)}</span>`);
  }
  const subPartsHtml = subParts.length > 0 ? `<div class="scanner-subparts-strip">${subParts.join('')}</div>` : '';

  // Comparison / Dismantle Reason Callout
  let calloutHtml = '';
  if (isDismantleView && grc.dismantleReason) {
    const cls = isOutclassed ? 'outclassed' : 'trash';
    calloutHtml = `<div class="scanner-compare-callout ${cls}">${escapeHtml(grc.dismantleReason)}</div>`;
  } else if (grc.comparisonSummary) {
    const cls = isOutclassed ? 'outclassed' : 'winner';
    const prefix = isOutclassed ? '⚠ ' : '👑 ';
    calloutHtml = `<div class="scanner-compare-callout ${cls}">${prefix}${escapeHtml(grc.comparisonSummary)}</div>`;
  }

  // Checkbox in Dismantle View (wrapped in 44px <label> per modern-web-guidance `checkbox`)
  const chkId = `chk_dism_${iid}`;
  const isChecked = state.dismantleSelectedIds.has(iid);
  const checkboxHtml = isDismantleView && iid
    ? `<label class="dismantle-check-label" for="${escapeHtml(chkId)}" title="Select for Dismantle Prep">
         <input type="checkbox" class="checkbox-custom" id="${escapeHtml(chkId)}" ${isChecked ? 'checked' : ''}>
       </label>`
    : '';

  // Right-side action buttons:
  // Outclassed duplicates CANNOT be locked as God Rolls (only unlocked if already locked!)
  const isPm = it.location === 'postmaster';
  let primaryActionBtnHtml = '';
  if (isDismantleView) {
    const pullLbl = it.isLocked ? '🔓 Unlock & Pull' : '📥 Pull to Char';
    primaryActionBtnHtml = `<button type="button" class="btn-mini-action" data-role="pull-single" style="border-color:rgba(251,113,133,0.55); color:#FDA4AF;">${pullLbl}</button>`;
  } else if (isPm) {
    primaryActionBtnHtml = `<button type="button" class="btn-lock-toggle is-blocked" disabled>📬 In Postmaster</button>`;
  } else if (isOutclassed) {
    if (it.isLocked) {
      primaryActionBtnHtml = `<button type="button" class="btn-lock-toggle unlock-dup" data-role="unlock-dup" title="This roll is outclassed by your #1 copy—unlock so you can dismantle it">🔓 Unlock Duplicate</button>`;
    } else {
      primaryActionBtnHtml = `<button type="button" class="btn-lock-toggle is-blocked" disabled title="Only your #1 Best copy of each gun can be locked as a God Roll">🚫 Outclassed (#${grc.duplicateRank || 2})</button>`;
    }
  } else {
    const lockBtnLabel = it.isLocked ? '🔒 Locked' : '🔓 Lock';
    primaryActionBtnHtml = `<button type="button" class="btn-lock-toggle ${it.isLocked ? 'is-locked' : ''}" data-role="lock-one">${lockBtnLabel}</button>`;
  }

  const isExotic = it.isExotic || it.tierName === 'Exotic';
  const resolvedTier = isExotic ? null : resolveItemGearTier(it);
  it.gearTier = resolvedTier;
  const scannerTierStars = (!isExotic && resolvedTier) ? renderTierStarsHtml(resolvedTier) : '';
  const scannerTierPill = (!isExotic && resolvedTier && resolvedTier >= 1 && resolvedTier <= 5)
    ? `<span class="gear-tier-pill t${resolvedTier}">T${resolvedTier}</span>`
    : '';

  row.innerHTML = `
    <div class="scanner-item-main">
      ${checkboxHtml}
      <div class="scanner-item-icon">
        <img src="${iconSrc}" alt="${escapeHtml(it.name)}" width="52" height="52" loading="lazy">
        ${scannerTierStars}
      </div>
      <div class="scanner-item-info">
        <div class="scanner-item-top">
          <span class="scanner-item-name">${escapeHtml(it.name)}</span>
          <span style="color:#FACC15; font-family:var(--font-tactical); font-weight:700; font-size:12.5px;">✦ ${it.power || ''}</span>
          ${scannerTierPill}
          <span class="scanner-loc-pill">${escapeHtml(entry.locLabel)}</span>
          ${rankBadge}
          ${modeBadge}
          ${extraFlags.join('')}
        </div>
        <div class="scanner-perks-line">
          ${perkTags.join('')}
        </div>
        ${subPartsHtml}
        ${calloutHtml}
      </div>
    </div>
    <div class="scanner-item-actions">
      ${primaryActionBtnHtml}
      <button type="button" class="btn-mini-action" data-role="inspect-one">Inspect</button>
    </div>
  `;

  if (isDismantleView && iid) {
    const chkEl = row.querySelector(`#${CSS.escape(chkId)}`);
    if (chkEl) {
      chkEl.addEventListener('change', () => {
        if (chkEl.checked) {
          state.dismantleSelectedIds.add(iid);
        } else {
          state.dismantleSelectedIds.delete(iid);
        }
        syncDismantleToolbarState(collectInventoryAndVaultGodRolls());
      });
    }
    const pullSingleBtn = row.querySelector('[data-role="pull-single"]');
    if (pullSingleBtn) {
      pullSingleBtn.addEventListener('click', async () => {
        pullSingleBtn.disabled = true;
        await executeDismantlePrep(false, [entry]);
      });
    }
  }

  const lockOneBtn = row.querySelector('[data-role="lock-one"]');
  if (lockOneBtn && !isPm && !isOutclassed) {
    lockOneBtn.addEventListener('click', async () => {
      lockOneBtn.disabled = true;
      await toggleSingleItemLock(it, !it.isLocked);
      renderScannerModalContent();
    });
  }

  const unlockDupBtn = row.querySelector('[data-role="unlock-dup"]');
  if (unlockDupBtn && isOutclassed) {
    unlockDupBtn.addEventListener('click', async () => {
      unlockDupBtn.disabled = true;
      await toggleSingleItemLock(it, false);
      renderScannerModalContent();
    });
  }

  const inspectOneBtn = row.querySelector('[data-role="inspect-one"]');
  if (inspectOneBtn) {
    inspectOneBtn.addEventListener('click', () => openItemInspectModal(it));
  }

  shell.appendChild(row);

  // If rendering #1 Best Rolls tab and this #1 copy beat weaker duplicate God Rolls, attach inline Duplicate Showdown!
  if (viewMode === 'best' && (grc.beatenDuplicateIds || []).length > 0) {
    const beatenEntries = grc.beatenDuplicateIds
      .map(id => byInstanceId.get(String(id)))
      .filter(Boolean);
    if (beatenEntries.length > 0) {
      const details = document.createElement('details');
      details.className = 'scanner-dup-drawer';
      if (state.dupDrawerOpen[iid]) {
        details.setAttribute('open', '');
      }
      details.addEventListener('toggle', () => {
        state.dupDrawerOpen[iid] = details.open;
      });

      const sumEl = document.createElement('summary');
      sumEl.className = 'scanner-dup-summary';
      sumEl.innerHTML = `<span>⚖️ Beat ${beatenEntries.length} weaker God Roll ${beatenEntries.length === 1 ? 'copy' : 'copies'} of ${escapeHtml(it.name)} (Only #1 above can be locked)</span>`;
      details.appendChild(sumEl);

      const dupList = document.createElement('div');
      dupList.className = 'scanner-dup-list';
      beatenEntries.forEach(bEntry => {
        dupList.appendChild(buildScannerEntryCard(bEntry, { viewMode: 'dup-child', byInstanceId }));
      });
      details.appendChild(dupList);
      shell.appendChild(details);
    }
  }

  return shell;
}

function syncDismantleToolbarState(summary) {
  const toolbar = document.getElementById('scannerDismantleToolbar');
  const chkAll = document.getElementById('chkSelectAllDismantle');
  const lblAll = document.getElementById('lblSelectAllDismantle');
  const charSelect = document.getElementById('selectDismantleChar');
  const btnUnlock = document.getElementById('btnUnlockSelectedTrash');
  const btnPull = document.getElementById('btnPullSelectedTrash');
  const btnPresetDups = document.getElementById('btnPresetDuplicatesOnly');
  const btnPresetAll = document.getElementById('btnPresetAllTrash');

  if (!toolbar) return;
  const isDismantleTab = state.scannerFilter === 'dismantle';
  toolbar.classList.toggle('hidden', !isDismantleTab);
  if (!isDismantleTab) return;

  const total = summary.dismantleCandidates.length;
  const selectedCount = summary.dismantleCandidates.filter(
    e => state.dismantleSelectedIds.has(String(e.item.itemInstanceId))
  ).length;
  const dupOnlyCount = summary.dismantleCandidates.filter(
    e => e.grc.dismantleTier === 'OUTCLASSED_GOD_ROLL' || e.grc.dismantleTier === 'EXTRA_COPY_OWNED_GOD_ROLL'
  ).length;

  if (chkAll) {
    chkAll.disabled = total === 0;
    chkAll.checked = total > 0 && selectedCount === total;
    chkAll.indeterminate = selectedCount > 0 && selectedCount < total;
  }
  if (lblAll) {
    lblAll.textContent = `Selected (${selectedCount}/${total})`;
  }
  if (btnPresetDups) {
    btnPresetDups.textContent = `Duplicates Only (${dupOnlyCount})`;
  }
  if (btnPresetAll) {
    btnPresetAll.textContent = `All Trash + Dups (${total})`;
  }

  // Populate character target picker with live free weapon bag slot count
  const chars = state.bungieData?.characters || [];
  if (charSelect && chars.length > 0) {
    if (!state.dismantleTargetCharId || !chars.some(c => c.characterId === state.dismantleTargetCharId)) {
      state.dismantleTargetCharId = chars[0].characterId;
    }
    charSelect.innerHTML = '';
    chars.forEach(ch => {
      const wepBagCount = (ch.inventory || []).filter(i => i.category === 'Weapon').length;
      const freeWepSlots = Math.max(0, 27 - wepBagCount);
      const opt = document.createElement('option');
      opt.value = ch.characterId;
      opt.selected = ch.characterId === state.dismantleTargetCharId;
      opt.textContent = `${ch.className} (${freeWepSlots} open weapon slots)`;
      charSelect.appendChild(opt);
    });
  }

  const chosenChar = chars.find(c => c.characterId === state.dismantleTargetCharId);
  const chosenClassName = chosenChar?.className || 'Character';

  if (btnUnlock) {
    btnUnlock.disabled = selectedCount === 0;
    btnUnlock.textContent = `🔓 Unlock Only (${selectedCount})`;
  }
  if (btnPull) {
    btnPull.disabled = selectedCount === 0 || !chosenChar;
    btnPull.textContent = `📥 Unlock & Pull to ${chosenClassName} (${selectedCount})`;
  }
}

function renderScannerModalContent() {
  const summary = collectInventoryAndVaultGodRolls();
  const msgEl = document.getElementById('scannerFeliciaMsg');
  const kpiEl = document.getElementById('scannerKpiStrip');
  const listEl = document.getElementById('scannerResultsList');
  const lockAllBtn = document.getElementById('btnLockAllGodRolls');

  const pillAll = document.getElementById('scanPillAll');
  const pillPve = document.getElementById('scanPillPve');
  const pillPvp = document.getElementById('scanPillPvp');
  const pillDups = document.getElementById('scanPillDuplicates');
  const pillDism = document.getElementById('scanPillDismantle');

  if (pillAll) pillAll.textContent = `👑 Best Rolls (${summary.bestRolls.length})`;
  if (pillPve) pillPve.textContent = `⚔️ PVE Best (${summary.pveBestCount})`;
  if (pillPvp) pillPvp.textContent = `🎯 PVP Best (${summary.pvpBestCount})`;
  if (pillDups) pillDups.textContent = `⚖️ Duplicates (${summary.dupFamiliesCount})`;
  if (pillDism) pillDism.textContent = `🗑️ Dismantle Helper (${summary.dismantleCount})`;

  syncDismantleToolbarState(summary);

  if (msgEl) {
    const dupSentence = summary.outclassedCount > 0
      ? ` I also compared your duplicate weapons head-to-head and flagged <strong>${summary.outclassedCount} weaker duplicate God ${summary.outclassedCount === 1 ? 'Roll' : 'Rolls'}</strong>—only the <strong>#1 Best</strong> copy of each gun can be locked!`
      : '';
    const trashSentence = summary.dismantleCount > 0
      ? ` Open <strong>🗑️ Dismantle Helper (${summary.dismantleCount})</strong> anytime to unlock &amp; pull weaker duplicates or bad rolls straight to your Character for fast sharding.`
      : '';

    if (summary.bestRolls.length === 0) {
      msgEl.innerHTML = `All right, Guardian—I swept all <strong>${summary.totalWeapons}</strong> weapons across your Characters and Vault. None hit a full 2-trait PVE or PVP God Roll yet.${trashSentence}`;
    } else if (summary.unlockedBestCount > 0) {
      msgEl.innerHTML = `Right then, Guardian! I swept <strong>${summary.totalWeapons} weapons</strong> and crowned <strong>${summary.bestRolls.length} #1 Best God Rolls</strong> (<strong>${summary.pveBestCount} PVE</strong>, <strong>${summary.pvpBestCount} PVP</strong>).${dupSentence} <strong>${summary.unlockedBestCount}</strong> #1 ${summary.unlockedBestCount === 1 ? 'winner is' : 'winners are'} unlocked—tap <strong>Lock Best God Rolls</strong>!${trashSentence}`;
    } else {
      msgEl.innerHTML = `Spot on, Guardian! All <strong>${summary.bestRolls.length} #1 Best God Rolls</strong> across your Characters and Vault are safely <strong>locked (🔒)</strong>!${dupSentence}${trashSentence}`;
    }
  }

  if (kpiEl) {
    kpiEl.innerHTML = `
      <div class="scanner-kpi-box">
        <span class="scanner-kpi-val">${summary.totalWeapons}</span>
        <span class="scanner-kpi-lbl">Weapons Scanned</span>
      </div>
      <div class="scanner-kpi-box">
        <span class="scanner-kpi-val" style="color:#FDE047;">${summary.bestRolls.length}</span>
        <span class="scanner-kpi-lbl">👑 #1 Best Rolls</span>
      </div>
      <div class="scanner-kpi-box">
        <span class="scanner-kpi-val" style="color:#FDBA74;">${summary.outclassedCount}</span>
        <span class="scanner-kpi-lbl">⚖️ Outclassed Dups</span>
      </div>
      <div class="scanner-kpi-box">
        <span class="scanner-kpi-val" style="color:${summary.unlockedBestCount > 0 ? '#F5A623' : '#6EE7B7'};">${summary.unlockedBestCount}</span>
        <span class="scanner-kpi-lbl">🔓 Unlocked #1s</span>
      </div>
      <div class="scanner-kpi-box">
        <span class="scanner-kpi-val" style="color:#FDA4AF;">${summary.dismantleCount}</span>
        <span class="scanner-kpi-lbl">🗑️ Dismantle Prep</span>
      </div>
    `;
  }

  if (lockAllBtn) {
    if (summary.unlockedBestCount > 0) {
      lockAllBtn.disabled = false;
      lockAllBtn.textContent = `🔒 Lock Best God Rolls (${summary.unlockedBestCount})`;
    } else {
      lockAllBtn.disabled = true;
      lockAllBtn.textContent = summary.bestRolls.length > 0 ? '✓ All #1 Best Rolls Locked' : '🔒 No Unlocked #1 Rolls';
    }
  }

  if (!listEl) return;
  listEl.innerHTML = '';

  // Tab 4: Grouped Duplicate Showdown View
  if (state.scannerFilter === 'duplicates') {
    if (summary.duplicateFamilies.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding:28px; color:#94A3B8; font-family:var(--font-tactical);">No duplicate copies of any God Roll weapon were found—every God Roll you own is already unique!</div>`;
      return;
    }
    summary.duplicateFamilies.forEach(fam => {
      const famCard = document.createElement('div');
      famCard.className = 'dup-family-card';
      const totalFamCount = fam.winners.length + fam.outclassedGods.length + fam.inferiorExtras.length;
      famCard.innerHTML = `
        <div class="dup-family-header">
          <span>⚖️ ${escapeHtml(fam.weaponName)} — ${totalFamCount} Copies Compared</span>
          <span style="font-family:var(--font-tactical); font-size:12px; color:#A7F3D0;">
            ${fam.winners.length} Keeper${fam.winners.length > 1 ? 's' : ''} • ${fam.outclassedGods.length + fam.inferiorExtras.length} Safe to Dismantle
          </span>
        </div>
      `;
      const body = document.createElement('div');
      body.className = 'dup-family-body';
      fam.winners.forEach(w => body.appendChild(buildScannerEntryCard(w, { viewMode: 'dup-group', byInstanceId: summary.byInstanceId })));
      fam.outclassedGods.forEach(o => body.appendChild(buildScannerEntryCard(o, { viewMode: 'dup-group', byInstanceId: summary.byInstanceId })));
      fam.inferiorExtras.forEach(ex => body.appendChild(buildScannerEntryCard(ex, { viewMode: 'dup-group', byInstanceId: summary.byInstanceId })));
      famCard.appendChild(body);
      listEl.appendChild(famCard);
    });
    return;
  }

  // Tab 5: Dismantle Helper View
  if (state.scannerFilter === 'dismantle') {
    if (summary.dismantleCandidates.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding:28px; color:#94A3B8; font-family:var(--font-tactical);">Your Vault &amp; Character bags are super clean—no outclassed duplicates or 0/2 bad rolls found!</div>`;
      return;
    }
    summary.dismantleCandidates.forEach(entry => {
      listEl.appendChild(buildScannerEntryCard(entry, { viewMode: 'dismantle', byInstanceId: summary.byInstanceId }));
    });
    return;
  }

  // Tabs 1-3: #1 Best God Rolls (All / PVE Best / PVP Best)
  const filtered = summary.bestRolls.filter(entry => {
    if (state.scannerFilter === 'pve') {
      return entry.verdictCode === 'PVE_GOD_ROLL' || entry.verdictCode === 'DUAL_GOD_ROLL';
    }
    if (state.scannerFilter === 'pvp') {
      return entry.verdictCode === 'PVP_GOD_ROLL' || entry.verdictCode === 'DUAL_GOD_ROLL';
    }
    return true;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<div style="text-align:center; padding:28px; color:#94A3B8; font-family:var(--font-tactical);">No #1 Best God Rolls match this filter tab.</div>`;
    return;
  }

  filtered.forEach(entry => {
    listEl.appendChild(buildScannerEntryCard(entry, { viewMode: 'best', byInstanceId: summary.byInstanceId }));
  });
}

async function toggleSingleItemLock(item, desiredLockState) {
  if (!state.bungieData || !item.itemInstanceId) return;
  if (desiredLockState && item.godRollCheck?.isOutclassedDuplicate) {
    sfx.playAlert();
    alert(`${item.name} is an outclassed duplicate roll. Only your #1 Best copy can be locked as a God Roll!`);
    return;
  }
  const defaultCharId = state.bungieData.characters?.[0]?.characterId || '';
  sfx.playChirp();

  try {
    const res = await fetch('/api/bungie/lock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.bungieSession.access_token}`,
        'X-Bungie-Refresh': state.bungieSession.refresh_token || ''
      },
      body: JSON.stringify({
        membershipType: state.bungieData.player.membershipType,
        defaultCharacterId: defaultCharId,
        state: Boolean(desiredLockState),
        items: [{
          itemInstanceId: item.itemInstanceId,
          characterId: item.characterId || defaultCharId,
          name: item.name
        }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lock update failed.');
    if (data.refreshed_session) saveBungieSession(data.refreshed_session);

    if ((data.lockedIds || []).includes(item.itemInstanceId)) {
      item.isLocked = Boolean(desiredLockState);
      sfx.playReceive();
      renderInventoryStage();
    } else if ((data.failed || []).length > 0) {
      throw new Error(data.failed[0].reason || 'Bungie rejected lock change.');
    }
  } catch (err) {
    sfx.playAlert();
    alert(`Could not change lock state for ${item.name}: ${err.message}`);
  }
}

async function lockAllScannedGodRolls() {
  if (!state.bungieData) return;
  const summary = collectInventoryAndVaultGodRolls();
  // STRICTLY lock ONLY #1 Best God Rolls — never lock outclassed duplicates!
  const targets = summary.bestRolls.filter(g => !g.item.isLocked && g.item.location !== 'postmaster');
  if (targets.length === 0) return;

  const lockAllBtn = document.getElementById('btnLockAllGodRolls');
  const feedbackEl = document.getElementById('scannerLockFeedback');
  const defaultCharId = state.bungieData.characters?.[0]?.characterId || '';

  if (lockAllBtn) {
    lockAllBtn.disabled = true;
    lockAllBtn.textContent = `🔒 Locking ${targets.length} #1 Best Rolls...`;
  }
  if (feedbackEl) {
    feedbackEl.classList.remove('hidden', 'error');
    feedbackEl.textContent = `F.E.L.I.C.I.A. is locking your ${targets.length} #1 Best God Rolls on Bungie.net (skipping any weaker duplicates)...`;
  }
  sfx.playTransmit();

  try {
    const res = await fetch('/api/bungie/lock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.bungieSession.access_token}`,
        'X-Bungie-Refresh': state.bungieSession.refresh_token || ''
      },
      body: JSON.stringify({
        membershipType: state.bungieData.player.membershipType,
        defaultCharacterId: defaultCharId,
        state: true,
        items: targets.map(t => ({
          itemInstanceId: t.item.itemInstanceId,
          characterId: t.item.characterId || defaultCharId,
          name: t.item.name
        }))
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Batch lock failed.');
    if (data.refreshed_session) saveBungieSession(data.refreshed_session);

    const lockedSet = new Set(data.lockedIds || []);
    targets.forEach(t => {
      if (lockedSet.has(t.item.itemInstanceId)) {
        t.item.isLocked = true;
      }
    });

    sfx.playReceive();
    renderScannerModalContent();
    renderInventoryStage();

    if (feedbackEl) {
      const failCount = (data.failed || []).length;
      const skippedDupMsg = summary.outclassedCount > 0
        ? ` (${summary.outclassedCount} weaker duplicate ${summary.outclassedCount === 1 ? 'copy was' : 'copies were'} left unlocked so you can shard ${summary.outclassedCount === 1 ? 'it' : 'them'}!)`
        : '';
      feedbackEl.classList.remove('hidden');
      feedbackEl.classList.toggle('error', data.lockedCount === 0 && failCount > 0);
      feedbackEl.textContent = failCount > 0
        ? `✓ Locked ${data.lockedCount} #1 Best God Rolls! (${failCount} could not be locked: ${data.failed[0].reason})`
        : `✓ Locked all ${data.lockedCount} #1 Best God Rolls across your Inventory & Vault!${skippedDupMsg}`;
    }
  } catch (err) {
    sfx.playAlert();
    if (feedbackEl) {
      feedbackEl.classList.remove('hidden');
      feedbackEl.classList.add('error');
      feedbackEl.textContent = `⚠ ${err.message}`;
    }
    renderScannerModalContent();
  }
}

async function executeDismantlePrep(unlockOnly = false, explicitEntries = null) {
  if (!state.bungieData) return;
  const summary = collectInventoryAndVaultGodRolls();
  const entries = explicitEntries || summary.dismantleCandidates.filter(
    e => state.dismantleSelectedIds.has(String(e.item.itemInstanceId))
  );
  if (entries.length === 0) return;

  const feedbackEl = document.getElementById('scannerLockFeedback');
  const btnUnlock = document.getElementById('btnUnlockSelectedTrash');
  const btnPull = document.getElementById('btnPullSelectedTrash');
  const defaultCharId = state.bungieData.characters?.[0]?.characterId || '';
  const targetCharId = state.dismantleTargetCharId || defaultCharId;
  const targetChar = (state.bungieData.characters || []).find(c => c.characterId === targetCharId);
  const targetClassName = targetChar?.className || 'Character';

  if (btnUnlock) btnUnlock.disabled = true;
  if (btnPull) btnPull.disabled = true;

  if (feedbackEl) {
    feedbackEl.classList.remove('hidden', 'error');
    feedbackEl.textContent = unlockOnly
      ? `F.E.L.I.C.I.A. is unlocking ${entries.length} weaker duplicate / trash ${entries.length === 1 ? 'weapon' : 'weapons'}...`
      : `F.E.L.I.C.I.A. is unlocking & pulling ${entries.length} dismantle ${entries.length === 1 ? 'candidate' : 'candidates'} onto your ${targetClassName}...`;
  }
  sfx.playTransmit();

  try {
    const res = await fetch('/api/bungie/dismantle-prep', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.bungieSession.access_token}`,
        'X-Bungie-Refresh': state.bungieSession.refresh_token || ''
      },
      body: JSON.stringify({
        membershipType: state.bungieData.player.membershipType,
        defaultCharacterId: defaultCharId,
        targetCharacterId: targetCharId,
        unlockOnly: Boolean(unlockOnly),
        items: entries.map(e => ({
          itemInstanceId: e.item.itemInstanceId,
          itemHash: e.item.itemHash,
          sourceLocation: e.item.location,
          sourceCharacterId: e.item.characterId || '',
          slot: e.item.slot || 'Kinetic',
          isLocked: Boolean(e.item.isLocked),
          isEquipped: Boolean(e.item.isEquipped),
          name: e.item.name
        }))
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Dismantle prep failed.');
    if (data.refreshed_session) saveBungieSession(data.refreshed_session);

    // Refresh live inventory silently if items moved across Vault/Character, otherwise update lock flags in memory
    if (!unlockOnly && (data.pulledIds || []).length > 0) {
      const prevSelection = new Set(state.dismantleSelectedIds);
      await loadBungieInventory(true);
      state.dismantleSelectedIds = prevSelection;
      state.dismantleSelectionInitialized = true;
    } else {
      const unlockedSet = new Set(data.unlockedIds || []);
      entries.forEach(e => {
        if (unlockedSet.has(e.item.itemInstanceId)) {
          e.item.isLocked = false;
        }
      });
      renderInventoryStage();
    }

    sfx.playReceive();
    renderScannerModalContent();

    if (feedbackEl) {
      const pulledCnt = (data.pulledIds || []).length;
      const alreadyCnt = (data.alreadyOnCharIds || []).length;
      const fullCnt = (data.skippedFullSlotIds || []).length;
      const failCnt = (data.failed || []).length;

      feedbackEl.classList.remove('hidden');
      feedbackEl.classList.toggle('error', failCnt > 0 && pulledCnt === 0 && (data.unlockedIds || []).length === 0);

      if (unlockOnly) {
        feedbackEl.textContent = `✓ Unlocked ${(data.unlockedIds || []).length} weaker duplicate / trash weapons in Destiny 2 — every #1 Best God Roll stays Locked (🔒)!`;
      } else {
        let msg = `✓ Ready to shard! Pulled ${pulledCnt} unlocked ${pulledCnt === 1 ? 'weapon' : 'weapons'} onto your ${targetClassName}`;
        if (alreadyCnt > 0) msg += ` (${alreadyCnt} already in ${targetClassName}'s bag)`;
        if (fullCnt > 0) msg += ` — ${fullCnt} unlocked in Vault because ${targetClassName}'s weapon slots hit 9/9 (dismantle this wave in-game, then click Pull again!)`;
        else msg += ` — hold Dismantle on the unlocked weapons in-game while your #1 God Rolls stay Locked (🔒)!`;
        if (failCnt > 0) msg += ` (${failCnt} skipped: ${data.failed[0].reason})`;
        feedbackEl.textContent = msg;
      }
    }
  } catch (err) {
    sfx.playAlert();
    if (feedbackEl) {
      feedbackEl.classList.remove('hidden');
      feedbackEl.classList.add('error');
      feedbackEl.textContent = `⚠ ${err.message}`;
    }
    renderScannerModalContent();
  }
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
        'Only authorized clan members may contribute verified weapon rolls. Enter the Clan Authorization Code to proceed.'
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

  // Roll Template Switcher Buttons
  const btnTemplateLeg = document.getElementById('btnTemplateLegendary');
  const btnTemplateExo = document.getElementById('btnTemplateExotic');
  if (btnTemplateLeg) {
    btnTemplateLeg.addEventListener('click', () => setGodRollTemplate('legendary'));
  }
  if (btnTemplateExo) {
    btnTemplateExo.addEventListener('click', () => setGodRollTemplate('exotic'));
  }

  // Smart template detector when typing weapon name
  const rollWeaponNameInput = document.getElementById('rollWeaponName');
  if (rollWeaponNameInput) {
    rollWeaponNameInput.addEventListener('input', (e) => {
      const val = (e.target.value || '').toLowerCase().trim();
      const knownExotics = [
        'outbreak perfected', 'dead man\'s tale', 'hawkmoon', 'revision zero', 
        'wish-keeper', 'vexcalibur', 'ergo sum', 'osteo striga', 'quicksilver storm',
        'conditional finality', 'witherhoard', 'gjallarhorn', 'izanagi', 'anarchy', 'divinity'
      ];
      const isKnown = knownExotics.some(ex => val.includes(ex)) || val.includes('exotic');
      const curTmpl = document.getElementById('rollTemplate')?.value;
      if (isKnown && curTmpl !== 'exotic') {
        const p1 = document.getElementById('pvePerk1')?.value.trim();
        if (!p1) {
          setGodRollTemplate('exotic', true);
        }
      }
    });
  }

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
      const activeTemplate = document.getElementById('rollTemplate')?.value || 'legendary';

      let pve, pvp;
      if (activeTemplate === 'exotic') {
        pve = {
          barrel: document.getElementById('pveBarrelExotic').value.trim(),
          mag: document.getElementById('pveMagExotic').value.trim(),
          stock: document.getElementById('pveStockExotic').value.trim(),
          catalyst: document.getElementById('pveCatalystExotic').value.trim(),
          perk1: document.getElementById('pvePerk1Exotic').value.trim(),
          perk2: document.getElementById('pvePerk2Exotic').value.trim(),
          originTrait: document.getElementById('pveOriginTraitExotic').value.trim(),
          notes: document.getElementById('pveNotesExotic').value.trim()
        };
        pvp = {
          barrel: document.getElementById('pvpBarrelExotic').value.trim(),
          mag: document.getElementById('pvpMagExotic').value.trim(),
          stock: document.getElementById('pvpStockExotic').value.trim(),
          catalyst: document.getElementById('pvpCatalystExotic').value.trim(),
          perk1: document.getElementById('pvpPerk1Exotic').value.trim(),
          perk2: document.getElementById('pvpPerk2Exotic').value.trim(),
          originTrait: document.getElementById('pvpOriginTraitExotic').value.trim(),
          notes: document.getElementById('pvpNotesExotic').value.trim()
        };
      } else {
        pve = {
          barrel: document.getElementById('pveBarrel').value.trim(),
          mag: document.getElementById('pveMag').value.trim(),
          perk1: document.getElementById('pvePerk1').value.trim(),
          perk2: document.getElementById('pvePerk2').value.trim(),
          originTrait: document.getElementById('pveOriginTrait').value.trim(),
          masterwork: document.getElementById('pveMasterwork').value.trim() || 'Reload Speed',
          notes: document.getElementById('pveNotes').value.trim()
        };
        pvp = {
          barrel: document.getElementById('pvpBarrel').value.trim(),
          mag: document.getElementById('pvpMag').value.trim(),
          perk1: document.getElementById('pvpPerk1').value.trim(),
          perk2: document.getElementById('pvpPerk2').value.trim(),
          originTrait: document.getElementById('pvpOriginTrait').value.trim(),
          masterwork: document.getElementById('pvpMasterwork').value.trim() || 'Range',
          notes: document.getElementById('pvpNotes').value.trim()
        };
      }

      const payload = {
        id: rollId || undefined,
        name,
        source,
        slot,
        type,
        element,
        frame,
        tier: activeTemplate === 'exotic' ? 'Exotic' : 'Legendary',
        template: activeTemplate,
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
          if (state.bungieSession && state.bungieSession.access_token) {
            loadBungieInventory(true);
          }
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
      switchTabDirect('tab-inventory');
      alert('Clan Administrator Mode locked. Security passcode required to re-enter Admin Settings.');
    });
  }

  // =========================================================================
  // BUNGIE INVENTORY, VAULT & ITEM INSPECTION WIRING
  // =========================================================================
  const btnBungieLoginHero = document.getElementById('btnBungieLoginHero');
  const bungieHeaderBadge = document.getElementById('bungieHeaderBadge');
  const btnRefreshInventory = document.getElementById('btnRefreshInventory');
  const btnDisconnectBungie = document.getElementById('btnDisconnectBungie');
  const invSearchInput = document.getElementById('invSearchInput');
  const btnClearInvSearch = document.getElementById('btnClearInvSearch');
  const modalInspectItem = document.getElementById('modalInspectItem');
  const btnCloseInspectItem = document.getElementById('btnCloseInspectItem');
  const btnSpeakAppraisal = document.getElementById('btnSpeakAppraisal');
  const btnOpenInComms = document.getElementById('btnOpenInComms');
  const btnSaveBungieConfig = document.getElementById('btnSaveBungieConfig');

  if (btnBungieLoginHero) {
    btnBungieLoginHero.addEventListener('click', startBungieLogin);
  }

  if (bungieHeaderBadge) {
    bungieHeaderBadge.addEventListener('click', () => {
      if (state.bungieSession && state.bungieSession.access_token) {
        switchTabDirect('tab-inventory');
      } else {
        startBungieLogin();
      }
    });
  }

  if (btnRefreshInventory) {
    btnRefreshInventory.addEventListener('click', () => {
      sfx.playChirp();
      loadBungieInventory(false);
    });
  }

  if (btnDisconnectBungie) {
    btnDisconnectBungie.addEventListener('click', () => {
      if (confirm('Disconnect your Bungie.net account from this browser?')) {
        disconnectBungieAccount();
      }
    });
  }

  if (invSearchInput) {
    invSearchInput.addEventListener('input', (e) => {
      state.invFilter.search = e.target.value;
      if (btnClearInvSearch) {
        btnClearInvSearch.classList.toggle('hidden', !e.target.value);
      }
      renderInventoryStage();
    });
  }

  if (btnClearInvSearch && invSearchInput) {
    btnClearInvSearch.addEventListener('click', () => {
      invSearchInput.value = '';
      state.invFilter.search = '';
      btnClearInvSearch.classList.add('hidden');
      invSearchInput.focus();
      renderInventoryStage();
    });
  }

  document.querySelectorAll('#invFilterPills .inv-pill[data-invfilter]').forEach(pill => {
    pill.addEventListener('click', () => {
      sfx.playChirp();
      document.querySelectorAll('#invFilterPills .inv-pill[data-invfilter]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.invFilter.slot = pill.dataset.invfilter || 'all';
      renderInventoryStage();
    });
  });

  const btnScanGodRolls = document.getElementById('btnScanGodRolls');
  const modalGodRollScanner = document.getElementById('modalGodRollScanner');
  const btnLockAllGodRolls = document.getElementById('btnLockAllGodRolls');
  const btnResyncScanner = document.getElementById('btnResyncScanner');
  const modalSavedLoadout = document.getElementById('modalSavedLoadout');
  const btnEquipSavedLoadout = document.getElementById('btnEquipSavedLoadout');
  const btnAskFeliciaLoadout = document.getElementById('btnAskFeliciaLoadout');

  if (btnScanGodRolls) {
    btnScanGodRolls.addEventListener('click', () => openGodRollScannerModal());
  }

  document.querySelectorAll('#scannerFilterPills .inv-pill[data-scanfilter]').forEach(pill => {
    pill.addEventListener('click', () => {
      sfx.playChirp();
      document.querySelectorAll('#scannerFilterPills .inv-pill[data-scanfilter]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.scannerFilter = pill.dataset.scanfilter || 'all';
      renderScannerModalContent();
    });
  });

  if (btnLockAllGodRolls) {
    btnLockAllGodRolls.addEventListener('click', () => lockAllScannedGodRolls());
  }

  const chkSelectAllDismantle = document.getElementById('chkSelectAllDismantle');
  const btnPresetDuplicatesOnly = document.getElementById('btnPresetDuplicatesOnly');
  const btnPresetAllTrash = document.getElementById('btnPresetAllTrash');
  const btnPresetClearTrash = document.getElementById('btnPresetClearTrash');
  const selectDismantleChar = document.getElementById('selectDismantleChar');
  const btnUnlockSelectedTrash = document.getElementById('btnUnlockSelectedTrash');
  const btnPullSelectedTrash = document.getElementById('btnPullSelectedTrash');

  if (chkSelectAllDismantle) {
    chkSelectAllDismantle.addEventListener('change', () => {
      sfx.playChirp();
      const summary = collectInventoryAndVaultGodRolls();
      if (chkSelectAllDismantle.checked) {
        summary.dismantleCandidates.forEach(e => {
          if (e.item.itemInstanceId) state.dismantleSelectedIds.add(String(e.item.itemInstanceId));
        });
      } else {
        state.dismantleSelectedIds.clear();
      }
      renderScannerModalContent();
    });
  }

  if (btnPresetDuplicatesOnly) {
    btnPresetDuplicatesOnly.addEventListener('click', () => {
      sfx.playChirp();
      const summary = collectInventoryAndVaultGodRolls();
      state.dismantleSelectedIds.clear();
      summary.dismantleCandidates.forEach(e => {
        if (
          e.item.itemInstanceId &&
          (e.grc.dismantleTier === 'OUTCLASSED_GOD_ROLL' || e.grc.dismantleTier === 'EXTRA_COPY_OWNED_GOD_ROLL')
        ) {
          state.dismantleSelectedIds.add(String(e.item.itemInstanceId));
        }
      });
      renderScannerModalContent();
    });
  }

  if (btnPresetAllTrash) {
    btnPresetAllTrash.addEventListener('click', () => {
      sfx.playChirp();
      const summary = collectInventoryAndVaultGodRolls();
      summary.dismantleCandidates.forEach(e => {
        if (e.item.itemInstanceId) state.dismantleSelectedIds.add(String(e.item.itemInstanceId));
      });
      renderScannerModalContent();
    });
  }

  if (btnPresetClearTrash) {
    btnPresetClearTrash.addEventListener('click', () => {
      sfx.playChirp();
      state.dismantleSelectedIds.clear();
      renderScannerModalContent();
    });
  }

  if (selectDismantleChar) {
    selectDismantleChar.addEventListener('change', () => {
      state.dismantleTargetCharId = selectDismantleChar.value;
      syncDismantleToolbarState(collectInventoryAndVaultGodRolls());
    });
  }

  if (btnUnlockSelectedTrash) {
    btnUnlockSelectedTrash.addEventListener('click', () => executeDismantlePrep(true));
  }

  if (btnPullSelectedTrash) {
    btnPullSelectedTrash.addEventListener('click', () => executeDismantlePrep(false));
  }

  if (btnResyncScanner) {
    btnResyncScanner.addEventListener('click', async () => {
      btnResyncScanner.disabled = true;
      btnResyncScanner.textContent = '🔄 Syncing...';
      await loadBungieInventory(true);
      renderScannerModalContent();
      btnResyncScanner.disabled = false;
      btnResyncScanner.textContent = '🔄 Re-Scan';
    });
  }

  if (btnEquipSavedLoadout) {
    btnEquipSavedLoadout.addEventListener('click', () => executeEquipSavedLoadout());
  }

  if (btnAskFeliciaLoadout) {
    btnAskFeliciaLoadout.addEventListener('click', () => {
      if (!state.inspectedLoadout) return;
      const { character, loadout } = state.inspectedLoadout;
      const wSummary = (loadout.weapons || []).map(w => `${w.slot}: ${w.name}`).join(', ');
      const exName = loadout.exoticItem ? loadout.exoticItem.name : 'Legendary Setup';
      const subName = loadout.subclass?.name || character.subclass?.name || 'Active Subclass';
      const statsTxt = Object.entries(character.stats || {}).map(([k, v]) => `${k} ${v}`).join(', ');
      const prompt = `Review my saved ${character.className} loadout '${loadout.name}' (Subclass: ${subName}, Exotic: ${exName}, Weapons: ${wSummary || 'Standard'}, Current Character Stats: ${statsTxt}). How strong is this setup for PVE or PVP, and what tweaks would make it hit even harder?`;
      modalSavedLoadout?.close();
      switchTabDirect('tab-comms');
      const input = document.getElementById('chatInput');
      if (input) input.value = prompt;
      sendChatMessage(prompt);
    });
  }

  if (modalInspectItem) {
    if (btnCloseInspectItem) {
      btnCloseInspectItem.addEventListener('click', () => modalInspectItem.close());
    }
    attachLightDismissFallback(modalInspectItem);
  }
  attachLightDismissFallback(modalGodRollScanner);
  attachLightDismissFallback(modalSavedLoadout);

  if (btnSpeakAppraisal) {
    btnSpeakAppraisal.addEventListener('click', () => {
      sfx.playChirp();
      if (state.lastAppraisalReply) voice.speak(state.lastAppraisalReply);
    });
  }

  if (btnOpenInComms) {
    btnOpenInComms.addEventListener('click', () => {
      if (!state.inspectedItem) return;
      const it = state.inspectedItem;
      const perksSummary = (it.perkColumns || [])
        .map(col => col.filter(o => o.selected).map(o => o.name).join('/'))
        .filter(Boolean)
        .join(', ');
      modalInspectItem?.close();
      switchTabDirect('tab-comms');
      if (state.lastAppraisalReply) {
        appendMessage('user', 'GUARDIAN', `Evaluate my ${it.name} (${perksSummary || it.typeName})`);
        appendMessage('felicia', 'F.E.L.I.C.I.A.', state.lastAppraisalReply);
        state.chatHistory.push({ role: 'user', content: `Evaluate my ${it.name} (${perksSummary || it.typeName})` });
        state.chatHistory.push({ role: 'model', content: state.lastAppraisalReply });
      }
    });
  }

  if (btnSaveBungieConfig) {
    btnSaveBungieConfig.addEventListener('click', async () => {
      const apiKey = document.getElementById('inputBungieApiKey')?.value.trim() || '';
      const clientId = document.getElementById('inputBungieClientId')?.value.trim() || '56157';
      const clientSecret = document.getElementById('inputBungieClientSecret')?.value.trim() || '';

      btnSaveBungieConfig.disabled = true;
      btnSaveBungieConfig.textContent = 'Saving...';
      try {
        const res = await fetch('/api/auth/bungie/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bungie_api_key: apiKey,
            bungie_client_id: clientId,
            bungie_client_secret: clientSecret
          })
        });
        if (!res.ok) throw new Error('Failed to save Bungie credentials.');
        sfx.playReceive();
        if (document.getElementById('inputBungieApiKey')) document.getElementById('inputBungieApiKey').value = '';
        if (document.getElementById('inputBungieClientSecret')) document.getElementById('inputBungieClientSecret').value = '';
        await fetchBungieServerConfigStatus();
        alert('Bungie.net API & OAuth credentials saved to server!');
      } catch (err) {
        alert('Error saving Bungie config: ' + err.message);
      } finally {
        btnSaveBungieConfig.disabled = false;
        btnSaveBungieConfig.textContent = 'Save Bungie Credentials';
      }
    });
  }

  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'BUNGIE_AUTH_SUCCESS' && ev.data.session) {
      saveBungieSession(ev.data.session);
      sfx.playReceive();
      switchTabDirect('tab-inventory');
      loadBungieInventory(false);
    }
  });

  state.bungieSession = loadSavedBungieSession();
  updateBungieAuthUI();
  if (state.bungieSession) {
    loadBungieInventory(false);
  }
  fetchBungieServerConfigStatus();

  initSpeechRecognition();
  loadWikiData();
  loadGodRolls();
  loadBuilds();
  loadMobileConnectInfo();
});
