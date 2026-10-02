import { useEffect, useRef, useCallback } from 'react';

// Shared AudioContext — reuse to prevent leak
let sharedAudioCtx = null;

function playBeep() {
  try {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy)
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume();
    }
    const oscillator = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    oscillator.connect(gain);
    gain.connect(sharedAudioCtx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.value = 1200;
    gain.gain.value = 0.3;
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.001, sharedAudioCtx.currentTime + 0.15);
    oscillator.stop(sharedAudioCtx.currentTime + 0.15);
  } catch {
    // Audio not available, skip silently
  }
}

/**
 * Hook to detect USB barcode scanner input.
 *
 * USB scanners "type" characters very fast (< 50ms between keys)
 * then send Enter. This hook distinguishes scanner input from
 * normal human typing by measuring inter-key timing.
 *
 * @param {function} onScan - Called with the scanned barcode string
 * @param {object}   opts
 * @param {boolean}  opts.enabled   - Enable/disable the listener (default: true)
 * @param {number}   opts.maxDelay  - Max ms between keystrokes to count as scan (default: 80)
 * @param {number}   opts.minLength - Min barcode length to be valid (default: 3)
 * @param {number}   opts.debounceMs - Ignore the same barcode scanned again within this many ms (default: 300)
 */
export default function useBarcodeScanner(onScan, { enabled = true, maxDelay = 80, minLength = 3, debounceMs = 300 } = {}) {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const timerRef = useRef(null);
  const onScanRef = useRef(onScan);
  const lastScannedRef = useRef({ code: '', time: 0 });

  // Keep callback ref fresh without re-registering listener
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const resetBuffer = useCallback(() => {
    bufferRef.current = '';
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      const now = Date.now();
      const elapsed = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // Clear stale buffer if too much time passed
      if (elapsed > maxDelay) {
        bufferRef.current = '';
      }

      // Clear any pending reset timer
      clearTimeout(timerRef.current);

      if (e.key === 'Enter') {
        const code = bufferRef.current.trim();
        if (code.length >= minLength) {
          // Prevent the Enter from submitting forms, etc.
          e.preventDefault();
          e.stopPropagation();

          // Ignore the same barcode fired again right away (scanner double-trigger)
          const last = lastScannedRef.current;
          if (code === last.code && now - last.time < debounceMs) {
            bufferRef.current = '';
            return;
          }
          lastScannedRef.current = { code, time: now };

          playBeep();
          onScanRef.current(code);
        }
        bufferRef.current = '';
        return;
      }

      // Only collect printable single characters
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        bufferRef.current += e.key;
      }

      // Auto-reset buffer after inactivity
      timerRef.current = setTimeout(resetBuffer, maxDelay * 3);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      clearTimeout(timerRef.current);
    };
  }, [enabled, maxDelay, minLength, debounceMs, resetBuffer]);
}
