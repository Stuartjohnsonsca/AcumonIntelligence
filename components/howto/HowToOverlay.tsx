'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronRight, MousePointerClick, Pause, Play, X } from 'lucide-react';
import type { HowToStep } from '@/lib/howto/registry';
import { HOWTO_PAGES } from '@/lib/howto/registry';

const STORAGE_KEY = 'howto:active-tour';

interface ActiveTour {
  question: string;
  steps: HowToStep[];
  index: number;
  paused?: boolean;
}

function loadTour(): ActiveTour | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveTour;
  } catch {
    return null;
  }
}

function saveTour(tour: ActiveTour | null) {
  if (typeof window === 'undefined') return;
  if (tour === null) {
    sessionStorage.removeItem(STORAGE_KEY);
  } else {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tour));
  }
  // Notify same-tab listeners — `storage` only fires across tabs.
  window.dispatchEvent(new CustomEvent('howto:tour-changed'));
}

export function startHowToTour(question: string, steps: HowToStep[]) {
  saveTour({ question, steps, index: 0 });
}

interface DotPosition {
  top: number;
  left: number;
  visible: boolean;
}

export function HowToOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const [tour, setTour] = useState<ActiveTour | null>(null);
  const [dotPos, setDotPos] = useState<DotPosition>({ top: 0, left: 0, visible: false });
  const [missing, setMissing] = useState(false);
  const [clickFlashKey, setClickFlashKey] = useState(0);
  const targetElRef = useRef<HTMLElement | null>(null);
  // Track tour in a ref so the click handler always sees the latest state
  // without needing to re-attach on every render.
  const tourRef = useRef<ActiveTour | null>(null);
  tourRef.current = tour;

  // Hydrate tour state from sessionStorage + listen for changes
  useEffect(() => {
    setTour(loadTour());
    const handler = () => setTour(loadTour());
    window.addEventListener('howto:tour-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('howto:tour-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const currentStep = tour && tour.index < tour.steps.length ? tour.steps[tour.index] : null;

  // Position the dot on the current step's element. Re-runs on scroll/resize.
  const positionDot = useCallback(() => {
    if (!currentStep) {
      setDotPos((p) => ({ ...p, visible: false }));
      targetElRef.current = null;
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-howto-id="${currentStep.howtoId}"]`);
    if (!el) {
      targetElRef.current = null;
      setDotPos((p) => ({ ...p, visible: false }));
      setMissing(true);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // Element exists in DOM but is hidden (collapsed panel etc.)
      targetElRef.current = null;
      setDotPos((p) => ({ ...p, visible: false }));
      setMissing(true);
      return;
    }
    setMissing(false);
    targetElRef.current = el;
    setDotPos({
      top: rect.top + rect.height / 2,
      left: rect.left + rect.width / 2,
      visible: true,
    });
  }, [currentStep]);

  // Re-position on step change and on scroll/resize.
  useEffect(() => {
    positionDot();
    if (!currentStep) return;
    const onScroll = () => positionDot();
    const onResize = () => positionDot();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    // Wait for newly-mounted elements (tab switches, conditional renders,
    // dropdowns opening). The first three timeouts handle the common case
    // (synchronous render or near-immediate React update). The longer
    // ones handle slower data-fetch-then-render paths.
    const timeouts = [50, 200, 500, 1000, 2000, 3500].map((ms) =>
      setTimeout(positionDot, ms),
    );

    // MutationObserver — fires whenever the DOM changes anywhere in the
    // document. Catches the cases timeouts miss (e.g. user opens an
    // accordion 4 seconds after the step lands). We only attach while
    // a step is active, and we re-position on every mutation.
    const observer = new MutationObserver(() => positionDot());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-howto-id', 'class', 'style', 'hidden'],
    });

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      timeouts.forEach(clearTimeout);
      observer.disconnect();
    };
  }, [currentStep, positionDot, pathname]);

  // ── Listen for the user's real click on the target element ──────────
  // This is what makes the tour interactive: the user clicks, the action
  // happens (because we don't intercept), and the tour advances. We update
  // sessionStorage synchronously inside the handler so that cross-page
  // navigation (e.g. clicking a Next.js Link) picks up the next step
  // when the new page loads.
  useEffect(() => {
    const el = targetElRef.current;
    if (!el || !currentStep || tour?.paused) return;

    const handler = () => {
      const t = tourRef.current;
      if (!t) return;
      // Visual click confirmation
      setClickFlashKey((k) => k + 1);
      // Advance synchronously so cross-page navigation finds the next step
      const nextIndex = t.index + 1;
      if (nextIndex >= t.steps.length) {
        saveTour(null);
      } else {
        saveTour({ ...t, index: nextIndex });
      }
    };

    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [currentStep, dotPos.visible, tour?.paused]);

  // If the current step is on a different page than we're on, navigate.
  // Steps on the synthetic 'global' page (e.g. navbar elements) live on
  // every page, so we never navigate for them.
  useEffect(() => {
    if (!currentStep || tour?.paused) return;
    const expectedUrl = HOWTO_PAGES[currentStep.page]?.url;
    if (!expectedUrl || expectedUrl === '*') return;
    if (pathname !== expectedUrl) {
      router.push(expectedUrl);
    }
  }, [currentStep, pathname, router, tour?.paused]);

  // Scroll the target into view
  useEffect(() => {
    if (!targetElRef.current) return;
    targetElRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentStep]);

  function next() {
    if (!tour) return;
    const nextIndex = tour.index + 1;
    if (nextIndex >= tour.steps.length) {
      saveTour(null);
      setTour(null);
    } else {
      const updated = { ...tour, index: nextIndex };
      saveTour(updated);
      setTour(updated);
    }
  }

  function cancel() {
    saveTour(null);
    setTour(null);
  }

  function togglePause() {
    if (!tour) return;
    const updated = { ...tour, paused: !tour.paused };
    saveTour(updated);
    setTour(updated);
  }

  if (!tour || !currentStep) return null;

  const totalSteps = tour.steps.length;
  const stepNum = tour.index + 1;
  const stepUrl = HOWTO_PAGES[currentStep.page]?.url;
  const onCurrentPage = stepUrl === '*' || stepUrl === pathname;

  return (
    <>
      {/* Inline keyframes for click ripple — Tailwind doesn't ship a one-off ripple */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes howtoClickRipple {
          0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(3.2); opacity: 0; }
        }
        @keyframes howtoDotBob {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50%      { transform: translate(-50%, -50%) scale(1.15); }
        }
      `}} />

      {/* Yellow "mouse" dot pointing at the target */}
      {dotPos.visible && onCurrentPage && !tour.paused && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[9998]"
          style={{ top: dotPos.top, left: dotPos.left }}
        >
          {/* Outer ping ring */}
          <span
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-10 rounded-full border-2 border-yellow-400 opacity-70 animate-ping"
          />
          {/* Click ripple — re-mounts when clickFlashKey changes */}
          {clickFlashKey > 0 && (
            <span
              key={clickFlashKey}
              className="absolute top-1/2 left-1/2 h-12 w-12 rounded-full bg-yellow-300/40 ring-2 ring-yellow-500"
              style={{
                animation: 'howtoClickRipple 0.55s ease-out forwards',
              }}
            />
          )}
          {/* Dot itself */}
          <span
            className="absolute top-1/2 left-1/2 block h-5 w-5 rounded-full bg-yellow-400 shadow-lg shadow-yellow-400/60 ring-2 ring-yellow-600"
            style={{ animation: 'howtoDotBob 1.1s ease-in-out infinite' }}
          />
          {/* Cursor icon — signals "click here" */}
          <MousePointerClick
            className="absolute top-1/2 left-1/2 h-4 w-4 text-yellow-900 drop-shadow"
            style={{ transform: 'translate(2px, 2px)' }}
          />
        </div>
      )}

      {/* Narration / control panel — fixed bottom-right */}
      <div className="fixed bottom-4 right-4 z-[9999] w-80 max-w-[calc(100vw-2rem)] bg-white border-2 border-yellow-400 rounded-lg shadow-2xl overflow-hidden">
        <div className="bg-yellow-50 px-3 py-2 flex items-center justify-between border-b border-yellow-200">
          <div className="text-[10px] font-semibold text-yellow-800 uppercase tracking-wide">
            How to · step {stepNum}/{totalSteps}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={togglePause}
              title={tour.paused ? 'Resume' : 'Pause'}
              className="text-yellow-700 hover:bg-yellow-100 rounded p-1"
            >
              {tour.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={cancel}
              title="End walkthrough"
              className="text-yellow-700 hover:bg-yellow-100 rounded p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="px-3 py-3 space-y-2">
          <div className="text-[11px] text-slate-500 italic line-clamp-1">&ldquo;{tour.question}&rdquo;</div>

          {!onCurrentPage ? (
            <div className="text-xs text-slate-600">
              Taking you to <strong>{HOWTO_PAGES[currentStep.page]?.title}</strong>…
            </div>
          ) : (
            <>
              {/* Always show the narration so the user gets the instruction
                  even when the dot can't land — they may be able to act on
                  the words alone. */}
              <div className="text-sm text-slate-800 leading-snug">{currentStep.narration}</div>
              {missing ? (
                <div className="flex items-start gap-1.5 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  <MousePointerClick className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>The highlighted element isn&apos;t visible right now — it may be inside a collapsed panel, tab, or dropdown. Open it manually, or press <strong>Skip</strong> to move on.</span>
                </div>
              ) : (
                <div className="flex items-start gap-1.5 text-[11px] text-yellow-900 bg-yellow-50 rounded px-2 py-1">
                  <MousePointerClick className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>Click where the dot is pointing — your click will register and the tour advances automatically.</span>
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={cancel}
              className="text-[11px] text-slate-500 hover:text-slate-700"
            >
              End
            </button>
            <button
              onClick={next}
              className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded font-medium ${
                missing
                  ? 'bg-yellow-400 hover:bg-yellow-500 text-yellow-900'
                  : 'bg-white border border-yellow-300 hover:bg-yellow-50 text-yellow-900'
              }`}
              title={missing ? 'Move on to the next step' : 'Skip this step'}
            >
              {stepNum === totalSteps ? 'Finish' : missing ? 'Next' : 'Skip'}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${(stepNum / totalSteps) * 100}%` }} />
          </div>
        </div>
      </div>
    </>
  );
}
