import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Trophy, Play, Volume2, VolumeX, Home, Settings, X, Music, Zap, Target, Eye, Shuffle, Lock, Shield, Trash2, RotateCcw, Maximize, Minimize } from 'lucide-react';
import SpaceBackground from './components/background/SpaceBackground';
import RoundCompleteScreen from './components/LevelCompleteScreen';
import { ALL_ICONS, SAMSUNG_PRODUCTS, DECOY_ICONS, ROUND_CONFIG, PRIZE_TIERS, addGrandPrizeWinner, resetGrandPrizeToday, isGrandPrizeDisabled, setGrandPrizeDisabled, getGrandPrizeWinnersToday, GRAND_PRIZE_DAILY_MAX, getSwapCount } from './constants/config';
import GrandPrizeScreen from './components/GrandPrizeScreen';
import { playSound, initAudio, startMusic, stopMusic, setMusicVolume, setSfxVolume, speakGo, distortAndStopMusic, startDrone, stopDrone, playGameOverJingle } from './utils/audio';
import { shuffleArray } from './utils/helpers';
import { fetchLeaderboard, addLeaderboardEntry, clearLeaderboard, fetchGrandPrizeToday, addGrandPrizeWinnerRemote, resetGrandPrizeTodayRemote, startPeriodicSync, stopPeriodicSync, getPendingSyncCount } from './utils/api';
import samsungLogo from './assets/logo/Samsung_Orig_Wordmark_WHITE_RGB.png';
import memoryFlipLogo from './assets/logo/memory-flip-logo.png';
import memoryFlipIntro from './assets/logo/memory-flip-intro.webm';
import memoryFlipLoop from './assets/logo/memory-flip-loop.webm';

// Safari plays VP9 WebM but drops the alpha channel (renders black background),
// so play() succeeds and the onError fallback never fires — route it to the PNG.
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
import cardMetallicBase from './assets/cards/card-metallic-base.svg';
import cardMetallicSheen from './assets/cards/card-metallic-sheen.webm';
import cardSemiconductorGold from './assets/cards/card-semiconductor-gold.svg';

// ─── Shuffle Sequence Generator ───
// Generates pairwise swap sequence, ensuring every Samsung card is swapped at least once
function generateShuffleSequence(totalCards, swapCount, samsungGridIndices) {
  const swaps = [];

  // First, ensure each Samsung card gets swapped at least once
  const shuffledSamsung = shuffleArray([...samsungGridIndices]);
  for (const idx of shuffledSamsung) {
    let partner;
    do {
      partner = Math.floor(Math.random() * totalCards);
    } while (partner === idx);
    swaps.push([idx, partner]);
  }

  // Fill remaining swaps randomly
  while (swaps.length < swapCount) {
    const a = Math.floor(Math.random() * totalCards);
    let b;
    do {
      b = Math.floor(Math.random() * totalCards);
    } while (b === a);
    swaps.push([a, b]);
  }

  return shuffleArray(swaps);
}

export default function App() {
  // ─── Core Game State ───
  const [gameState, setGameState] = useState('SPLASH');
  const [round, setRound] = useState(1);
  const [deck, setDeck] = useState([]);
  const [score, setScore] = useState(0);
  const [roundScore, setRoundScore] = useState(0);
  const [tapsRemaining, setTapsRemaining] = useState(0);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [wrongTaps, setWrongTaps] = useState(0);
  const [selectionTimer, setSelectionTimer] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [isEntering, setIsEntering] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isCelebrating, setIsCelebrating] = useState(false);

  // ─── Shuffle State ───
  const [shuffleSwaps, setShuffleSwaps] = useState([]);
  const [shuffleStep, setShuffleStep] = useState(-1);

  // ─── Reveal State ───
  const [revealCountdown, setRevealCountdown] = useState(null);

  // ─── UI State ───
  const [leaderboard, setLeaderboard] = useState(() => {
    try {
      const saved = localStorage.getItem('galaxy-sync-leaderboard');
      return saved ? JSON.parse(saved).sort((a, b) => b.score - a.score) : [];
    } catch { return []; }
  });
  const [isMuted, setIsMuted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [musicVol, setMusicVol] = useState(0.5);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sfxVol, setSfxVol] = useState(0.7);
  const [audioReady, setAudioReady] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [rankRevealData, setRankRevealData] = useState(null);
  const [displayRank, setDisplayRank] = useState(0);
  const [scoreAtRoundStart, setScoreAtRoundStart] = useState(0);
  const [gpDisabled, setGpDisabled] = useState(() => isGrandPrizeDisabled());
  const [gpWinnersToday, setGpWinnersToday] = useState(() => getGrandPrizeWinnersToday().length);
  const [showMissedReveal, setShowMissedReveal] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const [showcasePhase, setShowcasePhase] = useState('enter'); // 'enter' | 'display' | 'disperse'

  // ─── Admin State ───
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [adminPinError, setAdminPinError] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMsg, setAdminMsg] = useState('');

  // ─── Refs ───
  const timerRef = useRef(null);
  const rankAnimRef = useRef(null);
  const enterKeyRef = useRef(0);
  const bgRef = useRef(null);
  const pendingScoreRef = useRef(null);
  const playerRowRef = useRef(null);
  const scoreRef = useRef(score);
  const roundRef = useRef(round);
  const gridMeasureRef = useRef(null);
  const shuffleTimeoutRef = useRef(null);
  const roundEndHandledRef = useRef(false);
  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const supportsWebM = useRef((() => {
    if (typeof document === 'undefined') return false;
    const v = document.createElement('video');
    return v.canPlayType && v.canPlayType('video/webm; codecs="vp8, vorbis"') !== '';
  })());

  useEffect(() => { scoreRef.current = score; }, [score]);
  useEffect(() => { roundRef.current = round; }, [round]);

  // ─── Fullscreen sync ───
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const el = document.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
  }, []);

  // ─── Asset Preloader ───
  useEffect(() => {
    let cancelled = false;
    const assets = [];

    // All icon images
    ALL_ICONS.forEach(({ icon }) => assets.push({ type: 'image', src: icon }));
    // Logo / UI images
    assets.push({ type: 'image', src: samsungLogo });
    assets.push({ type: 'image', src: memoryFlipLogo });
    assets.push({ type: 'image', src: cardMetallicBase });
    assets.push({ type: 'image', src: cardSemiconductorGold });
    // Logo videos (desktop only — mobile and Safari use static PNG already preloaded above)
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
    if (!isMobile && !isSafari) {
      assets.push({ type: 'video', src: memoryFlipIntro });
      assets.push({ type: 'video', src: memoryFlipLoop });
    }
    // Videos
    assets.push({ type: 'video', src: cardMetallicSheen });

    let loaded = 0;
    const total = assets.length;

    const tick = () => {
      loaded++;
      if (!cancelled) setLoadProgress(Math.round((loaded / total) * 100));
    };

    const promises = assets.map(({ type, src }) => {
      if (type === 'image') {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = img.onerror = () => { tick(); resolve(); };
          img.src = src;
        });
      }
      // video — fetch the whole blob so it's in browser cache
      return fetch(src)
        .then(r => r.blob())
        .catch(() => {})
        .finally(() => tick());
    });

    Promise.all(promises).then(() => {
      if (!cancelled) {
        setLoadProgress(100);
        setAssetsReady(true);
      }
    });

    return () => { cancelled = true; };
  }, []);

  const MAX_LEADERBOARD_ENTRIES = 500;

  // ─── Sync: fetch leaderboard, flush offline queue, periodic retry ───
  useEffect(() => {
    let cancelled = false;
    // Start periodic sync (flushes offline queue every 30s)
    startPeriodicSync();
    (async () => {
      try {
        const merged = await fetchLeaderboard();
        if (!cancelled && merged.length > 0) setLeaderboard(merged);
      } catch { /* fallback is already in localStorage init */ }
      try {
        const gp = await fetchGrandPrizeToday();
        if (!cancelled) setGpWinnersToday(gp.length);
      } catch { /* keep localStorage count */ }
    })();
    return () => { cancelled = true; stopPeriodicSync(); };
  }, []);

  // ─── Current round config ───
  const roundConfig = useMemo(() => ROUND_CONFIG[round - 1] || ROUND_CONFIG[0], [round]);

  // ─── Save Score ───
  const saveScore = useCallback((finalScore, rnd, name) => {
    const safeName = name || 'Anonymous';
    setLeaderboard(prev => {
      const entry = {
        name: safeName,
        score: finalScore,
        date: new Date().toLocaleDateString(),
        round: rnd || 1,
      };
      return [...prev, entry].sort((a, b) => b.score - a.score).slice(0, MAX_LEADERBOARD_ENTRIES);
    });
    // Also persist to cloud (fire-and-forget)
    addLeaderboardEntry(safeName, finalScore, rnd || 1).catch(() => {});
  }, []);

  // ─── Transition Helper ───
  const triggerTransition = useCallback((actionFn, warpType) => {
    setIsTransitioning(true);
    if (warpType === 'start') bgRef.current?.startGame();
    else if (warpType === 'next') bgRef.current?.nextRound();
    else if (warpType === 'menu') bgRef.current?.returnToMenu();
    if (warpType === 'start') stopMusic();
    if (warpType === 'start' || warpType === 'next') {
      playSound('warpWoosh', isMuted);
    }
    setTimeout(() => { actionFn(); }, 650);
    setTimeout(() => { setIsTransitioning(false); }, 1300);
  }, [isMuted]);

  // ─── Setup Round ───
  const setupRound = useCallback((targetRound) => {
    initAudio();
    setAudioReady(true);
    const config = ROUND_CONFIG[targetRound - 1];
    if (!config) return;

    const totalCards = config.rows * config.cols;
    const samsungCards = shuffleArray([...SAMSUNG_PRODUCTS]).slice(0, config.samsungCount);
    const decoysNeeded = totalCards - config.samsungCount;
    const shuffledDecoys = shuffleArray([...DECOY_ICONS]);
    const decoyCards = [];
    for (let i = 0; i < decoysNeeded; i++) {
      decoyCards.push(shuffledDecoys[i % shuffledDecoys.length]);
    }

    const newDeck = shuffleArray([
      ...samsungCards.map(icon => ({ ...icon, isSamsung: true })),
      ...decoyCards.map(icon => ({ ...icon, isSamsung: false })),
    ]).map((card, i) => ({
      ...card,
      id: Math.random(),
      isFlipped: false,
      isFound: false,
      isWrong: false,
      isMissed: false,
      gridIndex: i,
    }));

    setRound(targetRound);
    setDeck(newDeck);
    setRoundScore(0);
    setCorrectTaps(0);
    setWrongTaps(0);
    setTapsRemaining(config.taps);
    setSelectionTimer(config.selectionTime);
    setIsLocked(true);
    setIsEntering(true);
    setShuffleSwaps([]);
    setShuffleStep(-1);
    setRevealCountdown(null);
    setShowMissedReveal(false);
    setIsCelebrating(false);
    roundEndHandledRef.current = false;
    enterKeyRef.current += 1;
    setGameState('DEAL');
  }, []);

  // ─── DEAL → REVEAL: After cards enter, reveal Samsung products ───
  useEffect(() => {
    if (gameState !== 'DEAL' || !isEntering) return;
    const config = ROUND_CONFIG[round - 1];
    const cardCount = config.rows * config.cols;
    const enterDuration = (cardCount * 60) + 500 + 100;
    const timer = setTimeout(() => {
      setIsEntering(false);
      setDeck(prev => prev.map(card => ({
        ...card,
        isFlipped: card.isSamsung,
      })));
      playSound('reveal', isMuted);
      setGameState('REVEAL');
      const revealSeconds = Math.round(config.revealTime / 1000);
      setRevealCountdown(revealSeconds);
    }, enterDuration);
    return () => clearTimeout(timer);
  }, [gameState, isEntering, round, isMuted]);

  // ─── REVEAL countdown ───
  const shuffleStartRef = useRef(null);

  useEffect(() => {
    if (gameState !== 'REVEAL' || revealCountdown === null) return;
    if (revealCountdown <= 0) {
      // Flip all cards face-down and transition to SHUFFLING
      setDeck(prev => prev.map(card => ({ ...card, isFlipped: false })));
      playSound('go', isMuted);
      setRevealCountdown(null);
      // Use a ref-based timeout so cleanup from revealCountdown change won't cancel it
      if (shuffleStartRef.current) clearTimeout(shuffleStartRef.current);
      shuffleStartRef.current = setTimeout(() => {
        shuffleStartRef.current = null;
        setDeck(prevDeck => {
          const config = ROUND_CONFIG[round - 1];
          const totalCards = config.rows * config.cols;
          const samIndices = prevDeck.filter(c => c.isSamsung).map(c => c.gridIndex);
          const swapCount = getSwapCount(round);
          const swaps = generateShuffleSequence(totalCards, swapCount, samIndices);
          setShuffleSwaps(swaps);
          setShuffleStep(0);
          setGameState('SHUFFLING');
          playSound('roundStart', isMuted);
          return prevDeck;
        });
      }, 500);
      return;
    }
    const interval = setInterval(() => {
      setRevealCountdown(prev => {
        if (prev === null || prev <= 0) return prev;
        const next = prev - 1;
        if (next > 0) playSound('countdown', isMuted);
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState, revealCountdown, round, isMuted]);

  // Clean up shuffle start timer on unmount or game state change away from REVEAL
  useEffect(() => {
    return () => {
      if (shuffleStartRef.current) {
        clearTimeout(shuffleStartRef.current);
        shuffleStartRef.current = null;
      }
    };
  }, [gameState]);

  // ─── SHUFFLING: Execute swaps sequentially with visual animation ───
  useEffect(() => {
    if (gameState !== 'SHUFFLING' || shuffleStep < 0) return;
    if (shuffleStep >= shuffleSwaps.length) {
      // All swaps done, move to selection
      setIsLocked(false);
      setGameState('SELECTION');
      speakGo(isMuted);
      return;
    }

    const config = ROUND_CONFIG[round - 1];
    const [posA, posB] = shuffleSwaps[shuffleStep];

    playSound('shuffle', isMuted);

    // Reduced motion: instant swap, no animation
    if (prefersReducedMotion.current) {
      setDeck(prev => {
        const newDeck = prev.map(c => ({ ...c }));
        const cardAtA = newDeck.find(c => c.gridIndex === posA);
        const cardAtB = newDeck.find(c => c.gridIndex === posB);
        if (cardAtA && cardAtB) {
          cardAtA.gridIndex = posB;
          cardAtB.gridIndex = posA;
        }
        return newDeck;
      });
      shuffleTimeoutRef.current = setTimeout(() => {
        setShuffleStep(prev => prev + 1);
      }, config.swapPause);
      return () => { if (shuffleTimeoutRef.current) clearTimeout(shuffleTimeoutRef.current); };
    }

    // Find the two card DOM elements by gridIndex
    const gridEl = gridMeasureRef.current;
    const elA = gridEl?.querySelector(`[data-grid-index="${posA}"]`);
    const elB = gridEl?.querySelector(`[data-grid-index="${posB}"]`);

    if (!elA || !elB) {
      // Fallback: instant swap
      setDeck(prev => {
        const newDeck = prev.map(c => ({ ...c }));
        const cardAtA = newDeck.find(c => c.gridIndex === posA);
        const cardAtB = newDeck.find(c => c.gridIndex === posB);
        if (cardAtA && cardAtB) { cardAtA.gridIndex = posB; cardAtB.gridIndex = posA; }
        return newDeck;
      });
      shuffleTimeoutRef.current = setTimeout(() => {
        setShuffleStep(prev => prev + 1);
      }, config.swapPause);
      return () => { if (shuffleTimeoutRef.current) clearTimeout(shuffleTimeoutRef.current); };
    }

    // 1. Measure current positions
    const rectA = elA.getBoundingClientRect();
    const rectB = elB.getBoundingClientRect();
    const dx = rectB.left - rectA.left;
    const dy = rectB.top - rectA.top;

    // 2. Apply transition + transform to slide cards
    const duration = config.swapDuration;
    const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';

    elA.style.transition = `transform ${duration}ms ${easing}`;
    elB.style.transition = `transform ${duration}ms ${easing}`;
    elA.style.zIndex = '11';
    elB.style.zIndex = '10';

    // Force reflow so transition property is registered
    void elA.offsetWidth;

    elA.style.transform = `translate(${dx}px, ${dy}px)`;
    elB.style.transform = `translate(${-dx}px, ${-dy}px)`;

    // 3. After animation completes, clean up and swap gridIndex
    shuffleTimeoutRef.current = setTimeout(() => {
      requestAnimationFrame(() => {
        // Remove inline styles
        elA.style.transition = '';
        elA.style.transform = '';
        elA.style.zIndex = '';
        elB.style.transition = '';
        elB.style.transform = '';
        elB.style.zIndex = '';

        // Update gridIndex so React re-renders cards in swapped positions
        setDeck(prev => {
          const newDeck = prev.map(c => ({ ...c }));
          const cardAtA = newDeck.find(c => c.gridIndex === posA);
          const cardAtB = newDeck.find(c => c.gridIndex === posB);
          if (cardAtA && cardAtB) {
            cardAtA.gridIndex = posB;
            cardAtB.gridIndex = posA;
          }
          return newDeck;
        });

        // Pause, then next step
        shuffleTimeoutRef.current = setTimeout(() => {
          setShuffleStep(prev => prev + 1);
        }, config.swapPause);
      });
    }, duration);

    return () => {
      if (shuffleTimeoutRef.current) clearTimeout(shuffleTimeoutRef.current);
      // Clean up inline styles if interrupted mid-animation
      if (elA) { elA.style.transition = ''; elA.style.transform = ''; elA.style.zIndex = ''; }
      if (elB) { elB.style.transition = ''; elB.style.transform = ''; elB.style.zIndex = ''; }
    };
  }, [gameState, shuffleStep, shuffleSwaps, round, isMuted]);

  // ─── SELECTION timer countdown ───
  useEffect(() => {
    if (gameState !== 'SELECTION') return;
    timerRef.current = setInterval(() => {
      setSelectionTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [gameState]);

  // ─── SELECTION end conditions ───
  useEffect(() => {
    if (gameState !== 'SELECTION') return;
    if (roundEndHandledRef.current) return;
    const config = ROUND_CONFIG[round - 1];

    // All Samsung products found
    if (correctTaps >= config.samsungCount) {
      roundEndHandledRef.current = true;
      clearInterval(timerRef.current);
      setIsLocked(true);
      const isPerfect = wrongTaps === 0;
      if (isPerfect) {
        const bonus = Math.round(roundScore * 0.5);
        setRoundScore(prev => prev + bonus);
        setScore(prev => prev + bonus);
        playSound('perfectRound', isMuted);
      }
      bgRef.current?.celebrate();
      setIsCelebrating(true);
      setTimeout(() => {
        setIsCelebrating(false);
        setGameState('ROUND_COMPLETE');
      }, 2000);
      return;
    }

    // Out of taps or time
    if (tapsRemaining <= 0 || selectionTimer <= 0) {
      roundEndHandledRef.current = true;
      clearInterval(timerRef.current);
      setIsLocked(true);
      setShowMissedReveal(true);
      playSound('missReveal', isMuted);
      setDeck(prev => prev.map(card => ({
        ...card,
        isFlipped: card.isSamsung ? true : card.isFlipped,
        isMissed: card.isSamsung && !card.isFound,
      })));

      setTimeout(() => {
        setShowMissedReveal(false);
        playSound('elimination', isMuted);
        bgRef.current?.gameOver();
        pendingScoreRef.current = { score: scoreRef.current, round: roundRef.current };
        // Distort & slow the music, then start ominous drone
        if (!isMuted) {
          distortAndStopMusic(() => {
            startDrone();
            playGameOverJingle(isMuted);
          });
        }
        setGameState('GAME_OVER');
      }, 2000);
    }
  }, [gameState, correctTaps, wrongTaps, tapsRemaining, selectionTimer, round, roundScore, isMuted]);

  // ─── Card Tap Handler ───
  const handleCardTap = useCallback((deckIndex) => {
    if (isLocked || gameState !== 'SELECTION') return;
    const card = deck[deckIndex];
    if (!card || card.isFound || card.isFlipped || tapsRemaining <= 0) return;

    setTapsRemaining(prev => prev - 1);

    if (card.isSamsung) {
      playSound('correctTap', isMuted);
      bgRef.current?.correct();
      const config = ROUND_CONFIG[round - 1];
      const points = config.pointsPerProduct;
      setCorrectTaps(prev => prev + 1);
      setRoundScore(prev => prev + points);
      setScore(prev => prev + points);
      setDeck(prev => prev.map((c, i) =>
        i === deckIndex ? { ...c, isFlipped: true, isFound: true } : c
      ));
    } else {
      playSound('wrongTap', isMuted);
      bgRef.current?.wrong();
      setWrongTaps(prev => prev + 1);
      setDeck(prev => prev.map((c, i) =>
        i === deckIndex ? { ...c, isFlipped: true, isWrong: true } : c
      ));
      setTimeout(() => {
        setDeck(prev => prev.map((c, i) =>
          i === deckIndex ? { ...c, isFlipped: false, isWrong: false } : c
        ));
      }, 800);
    }
  }, [isLocked, gameState, deck, tapsRemaining, isMuted, round]);

  // ─── Persist leaderboard ───
  useEffect(() => {
    try {
      localStorage.setItem('galaxy-sync-leaderboard', JSON.stringify(leaderboard));
    } catch (e) {
      console.warn('Failed to save leaderboard:', e.message);
    }
  }, [leaderboard]);

  // ─── Rank reveal animation ───
  useEffect(() => {
    if (gameState !== 'RANK_REVEAL' || !rankRevealData) return;
    const targetRank = rankRevealData.rank;
    if (targetRank <= 1) { setDisplayRank(targetRank); return; }
    const duration = Math.min(600 + targetRank * 4, 1500);
    const start = performance.now();
    const animate = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.max(1, Math.round(eased * targetRank));
      setDisplayRank(current);
      if (progress < 1) {
        rankAnimRef.current = requestAnimationFrame(animate);
      } else {
        rankAnimRef.current = null;
        playSound('correctTap', isMuted);
      }
    };
    rankAnimRef.current = requestAnimationFrame(animate);
    return () => { if (rankAnimRef.current) cancelAnimationFrame(rankAnimRef.current); };
  }, [gameState, rankRevealData, isMuted]);

  // ─── Auto-scroll to player row ───
  useEffect(() => {
    if (gameState !== 'RANK_REVEAL' || !rankRevealData || rankRevealData.rank > 50) return;
    const timer = setTimeout(() => {
      playerRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 1200);
    return () => clearTimeout(timer);
  }, [gameState, rankRevealData]);

  // ─── Splash dismiss ───
  const handleSplashDismiss = useCallback(() => {
    initAudio();
    setAudioReady(true);
    setGameState('MENU');
    if (!isMuted) startMusic('menu');
  }, [isMuted]);

  // ─── Music management ───
  useEffect(() => {
    if (!audioReady) return;
    if (isMuted) { stopMusic(); stopDrone(); return; }

    if (gameState === 'GAME_OVER' || gameState === 'NAME_INPUT') {
      // Music is handled by distortAndStopMusic; drone is playing — don't interfere
      return;
    }
    if (gameState === 'RANK_REVEAL') {
      stopDrone();
      return;
    }

    const isInGame = ['PRODUCT_SHOWCASE', 'TUTORIAL', 'DEAL', 'REVEAL', 'SHUFFLING', 'SELECTION', 'ROUND_COMPLETE', 'GRAND_PRIZE'].includes(gameState);
    stopDrone(); // ensure drone is off when returning to menu or starting a game
    if (isInGame) {
      startMusic('ingame');
    } else {
      startMusic('menu');
    }
  }, [gameState, isMuted, audioReady]);

  // ─── Handle Advance Round ───
  const handleAdvanceRound = useCallback(() => {
    if (round >= 8) {
      pendingScoreRef.current = { score, round };
      triggerTransition(() => {
        setGameState('NAME_INPUT');
      }, 'menu');
      return;
    }
    triggerTransition(() => {
      setScoreAtRoundStart(score);
      setupRound(round + 1);
    }, 'next');
  }, [round, score, triggerTransition, setupRound]);

  // ─── Handle Return to Menu ───
  const handleReturnToMenu = useCallback(() => {
    if (shuffleTimeoutRef.current) { clearTimeout(shuffleTimeoutRef.current); shuffleTimeoutRef.current = null; }
    clearInterval(timerRef.current);
    if (score > 0) {
      pendingScoreRef.current = { score, round };
    }
    bgRef.current?.gameOver?.();
    triggerTransition(() => {
      if (pendingScoreRef.current) {
        setGameState('NAME_INPUT');
      } else {
        setGameState('MENU');
      }
    }, 'menu');
  }, [score, round, triggerTransition]);

  // ─── Grand Prize ───
  const handleGrandPrize = useCallback(() => {
    const name = playerName || 'Winner';
    addGrandPrizeWinner(name);
    addGrandPrizeWinnerRemote(name).catch(() => {});
    setGpWinnersToday(prev => prev + 1);
    bgRef.current?.celebrate?.();
    setGameState('GRAND_PRIZE');
  }, [playerName]);

  const handleGrandPrizeContinue = useCallback(() => {
    pendingScoreRef.current = { score, round };
    triggerTransition(() => setGameState('NAME_INPUT'), 'menu');
  }, [score, round, triggerTransition]);

  // ─── Handle Name Submit ───
  const handleNameSubmit = useCallback(() => {
    const pending = pendingScoreRef.current;
    if (pending) {
      const name = playerName.trim() || 'Anonymous';
      const newEntry = { name, score: pending.score, date: new Date().toLocaleDateString(), round: pending.round };
      const allEntries = [...leaderboard, newEntry].sort((a, b) => b.score - a.score);
      const rank = allEntries.findIndex(e => e === newEntry) + 1;
      saveScore(pending.score, pending.round, name);
      setRankRevealData({ rank, entry: newEntry });
      pendingScoreRef.current = null;
      setPlayerName('');
      triggerTransition(() => setGameState('RANK_REVEAL'), 'menu');
    } else {
      setPlayerName('');
      triggerTransition(() => setGameState('MENU'), 'menu');
    }
  }, [playerName, leaderboard, saveScore, triggerTransition]);

  // ─── PRODUCT_SHOWCASE timing ───
  useEffect(() => {
    if (gameState !== 'PRODUCT_SHOWCASE') return;
    let t1, t3;
    if (showcasePhase === 'enter') {
      t1 = setTimeout(() => setShowcasePhase('display'), 1200);
    } else if (showcasePhase === 'disperse') {
      t3 = setTimeout(() => {
        setGameState('TUTORIAL');
      }, 900);
    }
    return () => { clearTimeout(t1); clearTimeout(t3); };
  }, [gameState, showcasePhase]);

  const handleShowcaseDismiss = useCallback(() => {
    if (showcasePhase !== 'display') return;
    setShowcasePhase('disperse');
    playSound('warpWoosh', isMuted);
  }, [showcasePhase, isMuted]);

  const handleTutorialSkip = useCallback(() => {
    playSound('menuSelect', isMuted);
    triggerTransition(() => {
      setupRound(1);
    }, 'next');
  }, [isMuted, triggerTransition, setupRound]);


  // ═══════════════════════════════════════════
  //  RENDER FUNCTIONS
  // ═══════════════════════════════════════════

  const renderSplash = () => (
    <div className="start-screen" onClick={assetsReady ? handleSplashDismiss : undefined} style={{ cursor: assetsReady ? 'pointer' : 'default' }}>
      <div className="start-screen__content splash-content">
        <img
          src={samsungLogo}
          alt="Samsung"
          className="h-8 sm:h-10 md:h-12 w-auto opacity-90 drop-shadow-[0_0_30px_rgba(255,255,255,0.2)]"
        />
        <div className="splash-continue mt-12 sm:mt-16">
          {assetsReady ? (
            <span className="text-[11px] sm:text-xs text-gray-400 tracking-[0.3em] uppercase animate-pulse">
              Touch Screen to Begin
            </span>
          ) : (
            <div className="splash-loader">
              <div className="splash-loader__bar">
                <div className="splash-loader__fill" style={{ width: `${loadProgress}%` }} />
              </div>
              <span className="text-[10px] sm:text-[11px] text-gray-500 tracking-[0.2em] uppercase mt-2">
                Loading {loadProgress}%
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderMenu = () => (
    <div className="start-screen">
      <div className="start-screen__content">
        <div className="start-screen__brand mb-1" aria-hidden="true">
          <img
            src={samsungLogo}
            alt="Samsung"
            className="h-5 sm:h-6 md:h-7 w-auto opacity-70 hover:opacity-90 transition-opacity drop-shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          />
        </div>
        <div className="start-screen__title-section">
          <h1 className="start-screen__title start-screen__title--logo">
            {!prefersReducedMotion.current && !isSafari && !(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768) ? (
              <>
                {/* Desktop: WebM intro → loop */}
                <video
                  ref={(el) => {
                    if (!el) return;
                    el.play().catch(() => {
                      el.style.display = 'none';
                      const fallback = el.parentElement.querySelector('.logo-fallback');
                      if (fallback) fallback.style.display = '';
                    });
                    el.onended = () => {
                      el.style.display = 'none';
                      const loop = el.parentElement.querySelector('.logo-video-loop');
                      if (loop) {
                        loop.style.display = '';
                        loop.play().catch(() => {
                          loop.style.display = 'none';
                          const fallback = loop.parentElement.querySelector('.logo-fallback');
                          if (fallback) fallback.style.display = '';
                        });
                      }
                    };
                  }}
                  poster={memoryFlipLogo}
                  width={800}
                  height={360}
                  className="logo-video"
                  muted
                  playsInline
                >
                  <source src={memoryFlipIntro} type="video/webm" />
                </video>
                <video
                  width={800}
                  height={360}
                  className="logo-video logo-video-loop"
                  style={{ display: 'none' }}
                  muted
                  playsInline
                  loop
                  preload="auto"
                >
                  <source src={memoryFlipLoop} type="video/webm" />
                </video>
                {/* PNG fallback if video fails */}
                <img
                  src={memoryFlipLogo}
                  alt="Memory Flip"
                  width={800}
                  height={360}
                  className="logo-video logo-fallback"
                  style={{ display: 'none' }}
                />
              </>
            ) : (
              <img
                src={memoryFlipLogo}
                alt="Memory Flip"
                width={800}
                height={360}
                className="logo-video"
              />
            )}
          </h1>
          <p className="start-screen__subtitle">
            Keep your eyes on the card.
          </p>
        </div>
        <div className="start-screen__divider" aria-hidden="true">
          <span className="start-screen__divider-line" />
          <span className="start-screen__divider-dot" />
          <span className="start-screen__divider-line" />
        </div>
        <div className="start-screen__menu">
          <button
            className="start-screen__btn start-screen__btn--primary"
            onClick={() => {
              playSound('menuSelect', isMuted);
              initAudio();
              setAudioReady(true);
              triggerTransition(() => {
                setScore(0);
                setRoundScore(0);
                setScoreAtRoundStart(0);
                setShowcasePhase('enter');
                setGameState('PRODUCT_SHOWCASE');
              }, 'start');
            }}
          >
            <span className="start-screen__btn-glow" aria-hidden="true" />
            <span className="start-screen__btn-inner">
              <span className="start-screen__btn-icon" aria-hidden="true">
                <Play size={18} fill="currentColor" />
              </span>
              PLAY
            </span>
          </button>
          <button className="start-screen__btn start-screen__btn--secondary" onClick={() => { playSound('click', isMuted); initAudio(); setAudioReady(true); triggerTransition(() => setGameState('LEADERBOARD'), 'none'); }}>
            <span className="start-screen__btn-inner">
              <span className="start-screen__btn-icon" aria-hidden="true">
                <Trophy size={18} className="text-[#0689D8] drop-shadow-[0_0_6px_rgba(6,137,216,0.5)]" />
              </span>
              Leaderboard
            </span>
          </button>
        </div>
        <div className="start-screen__footer">
          <p className="start-screen__hint">Watch the reveal &bull; Track through the shuffle &bull; Tap Samsung products</p>
          <div className="start-screen__badges">
            <span className="start-screen__badge">8 Rounds</span>
            <span className="start-screen__badge">Shuffle Challenge</span>
            <span className="start-screen__badge">Grand Prize</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPodium = (entries) => {
    const top3 = entries.slice(0, 3);
    if (top3.length === 0) return null;
    const medals = [
      { border: 'border-yellow-400/40', bg: 'podium-card-gold', text: 'text-yellow-400', glow: 'podium-gold', label: '1st', icon: '👑' },
      { border: 'border-gray-300/30', bg: 'podium-card-silver', text: 'text-gray-300', glow: 'podium-silver', label: '2nd', icon: '' },
      { border: 'border-amber-500/30', bg: 'podium-card-bronze', text: 'text-amber-500', glow: 'podium-bronze', label: '3rd', icon: '' },
    ];
    const order = top3.length >= 3 ? [1, 0, 2] : top3.length === 2 ? [1, 0] : [0];
    return (
      <div className="flex items-end justify-center gap-3 sm:gap-4 mb-5 sm:mb-6 rank-reveal-podium">
        {order.map(idx => {
          const entry = top3[idx];
          const medal = medals[idx];
          if (!entry) return null;
          const isFirst = idx === 0;
          return (
            <div key={idx} className={`podium-card flex flex-col items-center justify-end ${isFirst ? 'w-28 sm:w-32 md:w-36' : 'w-22 sm:w-26 md:w-28'} ${isFirst ? 'podium-card--first' : ''} ${medal.bg} border ${medal.border} rounded-2xl ${medal.glow} p-3 sm:p-4 transition-all`}
              style={{ minHeight: isFirst ? '140px' : idx === 1 ? '115px' : '100px' }}
            >
              {isFirst && <span className="text-xl mb-1">{medal.icon}</span>}
              <span className={`text-xs sm:text-sm font-bold ${medal.text} mb-1.5 tracking-wider`}>{medal.label}</span>
              <span className="text-white text-xs sm:text-sm font-semibold truncate w-full text-center drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">{entry.name || 'Anonymous'}</span>
              <span className="text-gray-300 text-[10px] sm:text-xs font-mono mt-1 tracking-wide">{entry.score} <span className="text-gray-500 text-[9px]">pts</span></span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderLeaderboardEntry = (entry, i, highlightEntry = null) => {
    const isPlayer = highlightEntry && entry.name === highlightEntry.name && entry.score === highlightEntry.score && entry.date === highlightEntry.date;
    return (
      <div
        key={`${i}-${entry.name}`}
        ref={isPlayer ? playerRowRef : undefined}
        className={`lb-row flex justify-between items-center py-3.5 sm:py-4 px-3.5 sm:px-5 rounded-xl transition-colors ${
          isPlayer ? 'lb-row--player' : i % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent'
        }`}
      >
        <div className="flex items-center min-w-0 gap-3 sm:gap-3.5">
          <span className={`lb-rank-badge shrink-0 ${
            i === 0 ? 'lb-rank--gold' : i === 1 ? 'lb-rank--silver' : i === 2 ? 'lb-rank--bronze' : ''
          }`}>
            {i + 1}
          </span>
          <span className="flex flex-col min-w-0">
            <span className="text-white/90 font-semibold truncate flex items-center gap-2 text-sm sm:text-base">
              {entry.name || 'Anonymous'}
              {isPlayer && <span className="lb-you-pill shrink-0">YOU</span>}
            </span>
            <span className="text-[11px] sm:text-xs text-gray-500 mt-0.5">{entry.date}{entry.round ? ` · Round ${entry.round}` : ''}</span>
          </span>
        </div>
        <span className="font-mono font-bold text-white tracking-wider text-base sm:text-lg shrink-0 ml-3">{entry.score}<span className="text-[11px] sm:text-sm font-normal text-gray-500 ml-1">pts</span></span>
      </div>
    );
  };

  const renderLeaderboard = () => {
    const allFiltered = leaderboard;
    const filtered = allFiltered.slice(0, 50);

    return (
      <div className="start-screen">
        <div className="start-screen__content z-10 w-full max-w-lg lb-screen">
          <div className="text-center mb-5 sm:mb-6">
            <div className="lb-title-icon mb-3">
              <Trophy size={28} className="text-[#0689D8]" />
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-wide mb-2">
              Top <span className="text-[#0689D8]">Scores</span>
            </h2>
            <p className="text-gray-400 text-xs sm:text-sm tracking-[0.25em] uppercase font-medium">Memory Flip Champions</p>
          </div>

          {renderPodium(allFiltered)}

          <div className="lb-list-panel mb-5 sm:mb-6">
            {filtered.length > 3 ? (
              <div className="max-h-[45vh] sm:max-h-[380px] overflow-y-auto leaderboard-scroll space-y-1 p-1">
                {filtered.slice(3).map((entry, i) => renderLeaderboardEntry(entry, i + 3))}
              </div>
            ) : filtered.length > 0 ? (
              <div className="text-center text-gray-400 py-5 sm:py-6 text-sm">
                All scores shown on the podium above.
              </div>
            ) : (
              <div className="text-center py-8 sm:py-10">
                <div className="text-gray-600 text-2xl mb-3">🏆</div>
                <p className="text-gray-400 text-sm font-medium mb-1">No scores yet</p>
                <p className="text-gray-600 text-xs">Play a round to claim your spot!</p>
              </div>
            )}
            {allFiltered.length > 50 && (
              <p className="text-gray-500 text-[10px] text-center mt-3 tracking-wider font-mono">{allFiltered.length} total entries</p>
            )}
          </div>

          <button className="start-screen__btn start-screen__btn--secondary w-full" onClick={() => { playSound('click', isMuted); triggerTransition(() => setGameState('MENU'), 'menu'); }}>
            <span className="start-screen__btn-inner">
              <span className="start-screen__btn-icon" aria-hidden="true"><Home size={18} /></span>
              Back to Main Menu
            </span>
          </button>
        </div>
      </div>
    );
  };

  const renderRankReveal = () => {
    if (!rankRevealData) return null;
    const { rank, entry } = rankRevealData;
    const allSorted = [...leaderboard].sort((a, b) => b.score - a.score);
    const top50 = allSorted.slice(0, 50);
    const inTop50 = rank <= 50;
    const accentColor = '#0689D8';

    return (
      <div className="start-screen">
        <div className="start-screen__content z-10 w-full max-w-lg lb-screen">
          <div className="text-center mb-4 sm:mb-5">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-wide">
              Your <span style={{ color: accentColor }}>Ranking</span>
            </h2>
          </div>

          <div className="rank-reveal-number rank-hero-card mb-5 sm:mb-6" style={{ '--accent': accentColor }}>
            <p className="text-gray-400 text-[10px] sm:text-xs tracking-[0.3em] uppercase mb-2 font-medium">Your Rank</p>
            <p className="rank-hero-number font-mono" style={{ color: accentColor }}>
              #{displayRank || rank}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-white/80 text-sm sm:text-base font-semibold">{entry.name || 'Anonymous'}</span>
              <span className="text-gray-500 text-xs">·</span>
              <span className="text-gray-400 text-xs sm:text-sm font-mono">{entry.score} pts</span>
            </div>
          </div>

          {renderPodium(allSorted)}

          {inTop50 ? (
            <div className="lb-list-panel mb-5 sm:mb-6 rank-reveal-list">
              <div className="max-h-[35vh] sm:max-h-[300px] overflow-y-auto rank-reveal-scroll space-y-1 p-1">
                {top50.map((e, i) => renderLeaderboardEntry(e, i, entry))}
              </div>
            </div>
          ) : (
            <div className="lb-list-panel mb-5 sm:mb-6 rank-reveal-list text-center py-6 sm:py-8">
              <p className="text-gray-400 text-sm font-medium mb-2">Keep playing to climb the ranks!</p>
              <p className="text-gray-500 text-xs mb-4">You need a top 50 score to appear on the board.</p>
              <button
                className="text-xs tracking-[0.2em] uppercase font-semibold transition-colors px-4 py-2 rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/5"
                style={{ color: accentColor }}
                onClick={() => { setRankRevealData(null); triggerTransition(() => setGameState('LEADERBOARD'), 'menu'); }}
              >
                View Top 50
              </button>
            </div>
          )}

          <button
            className="start-screen__btn start-screen__btn--primary w-full"
            onClick={() => { playSound('click', isMuted); setRankRevealData(null); triggerTransition(() => setGameState('MENU'), 'menu'); }}
          >
            <span className="start-screen__btn-inner">
              <span className="start-screen__btn-icon" aria-hidden="true"><Home size={18} /></span>
              Continue
            </span>
          </button>
        </div>
      </div>
    );
  };

  const renderHUD = () => {
    const config = ROUND_CONFIG[round - 1];
    const cardCount = config.rows * config.cols;
    const hudDelay = isEntering ? `${(cardCount * 60) + 200}ms` : '0ms';

    return (
      <header
        key={`hud-${enterKeyRef.current}`}
        className={`fixed top-0 left-0 right-0 flex items-center justify-between px-3 sm:px-6 md:px-8 py-3 sm:py-4 z-40 bg-black/50 backdrop-blur-md border-b border-white/[0.06] ${isEntering ? 'animate-hud-enter' : ''}`}
        style={isEntering ? { animationDelay: hudDelay } : {}}
      >
        {/* Left: Home + Round */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <button
            onClick={() => { playSound('click', isMuted); handleReturnToMenu(); }}
            className="p-2 sm:p-2.5 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/[0.06] shrink-0"
            aria-label="Back to Menu"
          >
            <Home size={18} className="sm:w-5 sm:h-5" />
          </button>
          <div className="w-px h-6 sm:h-7 bg-white/10 shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-gray-400 text-[9px] sm:text-[10px] tracking-widest uppercase leading-tight mb-0.5">Round</span>
            <span className="text-sm sm:text-base md:text-lg font-semibold truncate">
              {round} / 8
            </span>
          </div>
        </div>

        {/* Center: Phase indicator */}
        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center">
          {gameState === 'REVEAL' && revealCountdown !== null ? (
            <>
              <span className="text-gray-400 text-[9px] sm:text-[10px] tracking-widest uppercase leading-tight mb-0.5">
                <Eye size={10} className="inline mr-1" />Memorize
              </span>
              <span className="text-base sm:text-lg md:text-xl font-mono font-light tracking-wider text-[#00d4ff]"
                style={{ textShadow: '0 0 12px rgba(0,212,255,0.7)' }}>
                {revealCountdown}s
              </span>
            </>
          ) : gameState === 'SHUFFLING' ? (
            <>
              <span className="text-gray-400 text-[9px] sm:text-[10px] tracking-widest uppercase leading-tight mb-0.5">
                <Shuffle size={10} className="inline mr-1" />Shuffling
              </span>
              <span className="text-base sm:text-lg md:text-xl font-mono font-light tracking-wider text-yellow-400 animate-pulse">
                Watch!
              </span>
            </>
          ) : gameState === 'SELECTION' ? (
            <>
              <span className="text-gray-400 text-[9px] sm:text-[10px] tracking-widest uppercase leading-tight mb-0.5">
                <Target size={10} className="inline mr-1" />Find
              </span>
              <span className={`text-base sm:text-lg md:text-xl font-mono font-light tracking-wider ${selectionTimer <= 3 ? 'text-red-500 animate-pulse' : 'text-[#0689D8]'}`}>
                {selectionTimer}s
              </span>
            </>
          ) : (
            <>
              <span className="text-gray-400 text-[9px] sm:text-[10px] tracking-widest uppercase leading-tight mb-0.5">Status</span>
              <span className="text-base sm:text-lg md:text-xl font-mono font-light tracking-wider text-gray-500">
                {gameState === 'DEAL' ? 'Dealing...' : '—'}
              </span>
            </>
          )}
        </div>

        {/* Right: Taps + Score + Settings */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          {gameState === 'SELECTION' && (
            <div className="flex flex-col items-end min-w-0">
              <span className="text-gray-400 text-[9px] sm:text-[10px] tracking-widest uppercase leading-tight mb-0.5">Taps</span>
              <span className={`text-sm sm:text-base md:text-lg font-mono font-semibold ${tapsRemaining <= 1 ? 'text-red-400' : 'text-[#00d4ff]'}`}>{tapsRemaining}</span>
            </div>
          )}
          <div className="flex flex-col items-end min-w-0">
            <span className="text-gray-400 text-[9px] sm:text-[10px] tracking-widest uppercase leading-tight mb-0.5">Score</span>
            <span className="text-sm sm:text-base md:text-lg font-mono font-semibold">{score}</span>
          </div>
          <div className="w-px h-6 sm:h-7 bg-white/10 shrink-0" />
          <button
            onClick={() => { playSound('click', isMuted); setShowSettings(s => !s); }}
            className="p-2 sm:p-2.5 text-gray-400 hover:text-white transition-all duration-300 rounded-lg hover:bg-white/[0.06] shrink-0"
            aria-label="Settings"
          >
            <Settings size={18} className={`sm:w-5 sm:h-5 transition-transform duration-300 ${showSettings ? 'rotate-90' : ''}`} />
          </button>
        </div>
      </header>
    );
  };

  // ─── Grid Rendering ───
  const renderGrid = () => {
    const config = ROUND_CONFIG[round - 1];
    const { rows, cols } = config;
    const gridDataAttr = `${rows}x${cols}`;

    // Sort deck by gridIndex for positional rendering
    const sortedDeck = [...deck].sort((a, b) => a.gridIndex - b.gridIndex);

    return (
      <div
        key={`grid-${enterKeyRef.current}`}
        className="game-grid-wrapper"
        data-grid={gridDataAttr}
        ref={gridMeasureRef}
      >
        <div
          className="grid gap-2 sm:gap-3 transition-all duration-700 ease-out"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
            perspective: '800px',
          }}
        >
          {sortedDeck.map((card) => {
            const deckIndex = deck.indexOf(card);
            const isCorrectlyFound = card.isFound;
            const isMissed = card.isMissed && showMissedReveal;
            const isWrongTap = card.isWrong;

            return (
              <div
                key={card.id}
                data-grid-index={card.gridIndex}
                role="button"
                tabIndex={isLocked || card.isFound ? -1 : 0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleCardTap(deckIndex)}
                className={`perspective-1000 w-full cursor-pointer outline-none focus:ring-2 focus:ring-[#0689D8] group relative
                  ${isEntering ? 'animate-card-enter' : ''}
                  ${isCelebrating && isCorrectlyFound ? 'celebrate-pop' : ''}
                  ${isWrongTap ? 'animate-wrong-tap' : ''}
                `}
                data-aspect="card"
                style={{
                  ...(isEntering ? { animationDelay: `${card.gridIndex * 60}ms` } : {}),
                  ...(isCelebrating && isCorrectlyFound ? { animationDelay: `${(card.gridIndex % 4) * 0.1}s` } : {}),
                }}
                onClick={() => handleCardTap(deckIndex)}
              >
                <div
                  className={`relative w-full h-full transform-style-3d breeze-transition
                    ${card.isFlipped ? 'rotate-y-180' : ''}
                    ${isWrongTap ? 'animate-mismatch' : ''}
                    ${!card.isFlipped && !isLocked && gameState === 'SELECTION' ? 'group-hover:-translate-y-1' : ''}
                  `}
                >
                  {/* Card Front — Metallic Samsung logo (face-down) */}
                  <div className="absolute inset-0 w-full h-full backface-hidden card-front-face overflow-hidden">
                    {prefersReducedMotion.current || !supportsWebM.current ? (
                      <img src={cardMetallicBase} alt="Card back" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
                    ) : (
                      <>
                        <video
                          src={cardMetallicSheen}
                          autoPlay loop muted playsInline preload="metadata"
                          className="absolute inset-0 w-full h-full object-cover"
                          draggable={false}
                          onError={(e) => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'block'; }}
                        />
                        <img src={cardMetallicBase} alt="Card back" className="absolute inset-0 w-full h-full object-cover" style={{ display: 'none' }} draggable={false} />
                      </>
                    )}
                    <img
                      src={samsungLogo}
                      alt="Samsung"
                      className="absolute inset-0 m-auto w-[60%] z-10 pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
                      draggable={false}
                    />
                  </div>
                  {/* Card Back — Content reveal */}
                  <div className={`absolute inset-0 w-full h-full backface-hidden card-back-face overflow-hidden flex items-center justify-center breeze-transition
                    ${isCorrectlyFound ? 'card-found-glow' : ''}
                    ${isMissed ? 'card-missed-dim' : ''}
                    ${isWrongTap ? 'card-wrong-flash' : ''}
                    ${card.isSamsung && gameState === 'REVEAL' ? 'card-samsung-reveal' : ''}
                  `}>
                    <img src={cardSemiconductorGold} alt="Card face" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
                    <img
                      src={card.icon}
                      alt={card.name}
                      className={`card-icon relative z-10 ${isCorrectlyFound ? 'scale-110' : ''} ${isWrongTap ? 'opacity-60' : ''}`}
                      draggable={false}
                    />
                    {/* Product name label for Samsung products when found */}
                    {isCorrectlyFound && card.isSamsung && (
                      <span className="absolute bottom-1 left-0 right-0 text-center text-[8px] sm:text-[9px] text-white/80 font-semibold tracking-wider z-20 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                        {card.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ─── Side progress bar ───
  const renderSideInfo = () => {
    if (!['DEAL', 'REVEAL', 'SHUFFLING', 'SELECTION'].includes(gameState)) return null;
    const config = ROUND_CONFIG[round - 1];
    const cardCount = config.rows * config.cols;
    const barDelay = isEntering ? `${(cardCount * 60) + 400}ms` : '0ms';
    const progressPercent = (correctTaps / config.samsungCount) * 100;

    return (
      <div
        key={`sideinfo-${enterKeyRef.current}`}
        className={`fixed left-3 sm:left-4 md:left-6 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-3 ${isEntering ? 'animate-footer-enter' : ''}`}
        style={isEntering ? { animationDelay: barDelay } : {}}
      >
        <span className="text-[9px] sm:text-[10px] text-gray-500 font-medium tracking-widest uppercase writing-mode-vertical">
          Found
        </span>
        <div className="w-2 sm:w-2.5 h-48 sm:h-56 md:h-64 bg-[#1A1A1A] rounded-full overflow-hidden relative">
          <div
            className="absolute bottom-0 left-0 w-full bg-[#0689D8] rounded-full transition-all duration-700 ease-out"
            style={{ height: `${progressPercent}%` }}
          />
        </div>
        <span className="text-[10px] sm:text-xs text-gray-500 font-mono font-medium">
          {correctTaps}/{config.samsungCount}
        </span>
      </div>
    );
  };

  const renderGameOver = () => (
    <div className="start-screen game-over-screen">
      <div className="start-screen__content z-10 w-full max-w-md">
        <div className="text-center mb-5 sm:mb-6">
          <div className="game-over-icon-ring mb-4">
            <X size={36} className="text-red-400" />
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-wide mb-2">
            <span className="text-red-400">Eliminated</span>
          </h2>
          <p className="text-gray-400 text-xs sm:text-sm tracking-[0.15em] uppercase font-medium mb-1">
            Round {round} of 8
          </p>
          <p className="text-gray-500 text-[10px] sm:text-xs tracking-wide">
            Find all Samsung products to advance
          </p>
        </div>
        <div className="game-over-stats-panel mb-6 sm:mb-8">
          <div className="flex justify-between items-center py-3 border-b border-white/[0.06]">
            <span className="text-gray-400 text-xs sm:text-sm tracking-[0.2em] uppercase font-medium">Final Score</span>
            <span className="font-mono font-bold text-white text-xl sm:text-2xl">{score}</span>
          </div>
          <div className="flex justify-between items-center py-3">
            <span className="text-gray-400 text-xs sm:text-sm tracking-[0.2em] uppercase font-medium">Round Reached</span>
            <span className="font-mono font-bold text-white text-xl sm:text-2xl">{round}</span>
          </div>
        </div>
        {score >= PRIZE_TIERS[0].threshold && (
          <div className="text-center mb-5">
            <p className="text-[10px] text-gray-500 tracking-widest uppercase mb-2">Prize Earned</p>
            <p className="text-lg font-bold text-yellow-400">
              {score >= PRIZE_TIERS[1].threshold ? PRIZE_TIERS[1].name : PRIZE_TIERS[0].name}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3 w-full max-w-xs mx-auto">
          <button
            className="start-screen__btn start-screen__btn--primary w-full"
            onClick={() => { playSound('click', isMuted); setGameState('NAME_INPUT'); }}
          >
            <span className="start-screen__btn-inner">
              <span className="start-screen__btn-icon" aria-hidden="true"><Trophy size={18} /></span>
              Save Score
            </span>
          </button>
          <button
            className="start-screen__btn start-screen__btn--secondary w-full"
            onClick={() => { playSound('click', isMuted); pendingScoreRef.current = null; triggerTransition(() => setGameState('MENU'), 'menu'); }}
          >
            <span className="start-screen__btn-inner text-xs sm:text-sm">
              <span className="start-screen__btn-icon" aria-hidden="true"><Home size={16} /></span>
              Skip to Main Menu
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderNameInput = () => {
    const kbRows = [
      ['Q','W','E','R','T','Y','U','I','O','P'],
      ['A','S','D','F','G','H','J','K','L'],
      ['Z','X','C','V','B','N','M'],
    ];
    const handleKey = (key) => {
      playSound('click', isMuted);
      if (key === 'DEL') {
        setPlayerName(prev => prev.slice(0, -1));
      } else if (key === 'SPACE') {
        setPlayerName(prev => prev.length < 16 ? prev + ' ' : prev);
      } else {
        setPlayerName(prev => prev.length < 16 ? prev + key : prev);
      }
    };

    return (
      <div className="start-screen">
        <div className="start-screen__content z-10 w-full max-w-lg px-3">
          <div className="text-center mb-3 sm:mb-4">
            <h2 className="text-xl sm:text-2xl md:text-3xl font-light text-white tracking-wide mb-1">
              <span className="text-[#0689D8] font-bold">Save Score</span>
            </h2>
            <p className="text-gray-400 text-[10px] sm:text-xs tracking-widest uppercase">
              {pendingScoreRef.current?.score || 0} pts — Round {pendingScoreRef.current?.round || 1}
            </p>
          </div>

          <div className="w-full bg-[#0A0A0A] border border-[#333] rounded-xl px-4 py-3 mb-4 min-h-[52px] flex items-center justify-center">
            {playerName ? (
              <span className="text-white text-xl sm:text-2xl font-mono tracking-[0.2em] text-center">{playerName}<span className="animate-pulse text-[#0689D8]">|</span></span>
            ) : (
              <span className="text-gray-600 text-lg font-mono tracking-wider">Tap to enter name</span>
            )}
          </div>

          <div className="name-keyboard w-full bg-[#1A1A1A]/80 border border-[#2A2A2A] backdrop-blur-md rounded-2xl p-2 sm:p-3 mb-4 shadow-2xl">
            {kbRows.map((row, ri) => (
              <div key={ri} className="flex justify-center gap-[5px] sm:gap-1.5 mb-[5px] sm:mb-1.5">
                {row.map((key) => (
                  <button
                    key={key}
                    onClick={() => handleKey(key)}
                    className="kb-key w-[30px] h-[40px] sm:w-[38px] sm:h-[46px] md:w-[42px] md:h-[50px] bg-[#252525] hover:bg-[#333] active:bg-[#0689D8] active:scale-95 border border-[#3a3a3a] rounded-lg text-white text-sm sm:text-base font-semibold transition-all duration-100 select-none touch-manipulation"
                  >
                    {key}
                  </button>
                ))}
              </div>
            ))}
            <div className="flex justify-center gap-[5px] sm:gap-1.5">
              <button
                onClick={() => handleKey('DEL')}
                className="kb-action h-[40px] sm:h-[46px] md:h-[50px] px-3 sm:px-4 bg-[#302020] hover:bg-[#443030] active:bg-red-500 active:scale-95 border border-[#3a3a3a] rounded-lg text-red-400 active:text-white text-xs sm:text-sm font-semibold tracking-wider transition-all duration-100 select-none touch-manipulation"
              >
                DEL
              </button>
              <button
                onClick={() => handleKey('SPACE')}
                className="kb-action flex-1 h-[40px] sm:h-[46px] md:h-[50px] bg-[#252525] hover:bg-[#333] active:bg-[#0689D8] active:scale-95 border border-[#3a3a3a] rounded-lg text-gray-400 text-xs sm:text-sm font-semibold tracking-widest transition-all duration-100 select-none touch-manipulation"
              >
                SPACE
              </button>
              <button
                onClick={handleNameSubmit}
                className="kb-action h-[40px] sm:h-[46px] md:h-[50px] px-4 sm:px-6 bg-[#0689D8] hover:bg-[#07a0f5] active:bg-[#0560a0] active:scale-95 border border-[#0689D8]/50 rounded-lg text-white text-xs sm:text-sm font-bold tracking-wider transition-all duration-100 select-none touch-manipulation shadow-[0_0_15px_rgba(6,137,216,0.3)]"
              >
                SAVE
              </button>
            </div>
          </div>

          <button
            className="w-full text-center text-gray-500 hover:text-gray-300 text-xs sm:text-sm tracking-widest uppercase py-2 transition-colors touch-manipulation"
            onClick={() => { playSound('click', isMuted); pendingScoreRef.current = null; setPlayerName(''); triggerTransition(() => setGameState('MENU'), 'menu'); }}
          >
            Skip
          </button>
        </div>
      </div>
    );
  };

  // ─── Admin PIN touchpad helpers ───
  const handleAdminPinDigit = (digit) => {
    playSound('click', isMuted);
    setAdminPinError(false);
    setAdminPin(prev => {
      if (prev.length >= 4) return prev;
      const next = prev + digit;
      // Auto-submit when 4 digits entered
      if (next.length === 4) {
        setTimeout(() => {
          if (next === '1313') {
            setAdminUnlocked(true);
            setAdminPinError(false);
            setAdminPin('');
            playSound('correct', isMuted);
          } else {
            setAdminPinError(true);
            playSound('wrong', isMuted);
            setTimeout(() => { setAdminPin(''); setAdminPinError(false); }, 1000);
          }
        }, 150);
      }
      return next;
    });
  };

  const handleAdminPinBackspace = () => {
    playSound('click', isMuted);
    setAdminPin(prev => prev.slice(0, -1));
    setAdminPinError(false);
  };

  const handleAdminPinSubmit = () => {
    if (adminPin === '1313') {
      setAdminUnlocked(true);
      setAdminPinError(false);
      setAdminPin('');
      playSound('correct', isMuted);
    } else {
      setAdminPinError(true);
      playSound('wrong', isMuted);
      setTimeout(() => { setAdminPin(''); setAdminPinError(false); }, 1000);
    }
  };

  const handleAdminClearLeaderboard = async () => {
    if (adminBusy) return;
    setAdminBusy(true);
    setAdminMsg('');
    try {
      await clearLeaderboard('1313');
      setLeaderboard([]);
      setAdminMsg('Leaderboard cleared (cloud + local)');
      playSound('correct', isMuted);
    } catch {
      // Cloud failed — clear local only
      setLeaderboard([]);
      localStorage.removeItem('galaxy-sync-leaderboard');
      setAdminMsg('Cleared locally (cloud unavailable)');
    }
    setAdminBusy(false);
    setTimeout(() => setAdminMsg(''), 3000);
  };

  const handleAdminResetGrandPrize = async () => {
    if (adminBusy) return;
    setAdminBusy(true);
    setAdminMsg('');
    try {
      await resetGrandPrizeTodayRemote('1313');
      resetGrandPrizeToday();
      setGpWinnersToday(0);
      setAdminMsg('Grand prize winners reset');
      playSound('correct', isMuted);
    } catch {
      resetGrandPrizeToday();
      setGpWinnersToday(0);
      setAdminMsg('Reset locally (cloud unavailable)');
    }
    setAdminBusy(false);
    setTimeout(() => setAdminMsg(''), 3000);
  };

  // ─── Settings Panel ───
  const renderSettings = () => {
    if (!showSettings) return null;
    return (
      <div className="fixed top-12 right-3 sm:top-14 sm:right-4 md:right-6 z-50 w-56 sm:w-64 bg-[#131313]/95 border border-[#2A2A2A] backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden settings-panel-enter" style={{ maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-[10px] sm:text-[11px] text-gray-400 tracking-[0.2em] uppercase font-semibold">Audio</span>
          <button onClick={() => { setShowSettings(false); setShowAdminPanel(false); setAdminUnlocked(false); setAdminPin(''); }} className="text-gray-500 hover:text-white transition-colors p-0.5">
            <X size={14} />
          </button>
        </div>
        <div className="px-4 pb-4 space-y-4">
          <button
            onClick={() => {
              if (!isMuted) playSound('toggleOff', false);
              setIsMuted(!isMuted);
              if (isMuted) setTimeout(() => playSound('toggleOn', false), 50);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200 ${isMuted
              ? 'bg-red-500/10 border-red-500/20 text-red-400'
              : 'bg-white/[0.03] border-white/[0.06] text-gray-300 hover:bg-white/[0.06]'
            }`}
          >
            {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            <span className="text-xs font-medium tracking-wide">{isMuted ? 'Muted' : 'Sound On'}</span>
          </button>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-gray-400">
              <Music size={12} className="shrink-0 translate-y-[0.5px]" />
              <span className="text-[10px] tracking-[0.15em] uppercase font-medium leading-none">Music</span>
              <span className="text-[10px] text-gray-600 ml-auto font-mono leading-none">{Math.round(musicVol * 100)}%</span>
            </div>
            <input type="range" min="0" max="100" value={Math.round(musicVol * 100)}
              onChange={(e) => { const v = parseInt(e.target.value) / 100; setMusicVol(v); setMusicVolume(v); }}
              className="settings-slider w-full" disabled={isMuted} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-gray-400">
              <Zap size={12} className="shrink-0 translate-y-[0.5px]" />
              <span className="text-[10px] tracking-[0.15em] uppercase font-medium leading-none">SFX</span>
              <span className="text-[10px] text-gray-600 ml-auto font-mono leading-none">{Math.round(sfxVol * 100)}%</span>
            </div>
            <input type="range" min="0" max="100" value={Math.round(sfxVol * 100)}
              onChange={(e) => { const v = parseInt(e.target.value) / 100; setSfxVol(v); setSfxVolume(v); }}
              className="settings-slider w-full" disabled={isMuted} />
          </div>
          <div className="border-t border-white/[0.06] pt-3 mt-1">
            <span className="text-[10px] sm:text-[11px] text-gray-400 tracking-[0.2em] uppercase font-semibold">Display</span>
          </div>
          <button
            onClick={() => { toggleFullscreen(); playSound('click', isMuted); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200 ${isFullscreen
              ? 'bg-sky-500/10 border-sky-500/20 text-sky-400'
              : 'bg-white/[0.03] border-white/[0.06] text-gray-300 hover:bg-white/[0.06]'
            }`}
          >
            {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
            <span className="text-xs font-medium tracking-wide">{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
          </button>
          <div className="border-t border-white/[0.06] pt-3 mt-1">
            <span className="text-[10px] sm:text-[11px] text-gray-400 tracking-[0.2em] uppercase font-semibold">Grand Prize</span>
          </div>
          <button
            onClick={() => { const next = !gpDisabled; setGrandPrizeDisabled(next); setGpDisabled(next); playSound('click', isMuted); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200 ${gpDisabled
              ? 'bg-red-500/10 border-red-500/20 text-red-400'
              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            }`}
          >
            <Trophy size={15} />
            <span className="text-xs font-medium tracking-wide">{gpDisabled ? 'Disabled' : 'Enabled'}</span>
          </button>
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-400 tracking-wider uppercase font-medium">Today's Winners</span>
              <span className="text-xs text-white font-mono mt-0.5">{gpWinnersToday} / {GRAND_PRIZE_DAILY_MAX}</span>
            </div>
            <button
              onClick={() => { resetGrandPrizeToday(); setGpWinnersToday(0); playSound('click', isMuted); }}
              className="text-[10px] tracking-wider uppercase font-semibold text-yellow-400 hover:text-yellow-300 px-3 py-1.5 rounded-lg border border-yellow-400/20 hover:border-yellow-400/40 hover:bg-yellow-400/5 transition-all"
            >
              Reset
            </button>
          </div>

          {/* ─── Admin Settings ─── */}
          <div className="border-t border-white/[0.06] pt-3 mt-1">
            <button
              onClick={() => { setShowAdminPanel(true); setShowSettings(false); playSound('click', isMuted); }}
              className="w-full flex items-center gap-2 text-gray-400 hover:text-gray-200 transition-colors active:scale-95"
            >
              <Shield size={13} />
              <span className="text-[10px] sm:text-[11px] tracking-[0.2em] uppercase font-semibold">Admin Settings</span>
              <Lock size={11} className="ml-auto" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Admin Overlay (fullscreen touchpad + actions) ───
  const renderAdminOverlay = () => {
    if (!showAdminPanel) return null;

    const closeAdmin = () => {
      setShowAdminPanel(false);
      setAdminUnlocked(false);
      setAdminPin('');
      setAdminPinError(false);
      setAdminMsg('');
    };

    // PIN dots display
    const pinDots = Array.from({ length: 4 }, (_, i) => (
      <div
        key={i}
        className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 transition-all duration-150 ${
          adminPinError
            ? 'border-red-500 bg-red-500'
            : i < adminPin.length
              ? 'border-[#0689D8] bg-[#0689D8]'
              : 'border-white/20 bg-transparent'
        }`}
      />
    ));

    return (
      <div className="fixed inset-0 z-[100] bg-black/[0.97] backdrop-blur-2xl flex items-center justify-center">
        {/* Close button */}
        <button
          onClick={closeAdmin}
          className="absolute top-4 right-4 sm:top-6 sm:right-6 p-3 text-gray-400 hover:text-white transition-colors active:scale-90 touch-manipulation"
        >
          <X size={24} />
        </button>

        {!adminUnlocked ? (
          /* ── PIN Touchpad ── */
          <div className="flex flex-col items-center gap-6 sm:gap-8 w-full max-w-xs px-4">
            {/* Header */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                <Shield size={28} className="text-[#0689D8]" />
              </div>
              <h3 className="text-white text-lg sm:text-xl font-semibold tracking-wide">Admin Access</h3>
              <p className={`text-xs tracking-[0.2em] uppercase transition-colors ${adminPinError ? 'text-red-400' : 'text-gray-500'}`}>
                {adminPinError ? 'Incorrect PIN' : 'Enter PIN'}
              </p>
            </div>

            {/* PIN dots */}
            <div className={`flex gap-4 sm:gap-5 ${adminPinError ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}>
              {pinDots}
            </div>

            {/* Numeric touchpad */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4 w-full">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                <button
                  key={n}
                  onClick={() => handleAdminPinDigit(String(n))}
                  className="aspect-square rounded-2xl bg-white/[0.04] border border-white/[0.06] text-white text-2xl sm:text-3xl font-light flex items-center justify-center hover:bg-white/[0.08] active:bg-white/[0.12] active:scale-95 transition-all duration-100 touch-manipulation select-none"
                >
                  {n}
                </button>
              ))}
              {/* Bottom row: empty, 0, backspace */}
              <div />
              <button
                onClick={() => handleAdminPinDigit('0')}
                className="aspect-square rounded-2xl bg-white/[0.04] border border-white/[0.06] text-white text-2xl sm:text-3xl font-light flex items-center justify-center hover:bg-white/[0.08] active:bg-white/[0.12] active:scale-95 transition-all duration-100 touch-manipulation select-none"
              >
                0
              </button>
              <button
                onClick={handleAdminPinBackspace}
                className="aspect-square rounded-2xl bg-white/[0.02] border border-white/[0.04] text-gray-400 text-lg flex items-center justify-center hover:bg-white/[0.06] active:bg-white/[0.1] active:scale-95 transition-all duration-100 touch-manipulation select-none"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
              </button>
            </div>
          </div>
        ) : (
          /* ── Admin Actions (unlocked) ── */
          <div className="flex flex-col items-center gap-5 sm:gap-6 w-full max-w-sm px-6">
            {/* Header */}
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Shield size={28} className="text-emerald-400" />
              </div>
              <h3 className="text-white text-lg sm:text-xl font-semibold tracking-wide">Admin Panel</h3>
              {/* Sync status indicator */}
              {(() => {
                const pending = getPendingSyncCount();
                return (
                  <div className={`flex items-center gap-2 text-[11px] sm:text-xs tracking-wider uppercase ${pending > 0 ? 'text-amber-400' : 'text-emerald-400/60'}`}>
                    <span className={`w-2 h-2 rounded-full ${pending > 0 ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                    {pending > 0 ? `${pending} score${pending > 1 ? 's' : ''} pending sync` : 'All synced to cloud'}
                  </div>
                );
              })()}
            </div>

            {/* Status message */}
            {adminMsg && (
              <div className="w-full text-sm text-emerald-400 tracking-wider bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-center">
                {adminMsg}
              </div>
            )}

            {/* Action buttons — large touch targets */}
            <div className="w-full space-y-3">
              <button
                onClick={handleAdminResetGrandPrize}
                disabled={adminBusy}
                className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl border border-yellow-500/20 bg-yellow-500/5 text-yellow-400 hover:bg-yellow-500/10 active:bg-yellow-500/15 active:scale-[0.98] transition-all duration-150 disabled:opacity-40 touch-manipulation"
              >
                <RotateCcw size={22} className={adminBusy ? 'animate-spin' : ''} />
                <div className="text-left">
                  <span className="text-sm sm:text-base font-medium block">Reset Grand Prize</span>
                  <span className="text-[10px] sm:text-xs text-yellow-500/60 tracking-wider uppercase">Clear today's winners</span>
                </div>
              </button>

              <button
                onClick={handleAdminClearLeaderboard}
                disabled={adminBusy}
                className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 active:bg-red-500/15 active:scale-[0.98] transition-all duration-150 disabled:opacity-40 touch-manipulation"
              >
                <Trash2 size={22} />
                <div className="text-left">
                  <span className="text-sm sm:text-base font-medium block">Clear Leaderboard</span>
                  <span className="text-[10px] sm:text-xs text-red-500/60 tracking-wider uppercase">Erase all scores</span>
                </div>
              </button>

            </div>

            {/* Lock button */}
            <button
              onClick={closeAdmin}
              className="text-xs text-gray-500 hover:text-gray-300 tracking-[0.2em] uppercase py-2 transition-colors touch-manipulation active:scale-95"
            >
              Lock & Close
            </button>
          </div>
        )}
      </div>
    );
  };

  // ─── Product Showcase Screen ───
  const showcaseDisperseVectors = useMemo(() =>
    SAMSUNG_PRODUCTS.map((_, i) => {
      const angle = (i / SAMSUNG_PRODUCTS.length) * 360 + (Math.random() * 40 - 20);
      const rad = angle * (Math.PI / 180);
      const dist = 600 + Math.random() * 400;
      return { tx: Math.cos(rad) * dist, ty: Math.sin(rad) * dist, angle };
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [gameState === 'PRODUCT_SHOWCASE']);

  const renderProductShowcase = () => {
    return (
      <div
        className="flex flex-col items-center justify-center w-full h-full min-h-screen min-h-[100dvh] px-4"
        onClick={handleShowcaseDismiss}
        style={{ cursor: showcasePhase === 'display' ? 'pointer' : 'default' }}
      >
        {/* Title */}
        <div className={`text-center mb-6 sm:mb-8 transition-all duration-700 ${showcasePhase === 'enter' ? 'opacity-0 translate-y-4' : showcasePhase === 'disperse' ? 'opacity-0 -translate-y-8 scale-95' : 'opacity-100 translate-y-0'}`}>
          <p className="text-sm sm:text-xl md:text-2xl tracking-[0.3em] uppercase text-[#0689D8] font-bold mb-2 sm:mb-3" style={{ fontFamily: 'SamsungSharpSans-Bold, sans-serif' }}>
            Memorize These Products
          </p>
          <p className="text-xs sm:text-sm md:text-base tracking-[0.15em] uppercase text-gray-400">
            Find them during each round
          </p>
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-4 sm:grid-cols-4 gap-4 sm:gap-6 md:gap-8 max-w-2xl mx-auto">
          {SAMSUNG_PRODUCTS.map((product, i) => {
            const { tx, ty, angle } = showcaseDisperseVectors[i] || { tx: 0, ty: 0, angle: 0 };

            return (
              <div
                key={product.name}
                className="flex flex-col items-center gap-2 sm:gap-3 transition-all"
                style={{
                  transitionDuration: showcasePhase === 'disperse' ? '800ms' : '600ms',
                  transitionTimingFunction: showcasePhase === 'disperse'
                    ? 'cubic-bezier(.55, 0, 1, .45)'
                    : 'cubic-bezier(.16, 1, .3, 1)',
                  transitionDelay: showcasePhase === 'enter'
                    ? `${150 + i * 80}ms`
                    : showcasePhase === 'disperse'
                      ? `${i * 30}ms`
                      : '0ms',
                  opacity: showcasePhase === 'enter' ? 0 : showcasePhase === 'disperse' ? 0 : 1,
                  transform: showcasePhase === 'enter'
                    ? 'scale(0.3) translateY(30px)'
                    : showcasePhase === 'disperse'
                      ? `translate(${tx}px, ${ty}px) scale(0.2) rotate(${angle}deg)`
                      : 'scale(1) translateY(0)',
                }}
              >
                <div className="w-24 h-24 sm:w-28 sm:h-28 md:w-36 md:h-36 rounded-xl bg-white/[0.06] backdrop-blur-sm border border-white/[0.08] flex items-center justify-center p-3 sm:p-4 shadow-lg shadow-black/20">
                  <img src={product.icon} alt={product.name} className="w-full h-full object-contain drop-shadow-[0_0_8px_rgba(6,137,216,0.3)]" draggable={false} />
                </div>
                <span className="text-[11px] sm:text-sm md:text-base text-gray-300 tracking-wider text-center leading-tight whitespace-nowrap" style={{ fontFamily: 'SamsungSharpSans-Medium, sans-serif' }}>
                  {product.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* Tap to continue */}
        <div className={`mt-8 sm:mt-12 transition-all duration-700 ${showcasePhase === 'display' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <span className="text-[11px] sm:text-xs tracking-[0.3em] uppercase text-gray-400 animate-pulse" style={{ fontFamily: 'SamsungSharpSans-Medium, sans-serif' }}>
            Tap to Continue
          </span>
        </div>
      </div>
    );
  };

  const renderTutorial = () => (
    <div className="flex flex-col items-center justify-center w-full h-full min-h-screen min-h-[100dvh] px-4">
      <div className="start-screen__content tutorial-content" style={{ animation: 'contentFadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}>
        <p className="text-lg sm:text-2xl md:text-4xl tracking-[0.3em] uppercase text-[#0689D8] font-bold" style={{ fontFamily: 'SamsungSharpSans-Bold, sans-serif' }}>
          How to Play
        </p>

        <div className="flex flex-col gap-6 sm:gap-8 md:gap-10 w-full max-w-lg">
          {/* Step 1 */}
          <div className="flex items-start gap-4 sm:gap-5 md:gap-6">
            <div className="w-14 h-14 sm:w-18 sm:h-18 md:w-20 md:h-20 rounded-xl bg-[#0689D8]/10 border border-[#0689D8]/20 flex items-center justify-center flex-shrink-0" style={{ minWidth: '3.5rem' }}>
              <Eye className="text-[#0689D8] w-6 h-6 sm:w-8 sm:h-8 md:w-9 md:h-9" />
            </div>
            <div>
              <p className="text-base sm:text-lg md:text-xl text-white font-semibold mb-1" style={{ fontFamily: 'SamsungSharpSans-Bold, sans-serif' }}>Watch the Reveal</p>
              <p className="text-sm sm:text-base md:text-lg text-gray-400 leading-relaxed">Samsung products are briefly shown face-up. Memorize their positions.</p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex items-start gap-4 sm:gap-5 md:gap-6">
            <div className="w-14 h-14 sm:w-18 sm:h-18 md:w-20 md:h-20 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center flex-shrink-0" style={{ minWidth: '3.5rem' }}>
              <Shuffle className="text-purple-400 w-6 h-6 sm:w-8 sm:h-8 md:w-9 md:h-9" />
            </div>
            <div>
              <p className="text-base sm:text-lg md:text-xl text-white font-semibold mb-1" style={{ fontFamily: 'SamsungSharpSans-Bold, sans-serif' }}>Track the Shuffle</p>
              <p className="text-sm sm:text-base md:text-lg text-gray-400 leading-relaxed">Cards flip face-down and shuffle. Keep your eyes on the Samsung products.</p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex items-start gap-4 sm:gap-5 md:gap-6">
            <div className="w-14 h-14 sm:w-18 sm:h-18 md:w-20 md:h-20 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0" style={{ minWidth: '3.5rem' }}>
              <Target className="text-emerald-400 w-6 h-6 sm:w-8 sm:h-8 md:w-9 md:h-9" />
            </div>
            <div>
              <p className="text-base sm:text-lg md:text-xl text-white font-semibold mb-1" style={{ fontFamily: 'SamsungSharpSans-Bold, sans-serif' }}>Tap to Find</p>
              <p className="text-sm sm:text-base md:text-lg text-gray-400 leading-relaxed">Select the cards you think are Samsung products. More correct taps = higher score!</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-lg mt-4">
          <button
            className="start-screen__btn start-screen__btn--primary w-full"
            onClick={handleTutorialSkip}
          >
            <span className="start-screen__btn-glow" aria-hidden="true" />
            <span className="start-screen__btn-inner">
              <span className="start-screen__btn-icon" aria-hidden="true">
                <Play size={18} fill="currentColor" />
              </span>
              START GAME
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════
  //  MAIN RENDER
  // ═══════════════════════════════════════════
  const isInGame = ['DEAL', 'REVEAL', 'SHUFFLING', 'SELECTION'].includes(gameState);

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#05060a] flex flex-col items-center justify-center relative overflow-hidden">
      <SpaceBackground ref={bgRef} />
      <div className={`relative z-10 w-full h-full min-h-screen min-h-[100dvh] flex flex-col items-center justify-center py-4 sm:py-6 transition-opacity duration-[650ms] ease-[cubic-bezier(.22,1,.36,1)] ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
        {/* Settings gear — menu/leaderboard screens */}
        {(gameState === 'MENU' || gameState === 'LEADERBOARD') && (
          <button
            onClick={() => { playSound('click', isMuted); setShowSettings(s => !s); }}
            className="fixed top-3 right-3 sm:top-4 sm:right-4 md:right-6 z-40 p-2 text-gray-400 hover:text-white transition-all duration-300 rounded-lg hover:bg-white/[0.06]"
            aria-label="Settings"
          >
            <Settings size={18} className={`sm:w-5 sm:h-5 transition-transform duration-300 ${showSettings ? 'rotate-90' : ''}`} />
          </button>
        )}

        {renderSettings()}
        {renderAdminOverlay()}

        {gameState === 'SPLASH' && renderSplash()}
        {gameState === 'MENU' && renderMenu()}
        {gameState === 'PRODUCT_SHOWCASE' && renderProductShowcase()}
        {gameState === 'TUTORIAL' && renderTutorial()}
        {gameState === 'LEADERBOARD' && renderLeaderboard()}

        {isInGame && (
          <>
            {renderSideInfo()}
            {renderHUD()}
            <div className="flex flex-col items-center w-full h-full relative pr-2 sm:pr-4" style={{ paddingTop: 'var(--hud-h, 4.5rem)', paddingLeft: 'calc(var(--sidebar-barrier) + 0.5rem)' }}>
              <div className="flex-1 flex items-center justify-center w-full relative">
                {renderGrid()}
              </div>
            </div>
          </>
        )}

        {gameState === 'GAME_OVER' && renderGameOver()}
        {gameState === 'NAME_INPUT' && renderNameInput()}
        {gameState === 'RANK_REVEAL' && renderRankReveal()}

        {gameState === 'ROUND_COMPLETE' && (
          <RoundCompleteScreen
            round={round}
            score={score}
            scoreAtRoundStart={scoreAtRoundStart}
            roundScore={roundScore}
            correctTaps={correctTaps}
            wrongTaps={wrongTaps}
            totalSamsung={roundConfig.samsungCount}
            isPerfect={wrongTaps === 0 && correctTaps >= roundConfig.samsungCount}
            isMuted={isMuted}
            isLastRound={round >= 8}
            onAdvance={handleAdvanceRound}
            onReturn={handleReturnToMenu}
            onGrandPrize={handleGrandPrize}
          />
        )}
        {gameState === 'GRAND_PRIZE' && (
          <GrandPrizeScreen
            score={score}
            isMuted={isMuted}
            onContinue={handleGrandPrizeContinue}
          />
        )}
      </div>
    </div>
  );
}
